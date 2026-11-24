import { expect, test, type Page } from '@playwright/test';

/**
 * Declaring a model in the browser (#651): the five-step model card form,
 * the risk tier derived live from the intended use (never typed), values
 * echoed after a refusal, then edit, submit for review, and publish by a
 * second person. The declare-and-edit path runs in English and in French.
 *
 * Pre-conditions: the API and the web app running locally with
 * `OCI_ENV=local`. Needs no seed: every card it creates has a unique slug.
 */

// A full declare, refuse, edit, submit walk: more than the default 30 s.
test.describe.configure({ timeout: 120_000 });

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.locator('#signin-user').fill(user);
  await page.locator('#signin-roles').fill(roles);
  await page.locator('#signin-roles').press('Enter');
  await page.waitForURL(/\/dashboard/);
}

interface Labels {
  next: RegExp;
  radiologist: string;
  emergency: string;
  standalone: string;
  save: RegExp;
  saveChanges: RegExp;
  tierLive: RegExp;
  stepModel: RegExp;
  stepIntendedUse: RegExp;
  stepRiskTier: RegExp;
  stepReview: RegExp;
  correctErrors: string;
  slugTaken: RegExp;
  draft: string;
  submitted: string;
  submit: string;
  publish: string;
  edit: string;
  tierBadge: (tier: string) => RegExp;
}

const EN: Labels = {
  next: /^Next:/,
  radiologist: 'Radiologist',
  emergency: 'Emergency',
  standalone: 'Standalone',
  save: /^Save as draft$/,
  saveChanges: /^Save changes$/,
  tierLive: /Risk tier from your answers so far/,
  stepModel: /^The model/,
  stepIntendedUse: /^Intended use/,
  stepRiskTier: /^Risk tier/,
  stepReview: /^Review and save/,
  correctErrors: 'Please correct the errors below.',
  slugTaken: /already exists/,
  draft: 'Draft',
  submitted: 'Submitted for review',
  submit: 'Submit for review',
  publish: 'Publish',
  edit: 'Edit the card',
  tierBadge: (tier) => new RegExp(`Risk tier ${tier}(?!I)`),
};

const FR: Labels = {
  next: /^Étape suivante/,
  radiologist: 'Radiologue',
  emergency: 'Urgences',
  standalone: 'Autonome',
  save: /^Enregistrer le brouillon$/,
  saveChanges: /^Enregistrer les modifications$/,
  tierLive: /Niveau de risque d’après vos réponses/,
  stepModel: /^Le modèle/,
  stepIntendedUse: /^Usage prévu/,
  stepRiskTier: /^Niveau de risque/,
  stepReview: /^Vérifier et enregistrer/,
  correctErrors: 'Veuillez corriger les erreurs ci-dessous.',
  slugTaken: /existe déjà/,
  draft: 'Brouillon',
  submitted: 'Soumise pour relecture',
  submit: 'Soumettre pour relecture',
  publish: 'Publier',
  edit: 'Modifier la fiche',
  tierBadge: (tier) => new RegExp(`Niveau de risque ${tier}(?!I)`),
};

/** The derived tier on the step in view. */
const tier = (page: Page) => page.getByTestId('derived-risk-tier').filter({ visible: true });

const nextStep = (page: Page, l: Labels) => page.getByRole('button', { name: l.next }).click();

/** Fill steps 1 and 2 with a triage model; leaves the form on step 2. */
async function fillModelAndIntendedUse(page: Page, l: Labels, slug: string) {
  await page.goto('/models/new');
  await page.locator('#mc-slug').fill(slug);
  await page.locator('#mc-version').fill('1.0.0');
  await page.locator('#mc-modelClass').selectOption('classical');
  await page.locator('#mc-modelDeveloper').fill('Example Imaging Lab');
  await page.locator('#mc-developerContact').fill('models@example.org');
  await page.locator('#mc-architectureSummary').fill('Convolutional network over radiographs.');
  await nextStep(page, l);

  await page.locator('#mc-medicalPurpose').selectOption('triage');
  await page.getByRole('checkbox', { name: l.radiologist }).check();
  await page.locator('#mc-foreseeableMisuse').fill('Used on paediatric films.');
}

/** From step 2: through the tier and evidence steps to the review step. */
async function toReview(page: Page, l: Labels) {
  for (let i = 0; i < 3; i += 1) await nextStep(page, l);
}

for (const [lang, l] of [
  ['en', EN],
  ['fr', FR],
] as const) {
  test.describe(`declare a model (${lang})`, () => {
    test.use({ locale: lang === 'fr' ? 'fr-FR' : 'en-GB' });

    test('tier derived live, values echoed after a refusal, saved, edited and submitted', async ({
      page,
    }) => {
      const slug = `e2e-model-${lang}-${Date.now()}`;
      await signInAs(page, `e2e-declarer-${lang}`, 'participant');
      await fillModelAndIntendedUse(page, l, slug);

      // The tier follows the answers: triage II, in an emergency III, standalone diagnosis IV.
      await expect(page.getByText(l.tierLive)).toBeVisible();
      await expect(tier(page)).toHaveText(/\bII$/);
      await page.getByRole('checkbox', { name: l.emergency }).check();
      await expect(tier(page)).toHaveText(/\bIII$/);
      await page.locator('#mc-medicalPurpose').selectOption('diagnosis');
      await page.getByRole('radio', { name: l.standalone }).check();
      await expect(tier(page)).toHaveText(/\bIV$/);
      // The tier is never an input.
      await expect(page.locator('[name="riskTier"]')).toHaveCount(0);

      // Step 3 shows it with the reason.
      await nextStep(page, l);
      await expect(tier(page)).toHaveText(/\bIV$/);

      // A version the API schema refuses (the browser's own check is lifted to
      // reach the server): the form comes back on step 1, every value kept.
      await page.getByRole('button', { name: l.stepModel }).click();
      await page.locator('#mc-version').evaluate((el) => el.removeAttribute('pattern'));
      await page.locator('#mc-version').fill('1.0');
      // Steps 4 and 5 have not been reached yet: walk there with "Next".
      for (let i = 0; i < 4; i += 1) await nextStep(page, l);
      await page.getByRole('button', { name: l.save }).click();
      await expect(page.getByText(l.correctErrors)).toBeVisible();
      await expect(page.locator('#mc-version')).toBeVisible();
      await expect(page.locator('#mc-version-err')).toBeVisible();
      await expect(page.locator('#mc-version')).toHaveValue('1.0');
      await expect(page.locator('#mc-slug')).toHaveValue(slug);
      await expect(page.locator('#mc-modelDeveloper')).toHaveValue('Example Imaging Lab');
      await expect(page.locator('#mc-modelClass')).toHaveValue('classical');
      await expect(page.locator('#mc-medicalPurpose')).toHaveValue('diagnosis');
      await expect(page.locator('#mc-foreseeableMisuse')).toHaveValue('Used on paediatric films.');
      await expect(
        page.locator('input[name="operatingEnvironment"][value="emergency"]'),
      ).toBeChecked();
      await expect(
        page.locator('input[name="intendedUserRole"][value="radiologist"]'),
      ).toBeChecked();
      await expect(
        page.locator('input[name="intendedClinicalPathway"][value="standalone"]'),
      ).toBeChecked();
      await page.getByRole('button', { name: l.stepRiskTier }).click();
      await expect(tier(page)).toHaveText(/\bIV$/);

      // Corrected, it saves as a draft and opens the card.
      await page.getByRole('button', { name: l.stepModel }).click();
      await page.locator('#mc-version').fill('1.0.0');
      await page.getByRole('button', { name: l.stepReview }).click();
      await page.getByRole('button', { name: l.save }).click();
      await page.waitForURL(new RegExp(`/models/${slug}$`));
      await expect(page.getByRole('heading', { level: 1, name: slug })).toBeVisible();
      await expect(page.getByText(l.draft, { exact: true })).toBeVisible();
      await expect(page.getByText(l.tierBadge('IV')).first()).toBeVisible();

      // The same identifier again: refused by the API, values kept.
      await fillModelAndIntendedUse(page, l, slug);
      await toReview(page, l);
      await page.getByRole('button', { name: l.save }).click();
      await expect(page.getByText(l.slugTaken).first()).toBeVisible();
      await expect(page.locator('#mc-slug')).toHaveValue(slug);
      await expect(page.locator('#mc-medicalPurpose')).toHaveValue('triage');

      // Edit the draft: the tier is derived again from the new answers.
      await page.goto(`/models/${slug}`);
      await page.getByRole('link', { name: l.edit }).click();
      await page.waitForURL(new RegExp(`/models/${slug}/edit$`));
      await expect(page.locator('#mc-slug')).toHaveValue(slug);
      await page.getByRole('button', { name: l.stepIntendedUse }).click();
      await page.locator('#mc-medicalPurpose').selectOption('triage');
      await page.getByRole('checkbox', { name: l.emergency }).uncheck();
      await expect(tier(page)).toHaveText(/\bII$/);
      await page.getByRole('button', { name: l.stepReview }).click();
      await page.getByRole('button', { name: l.saveChanges }).click();
      await page.waitForURL(new RegExp(`/models/${slug}$`));
      await expect(page.getByText(l.tierBadge('II')).first()).toBeVisible();

      // Submit for review: no more edit, no publish for the submitter.
      await page.getByRole('button', { name: l.submit }).click();
      await expect(page.getByText(l.submitted, { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: l.edit })).toHaveCount(0);
      await expect(page.getByRole('button', { name: l.publish, exact: true })).toHaveCount(0);

      // Listed under "My models" on the dashboard, with its tier and status.
      await page.goto('/dashboard');
      const row = page.locator('li', { has: page.locator(`a[href="/models/${slug}"]`) });
      await expect(row).toContainText(l.tierBadge('II'));
      await expect(row).toContainText(l.submitted);
    });
  });
}

test('a reviewer publishes a card someone else submitted', async ({ browser }) => {
  const slug = `e2e-model-review-${Date.now()}`;
  const ownerCtx = await browser.newContext({ locale: 'en-GB' });
  const owner = await ownerCtx.newPage();
  await signInAs(owner, 'e2e-declarer-review', 'participant');
  await fillModelAndIntendedUse(owner, EN, slug);
  await toReview(owner, EN);
  await owner.getByRole('button', { name: EN.save }).click();
  await owner.waitForURL(new RegExp(`/models/${slug}$`));
  await owner.getByRole('button', { name: EN.submit }).click();
  await expect(owner.getByText(EN.submitted, { exact: true })).toBeVisible();
  await ownerCtx.close();

  const reviewerCtx = await browser.newContext({ locale: 'en-GB' });
  const reviewer = await reviewerCtx.newPage();
  await signInAs(reviewer, 'e2e-model-reviewer', 'evaluation-reviewer');
  await reviewer.goto(`/models/${slug}`);
  await expect(reviewer.getByRole('link', { name: EN.edit })).toHaveCount(0);
  await reviewer.getByRole('button', { name: EN.publish, exact: true }).click();
  await expect(reviewer.getByText('Published', { exact: true })).toBeVisible();
  await reviewerCtx.close();

  // Published: an anonymous visitor reads it, with its derived tier.
  const anonCtx = await browser.newContext({ locale: 'en-GB' });
  const anon = await anonCtx.newPage();
  await anon.goto(`/models/${slug}`);
  await expect(anon.getByText(EN.tierBadge('II')).first()).toBeVisible();
  await anonCtx.close();
});

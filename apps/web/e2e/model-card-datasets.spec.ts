import { expect, test, type Page } from '@playwright/test';

/**
 * The datasets a model declares (#820): entered in the model card form, shown
 * on the model page with a link to the catalogue, and, once the card is
 * published, listed on the dataset page under the models that use it.
 *
 * Pre-conditions: the API and the web app running locally with
 * `OCI_ENV=local`, and the demo seed (`pnpm --filter @oci/database
 * db:seed:demo`), which provides the public dataset `rsna-pneumonia-2018` and
 * the demonstration cards.
 */

test.describe.configure({ timeout: 120_000 });
test.use({ locale: 'en-GB' });

const DATASET = 'rsna-pneumonia-2018';

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.locator('#signin-user').fill(user);
  await page.locator('#signin-roles').fill(roles);
  await page.locator('#signin-roles').press('Enter');
  await page.waitForURL(/\/dashboard/);
}

const nextStep = (page: Page) => page.getByRole('button', { name: /^Next:/ }).click();

/** Steps 1 to 3 of the form, leaving it on step 4, "Evidence and limits". */
async function fillUpToEvidence(page: Page, slug: string) {
  await page.goto('/models/new');
  await page.locator('#mc-slug').fill(slug);
  await page.locator('#mc-version').fill('1.0.0');
  await page.locator('#mc-modelClass').selectOption('classical');
  await page.locator('#mc-modelDeveloper').fill('Example Imaging Lab');
  await page.locator('#mc-developerContact').fill('models@example.org');
  await page.locator('#mc-architectureSummary').fill('Convolutional network over radiographs.');
  await nextStep(page);
  await page.locator('#mc-medicalPurpose').selectOption('triage');
  await page.getByRole('checkbox', { name: 'Radiologist' }).check();
  await page.locator('#mc-foreseeableMisuse').fill('Used on paediatric films.');
  await nextStep(page);
  await nextStep(page);
}

const addDataset = (page: Page) => page.getByRole('button', { name: 'Add a dataset' }).click();
const row = (page: Page, index: number, input: 'role' | 'target' | 'name' | 'note') =>
  page.locator(`#mc-datasetRef-${index}-${input}`);

test('declared in the form, shown on the model page, and listed on the dataset page', async ({
  browser,
}) => {
  const slug = `e2e-model-data-${Date.now()}`;
  const ownerCtx = await browser.newContext({ locale: 'en-GB' });
  const owner = await ownerCtx.newPage();
  await signInAs(owner, 'e2e-declarer-data', 'participant');
  await fillUpToEvidence(owner, slug);

  // No row until one is asked for; a new row takes the focus.
  const evidence = owner.locator('fieldset[data-step="evidence"]');
  await expect(evidence.getByText('No dataset declared.')).toBeVisible();
  await addDataset(owner);
  await expect(row(owner, 0, 'role')).toBeFocused();
  await row(owner, 0, 'target').fill(DATASET);
  await row(owner, 0, 'note').fill('Training split');
  // A catalogue dataset is shown under its own name: no name is asked.
  await expect(row(owner, 0, 'name')).toHaveCount(0);

  // A web address is a dataset held elsewhere, and needs a name.
  await addDataset(owner);
  await row(owner, 1, 'role').selectOption('EVALUATION');
  await row(owner, 1, 'target').fill('https://doi.org/10.5555/e2e-external-set');
  await row(owner, 1, 'name').fill('External test set');

  await addDataset(owner);
  await row(owner, 2, 'role').selectOption('TUNING');
  await row(owner, 2, 'target').fill('e2e-no-such-dataset');

  // The review step lists them.
  await nextStep(owner);
  await expect(owner.getByText(`Training: ${DATASET}`)).toBeVisible();
  await expect(owner.getByText('Evaluation: External test set')).toBeVisible();

  // The API refuses the dataset it does not know: the form comes back on the
  // evidence step, the message under that row, every row kept.
  await owner.getByRole('button', { name: /^Save as draft$/ }).click();
  await expect(owner.getByText('Please correct the errors below.')).toBeVisible();
  await expect(row(owner, 2, 'target')).toBeVisible();
  await expect(owner.locator('#mc-datasetRef-2-err')).toContainText('Not in this catalogue');
  await expect(owner.locator('#mc-datasetRef-0-err')).toHaveCount(0);
  await expect(row(owner, 0, 'target')).toHaveValue(DATASET);
  await expect(row(owner, 1, 'name')).toHaveValue('External test set');

  // Removed, the card saves.
  await owner.getByRole('button', { name: 'Remove dataset 3' }).click();
  await expect(row(owner, 2, 'target')).toHaveCount(0);
  await owner.getByRole('button', { name: /^Review and save/ }).click();
  await owner.getByRole('button', { name: /^Save as draft$/ }).click();
  await owner.waitForURL(new RegExp(`/models/${slug}$`));

  // The model page: the catalogue dataset by name, linked, with what the
  // catalogue says about it; the external one as an outside link.
  const data = owner.locator('section[aria-labelledby="model-data-declared"]');
  await expect(owner.getByRole('heading', { level: 2, name: 'Data' })).toBeVisible();
  await expect(data.locator(`a[href="/catalog/${DATASET}"]`)).toBeVisible();
  await expect(data).toContainText('Training split');
  await expect(data).toContainText(/Version \S+ when declared/);
  const external = data.getByRole('link', { name: /External test set/ });
  await expect(external).toHaveAttribute('href', 'https://doi.org/10.5555/e2e-external-set');
  await expect(external).toHaveAttribute('rel', 'noreferrer');

  // Editing brings the rows back as typed.
  await owner.getByRole('link', { name: 'Edit the card' }).click();
  await owner.waitForURL(new RegExp(`/models/${slug}/edit$`));
  await owner.getByRole('button', { name: /^Evidence and limits/ }).click();
  await expect(row(owner, 0, 'target')).toHaveValue(DATASET);
  await expect(row(owner, 0, 'note')).toHaveValue('Training split');
  await expect(row(owner, 1, 'role')).toHaveValue('EVALUATION');
  await expect(row(owner, 1, 'name')).toHaveValue('External test set');

  // A draft is not on the dataset page.
  await owner.goto(`/catalog/${DATASET}`);
  await expect(owner.locator(`a[href="/models/${slug}"]`)).toHaveCount(0);

  await owner.goto(`/models/${slug}`);
  await owner.getByRole('button', { name: 'Submit for review' }).click();
  await expect(owner.getByText('Submitted for review', { exact: true })).toBeVisible();
  await ownerCtx.close();

  const reviewerCtx = await browser.newContext({ locale: 'en-GB' });
  const reviewer = await reviewerCtx.newPage();
  await signInAs(reviewer, 'e2e-model-reviewer', 'evaluation-reviewer');
  await reviewer.goto(`/models/${slug}`);
  await reviewer.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(reviewer.getByText('Published', { exact: true })).toBeVisible();
  await reviewerCtx.close();

  // Published: anyone finds the model from the dataset, and the dataset from the model.
  const anonCtx = await browser.newContext({ locale: 'en-GB' });
  const anon = await anonCtx.newPage();
  await anon.goto(`/catalog/${DATASET}`);
  await expect(anon.getByRole('heading', { name: 'Models that use this dataset' })).toBeVisible();
  const listed = anon.locator('li', { has: anon.locator(`a[href="/models/${slug}"]`) });
  // A public page keeps what it read from the API for 30 seconds, so a card
  // published a moment ago may take that long to appear.
  await expect(async () => {
    await anon.reload();
    await expect(listed).toContainText('Used for: Training', { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await listed.getByRole('link', { name: slug }).click();
  await anon.waitForURL(new RegExp(`/models/${slug}$`));
  await anon
    .locator('section[aria-labelledby="model-data-declared"]')
    .locator(`a[href="/catalog/${DATASET}"]`)
    .click();
  await anon.waitForURL(new RegExp(`/catalog/${DATASET}$`));
  await anonCtx.close();
});

test('the demonstration retina grader shows its training and evaluation data', async ({ page }) => {
  await page.goto('/models/demo-retina-dr-grader');
  const data = page.locator('section[aria-labelledby="model-data-declared"]');

  await expect(data.getByRole('link', { name: /EyePACS/ })).toHaveAttribute(
    'href',
    'https://www.kaggle.com/c/diabetic-retinopathy-detection',
  );
  await expect(data).toContainText('Held elsewhere');
  await expect(data.locator('a[href="/catalog/idrid-grading-demo"]')).toBeVisible();
  await expect(data).toContainText('Licence');
});

test('the Data section reads in French', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'fr-FR' });
  const page = await ctx.newPage();
  await page.goto('/models/demo-retina-dr-grader');

  await expect(page.getByRole('heading', { level: 2, name: 'Données' })).toBeVisible();
  const data = page.locator('section[aria-labelledby="model-data-declared"]');
  await expect(data).toContainText('Entraînement');
  await expect(data).toContainText('Conservé ailleurs');
  await ctx.close();
});

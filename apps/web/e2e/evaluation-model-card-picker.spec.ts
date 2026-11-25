import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Choosing the model card a result is evidence for (#587), end to end
 * against the real API, in English and in French. Nothing is mocked.
 *
 * Setup, through the API: one grading task with six items, and for each
 * language a participant with one draft model card. Then, per language:
 *
 *   1. The participant submits with their card chosen in the picker, where
 *      the draft says it is one, and the result page shows the card.
 *   2. They remove the link, then link the card again, from the result page.
 *   3. The result page links to the evidence summary, whose section 1 names
 *      the card.
 *   4. A participant with no card sees "Declare a model" instead of a picker.
 *
 * axe-core on the submit page and the result page, light and dark.
 *
 * Pre-conditions: Postgres migrated and seeded, the API and the web running
 * (PW_BASE_URL, NEXT_PUBLIC_API_BASE_URL). Run with PW_NO_RESET=1 against a
 * database of your own: this spec touches no container.
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const stamp = Date.now();
const TASK = `e2e-eval-card-${stamp}`;
const TRUTH = { m_01: 0, m_02: 1, m_03: 1, m_04: 0, m_05: 1, m_06: 0 };
const FILE = 'item_id,label\nm_01,0\nm_02,1\nm_03,1\nm_04,0\nm_05,1\nm_06,1\n';

const TEXT = {
  en: {
    user: 'User',
    roles: 'Roles',
    signIn: /sign in/i,
    methodName: 'Method name',
    file: 'Predictions file',
    submit: 'Submit for scoring',
    picker: 'Model card',
    linkedPicker: 'Linked card',
    none: 'No model card',
    draft: 'draft, not reviewed yet',
    linkedNone: 'No model card linked.',
    save: 'Save',
    unlinked: 'The link to the model card is removed.',
    linked: 'The model card is linked.',
    evidence: 'Evidence summary',
    section1: 'Intended use and risk tier',
    declare: 'Declare a model',
  },
  fr: {
    user: 'Utilisateur',
    roles: 'Rôles',
    signIn: /se connecter/i,
    methodName: 'Nom de la méthode',
    file: 'Fichier de prédictions',
    submit: 'Soumettre à la notation',
    picker: 'Fiche de modèle',
    linkedPicker: 'Fiche liée',
    none: 'Aucune fiche de modèle',
    draft: 'brouillon, pas encore relu',
    linkedNone: 'Aucune fiche de modèle liée.',
    save: 'Enregistrer',
    unlinked: 'Le lien vers la fiche de modèle est supprimé.',
    linked: 'La fiche de modèle est liée.',
    evidence: 'Synthèse des preuves',
    section1: 'Usage prévu et niveau de risque',
    declare: 'Déclarez un modèle',
  },
} as const;
type Lang = keyof typeof TEXT;

/** One run per language: its words, and what setup and the first test record. */
interface Run {
  lang: Lang;
  l: (typeof TEXT)[Lang];
  cardId: string;
  resultPath: string;
}
const RUNS: Run[] = [
  { lang: 'en', l: TEXT.en, cardId: '', resultPath: '' },
  { lang: 'fr', l: TEXT.fr, cardId: '', resultPath: '' },
];

const participant = (lang: Lang) => `e2e-card-${lang}-${stamp}`;
const cardSlug = (lang: Lang) => `e2e-card-${lang}-${stamp}`;

async function createCard(request: APIRequestContext, lang: Lang): Promise<string> {
  const res = await request.post(`${API}/v2/prediction/model-cards`, {
    headers: { Authorization: `Bearer dev:${participant(lang)}:participant` },
    data: {
      slug: cardSlug(lang),
      intendedUse: {
        v: 1,
        medicalPurpose: 'triage',
        foreseeableMisuse: 'Use outside the validated population.',
        contraindications: '',
        riskTier: 'II',
      },
      modelClass: 'classical',
      architectureSummary: 'Convolutional network.',
      versionMajorMinorPatch: '1.2.0',
      modelDeveloper: 'Example Imaging Lab',
      developerContact: 'models@example.org',
    },
  });
  expect(res.ok(), `create card: ${res.status()} ${await res.text()}`).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

async function signedIn(
  browser: Browser,
  lang: Lang,
  user: string,
  callback: string,
  options: { width?: number; colorScheme?: 'light' | 'dark' } = {},
): Promise<Page> {
  const context = await browser.newContext({
    locale: lang === 'fr' ? 'fr-FR' : 'en-GB',
    viewport: { width: options.width ?? 1280, height: 900 },
    colorScheme: options.colorScheme ?? 'light',
  });
  const page = await context.newPage();
  const l = lang === 'fr' ? TEXT.fr : TEXT.en;
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(callback)}`);
  await page.getByLabel(l.user).fill(user);
  await page.getByLabel(l.roles, { exact: false }).fill('participant');
  await page.getByRole('button', { name: l.signIn }).click();
  await page.waitForURL((url) => url.pathname === callback);
  return page;
}

async function noAxeViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`),
    `axe on ${label}`,
  ).toEqual([]);
}

test.describe('model card picker (#587)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/v2/evaluation/tasks`, {
      headers: { Authorization: 'Bearer dev:e2e-eval-host:host' },
      data: {
        slug: TASK,
        name: 'E2E model card task',
        datasetSlug: 'e2e-eval-dataset',
        taskKind: 'GRADING',
        numClasses: 2,
        referableThreshold: 1,
        groundTruth: TRUTH,
      },
    });
    expect(res.ok(), `create task: ${res.status()}`).toBe(true);
    for (const run of RUNS) run.cardId = await createCard(request, run.lang);
  });

  for (const run of RUNS) {
    const { lang, l } = run;

    test(`${lang}: submit with the card, and the result page shows it`, async ({ browser }) => {
      const page = await signedIn(browser, lang, participant(lang), `/evaluation/${TASK}/submit`);

      const picker = page.getByLabel(l.picker);
      await expect(picker).toHaveValue('');
      await expect(picker.locator('option').first()).toHaveText(l.none);
      // The draft says it is one.
      await expect(picker.locator('option', { hasText: cardSlug(lang) })).toHaveText(
        `${cardSlug(lang)}, version 1.2.0 (${l.draft})`,
      );

      await page.getByLabel(l.methodName).fill(`Card ${lang}`);
      await picker.selectOption(run.cardId);
      await page.getByLabel(l.file).setInputFiles({
        name: 'predictions.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(FILE, 'utf8'),
      });
      await page.getByRole('button', { name: l.submit }).click();
      await page.waitForURL(new RegExp(`/evaluation/${TASK}/submissions/[0-9a-f-]{36}$`));
      run.resultPath = new URL(page.url()).pathname;

      await expect(
        page.getByRole('heading', { level: 2, name: l.picker, exact: true }),
      ).toBeVisible();
      const cardLink = page.getByRole('link', { name: cardSlug(lang), exact: true });
      await expect(cardLink).toHaveAttribute('href', `/models/${cardSlug(lang)}`);
      // Slug, version and status on one line.
      await expect(page.locator('p').filter({ has: cardLink })).toContainText('version 1.2.0');
      await expect(page.getByLabel(l.linkedPicker)).toHaveValue(run.cardId);
      await page.context().close();
    });

    test(`${lang}: unlink the card, then link it again`, async ({ browser }) => {
      const path = run.resultPath;
      const page = await signedIn(browser, lang, participant(lang), path);

      await page.getByLabel(l.linkedPicker).selectOption('');
      await page.getByRole('button', { name: l.save, exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: l.unlinked })).toBeVisible();
      await expect(page.getByText(l.linkedNone)).toBeVisible();
      await expect(page.getByRole('link', { name: cardSlug(lang), exact: true })).toHaveCount(0);
      await expect(page.getByLabel(l.linkedPicker)).toHaveValue('');

      await page.getByLabel(l.linkedPicker).selectOption(run.cardId);
      await page.getByRole('button', { name: l.save, exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: l.linked })).toBeVisible();
      await expect(page.getByRole('link', { name: cardSlug(lang), exact: true })).toBeVisible();
      await expect(page.getByLabel(l.linkedPicker)).toHaveValue(run.cardId);
      await page.context().close();
    });

    test(`${lang}: the evidence summary link opens it, and section 1 names the card`, async ({
      browser,
    }) => {
      const path = run.resultPath;
      const page = await signedIn(browser, lang, participant(lang), path);

      await page.getByRole('link', { name: l.evidence, exact: true }).click();
      await page.waitForURL((url) => url.pathname === `${path}/evidence`);
      const section1 = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: l.section1 }) });
      await expect(section1).toContainText(`${cardSlug(lang)}, version 1.2.0`);
      await page.context().close();
    });

    test(`${lang}: a participant without a card is pointed to "Declare a model"`, async ({
      browser,
    }) => {
      const page = await signedIn(
        browser,
        lang,
        `e2e-card-none-${lang}-${stamp}`,
        `/evaluation/${TASK}/submit`,
      );
      await expect(page.getByRole('combobox', { name: l.picker })).toHaveCount(0);
      await expect(page.getByRole('link', { name: l.declare, exact: true })).toHaveAttribute(
        'href',
        '/models/new',
      );
      await page.context().close();
    });
  }

  test('axe: submit page and result page, light and dark, 375 and 1280 px', async ({ browser }) => {
    for (const { lang, resultPath } of RUNS) {
      for (const colorScheme of ['light', 'dark'] as const) {
        for (const width of [375, 1280]) {
          for (const path of [`/evaluation/${TASK}/submit`, resultPath]) {
            const page = await signedIn(browser, lang, participant(lang), path, {
              width,
              colorScheme,
            });
            await noAxeViolations(page, `${path} ${lang} ${colorScheme} ${width}px`);
            const overflow = await page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(overflow, `horizontal scroll on ${path} at ${width}px`).toBeLessThanOrEqual(0);
            await page.context().close();
          }
        }
      }
    }
  });
});

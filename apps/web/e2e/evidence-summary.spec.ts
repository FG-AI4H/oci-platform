import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { test, expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The evidence summary of one evaluated submission (#652), end to end
 * against the real API. Nothing is mocked.
 *
 * Setup scores the workshop's model A teaching file on the
 * `nih-chestxray14-finding` task of the radiology-workshop seed profile, as
 * a participant. Then, as a regulator:
 *
 *   1. The page in English and in French: the seven sections, and section 6
 *      listing exactly the gaps the API computed, worded in the language.
 *   2. Printed (print media, A4 PDF from Chromium): the site header does
 *      not print, and the summary fits on two pages, in both languages.
 *   3. axe-core at 375 px and 1280 px, light and dark: no violations.
 *   4. Anyone signed in without a reader role is told it is not for them.
 *
 * Pre-conditions: Postgres seeded with the demo seed and the
 * radiology-workshop profile, the API and the web running (PW_BASE_URL,
 * NEXT_PUBLIC_API_BASE_URL). Run with PW_NO_RESET=1 against a database of
 * your own (#760): this spec touches no container.
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const TASK = 'nih-chestxray14-finding';
const SHOTS = process.env.PW_EVIDENCE_SHOTS;
const stamp = Date.now();

const MODEL_A = resolvePath(
  process.cwd(),
  '../../packages/database/seed/profiles/radiology-workshop/fixtures/nih-chestxray14-workshop/model-a.csv',
);

function predictionsOf(csv: string) {
  return csv
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const [imageId = '', grade = ''] = line.split(',');
      return { imageId, grade: Number(grade) };
    });
}

const LABELS = {
  en: { user: 'User', roles: 'Roles', submit: /sign in/i },
  fr: { user: 'Utilisateur', roles: 'Rôles', submit: /se connecter/i },
} as const;

async function signedInPage(
  browser: Browser,
  lang: 'en' | 'fr',
  roles: string,
  callback: string,
  options: { width?: number; colorScheme?: 'light' | 'dark' } = {},
): Promise<Page> {
  const context = await browser.newContext({
    locale: lang === 'fr' ? 'fr-FR' : 'en-GB',
    viewport: { width: options.width ?? 1280, height: 900 },
    colorScheme: options.colorScheme ?? 'light',
  });
  const page = await context.newPage();
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(callback)}`);
  const l = lang === 'fr' ? LABELS.fr : LABELS.en;
  await page.getByLabel(l.user).fill(`e2e-evidence-${roles}-${stamp}`);
  await page.getByLabel(l.roles, { exact: false }).fill(roles);
  await page.getByRole('button', { name: l.submit }).click();
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

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Pages of a PDF, from its page objects (Chromium writes one `/Type /Page` per page). */
function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length;
}

test.describe('evidence summary (#652)', () => {
  test.describe.configure({ mode: 'serial' });

  let submissionId = '';
  let path = '';
  let gapCodes: string[] = [];

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/v2/evaluation/tasks/${TASK}/submissions`, {
      headers: { Authorization: `Bearer dev:e2e-evidence-participant-${stamp}:participant` },
      data: {
        methodName: 'Workshop model A',
        intent: 'SCORED',
        predictions: predictionsOf(readFileSync(MODEL_A, 'utf8')),
      },
    });
    expect(res.ok(), `submit: ${res.status()} ${await res.text()}`).toBe(true);
    submissionId = ((await res.json()) as { id: string }).id;
    path = `/evaluation/${TASK}/submissions/${submissionId}/evidence`;

    const evidence = await request.get(
      `${API}/v2/evaluation/submissions/${submissionId}/evidence`,
      {
        headers: { Authorization: `Bearer dev:e2e-evidence-api-${stamp}:regulator` },
      },
    );
    expect(evidence.ok()).toBe(true);
    const body = (await evidence.json()) as { gaps: { code: string }[]; modelCard: unknown };
    gapCodes = body.gaps.map((g) => g.code);
    // Today no submission is linked to a model card (#587) and a direct
    // submission is pinned to no method version (#583).
    expect(body.modelCard).toBeNull();
    expect(gapCodes).toEqual(expect.arrayContaining(['NO_MODEL_CARD', 'METHOD_NOT_ATTRIBUTED']));
  });

  test('English: seven sections, and section 6 lists exactly the gaps', async ({ browser }) => {
    const page = await signedInPage(browser, 'en', 'regulator', path);
    await expect(page.getByRole('heading', { level: 1, name: 'Workshop model A' })).toBeVisible();
    for (const title of [
      'Intended use and risk tier',
      'Data',
      'Evaluation method',
      'Performance',
      'Results by subgroup',
      'What this evidence does not show',
      'Trace',
    ]) {
      await expect(
        page.getByRole('heading', { level: 2, name: new RegExp(`${title}$`) }),
      ).toBeVisible();
    }
    const gaps = page.getByRole('list', { name: 'Gaps in this evidence' }).getByRole('listitem');
    await expect(gaps).toHaveCount(gapCodes.length);
    expect(await gaps.evaluateAll((items) => items.map((i) => i.getAttribute('data-gap')))).toEqual(
      gapCodes,
    );
    await expect(gaps.first()).toContainText('No model card is linked to this submission');
    await expect(page.getByText(`This evidence has ${gapCodes.length} gaps`)).toBeVisible();
    // The intervals are not invented for a task kind that has none.
    await expect(page.getByRole('region', { name: 'Performance measures' })).not.toContainText(
      '95% CI',
    );
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/evidence-en-1280.png`, fullPage: true });
    await page.context().close();
  });

  test('French: the same sections and gaps in French', async ({ browser }) => {
    const page = await signedInPage(browser, 'fr', 'regulator', path);
    await expect(page.getByText('Synthèse des preuves', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: /Ce que ces preuves ne montrent pas$/ }),
    ).toBeVisible();
    const gaps = page.getByRole('list', { name: 'Lacunes de ces preuves' }).getByRole('listitem');
    await expect(gaps).toHaveCount(gapCodes.length);
    expect(await gaps.evaluateAll((items) => items.map((i) => i.getAttribute('data-gap')))).toEqual(
      gapCodes,
    );
    await expect(gaps.first()).toContainText(
      'Aucune fiche du modèle n’est liée à cette soumission',
    );
    await expect(page.getByRole('region', { name: 'Mesures de performance' })).toContainText(
      'Exactitude équilibrée',
    );
    // French number format: a decimal comma before the percent sign.
    await expect(page.getByRole('region', { name: 'Mesures de performance' })).toContainText(
      /89,7\s%/,
    );
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/evidence-fr-1280.png`, fullPage: true });
    await page.context().close();
  });

  for (const lang of ['en', 'fr'] as const) {
    test(`prints on two A4 pages (${lang})`, async ({ browser }) => {
      const page = await signedInPage(browser, lang, 'regulator', path);
      await page.emulateMedia({ media: 'print' });
      await expect(page.locator('body > div > header').first()).toBeHidden();
      await expect(
        page.getByRole('button', { name: lang === 'en' ? /print/i : /imprimer/i }),
      ).toBeHidden();
      const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
      if (SHOTS) writeFileSync(`${SHOTS}/evidence-${lang}.pdf`, pdf);
      const pages = pdfPageCount(pdf);
      expect(pages, `printed pages (${lang})`).toBeGreaterThanOrEqual(1);
      expect(pages, `printed pages (${lang})`).toBeLessThanOrEqual(2);
      await page.context().close();
    });
  }

  for (const lang of ['en', 'fr'] as const) {
    for (const width of [375, 1280]) {
      for (const colorScheme of ['light', 'dark'] as const) {
        test(`axe-core clean at ${width} px, ${colorScheme}, ${lang}`, async ({ browser }) => {
          const page = await signedInPage(browser, lang, 'regulator', path, {
            width,
            colorScheme,
          });
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          // The title is streamed with the metadata; axe reads it once it is there.
          await expect(page).toHaveTitle(/Workshop model A/);
          await noAxeViolations(page, `${lang} ${width} ${colorScheme}`);
          if (width === 375) await noHorizontalScroll(page);
          if (SHOTS) {
            await page.screenshot({
              path: `${SHOTS}/evidence-${lang}-${width}-${colorScheme}.png`,
              fullPage: true,
            });
          }
          await page.context().close();
        });
      }
    }
  }

  test('a signed-in user without a reader role is told it is not for them', async ({ browser }) => {
    const page = await signedInPage(browser, 'en', 'annotator', path);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Not available to you' }),
    ).toBeVisible();
    await expect(page.getByText('Workshop model A')).toHaveCount(0);
    await page.context().close();
  });
});

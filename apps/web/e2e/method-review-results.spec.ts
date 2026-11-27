import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { test, expect as baseExpect, type Browser, type Page } from '@playwright/test';
import { ensureLatestVersionDeclared } from './support/declared-method-version';

/**
 * A result moves from provisional to published when the method version it
 * was pinned to is approved in the browser (#583, #649), end to end against
 * the real API, in English and in French. Nothing is mocked.
 *
 * Setup scores the workshop's model A teaching file on the
 * `nih-chestxray14-finding` task of the radiology-workshop seed profile, as a
 * participant. The API pins it to the latest version of the reference
 * predictions method, `oci-predictions-scoring`. Then:
 *
 *   1. The task page shows the result as provisional, with the method
 *      version it was pinned to and no rank, in English and in French.
 *   2. An evaluation reviewer begins the review of that version and approves
 *      it, in the browser.
 *   3. The task page shows the same result as published and ranked.
 *
 * Pre-conditions: Postgres with the migrations, the demo seed and the
 * radiology-workshop profile, the API and the web running (PW_BASE_URL,
 * NEXT_PUBLIC_API_BASE_URL). Run with PW_NO_RESET=1 against a database of
 * your own: this spec records a review decision on the reference method,
 * which nothing undoes. When the method's latest version is no longer
 * DECLARED, an administrator declares the next patch version first, so the
 * spec can run again on the same database.
 */

// Server actions compile on first use under `next dev`.
const expect = baseExpect.configure({ timeout: 15_000 });

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const TASK = 'nih-chestxray14-finding';
const METHOD = 'oci-predictions-scoring';
const stamp = Date.now();
const RESULT = `e2e-pinned-${stamp}`;
const PARTICIPANT = { Authorization: `Bearer dev:e2e-pinned-participant-${stamp}:researcher` };
const REVIEWER = `e2e-pinned-reviewer-${stamp}`;
const RATIONALE =
  'Scoring is a pure function of the predictions and the held-back labels; no participant code runs.';

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

async function signInAs(page: Page, user: string, roles: string, callback: string) {
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(callback)}`);
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles', { exact: false }).fill(roles);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === callback);
}

/** The task page in a language, and the row of this spec's result on it. */
async function resultRow(browser: Browser, lang: 'en' | 'fr') {
  const context = await browser.newContext({ locale: lang === 'fr' ? 'fr-FR' : 'en-GB' });
  const page = await context.newPage();
  await page.goto(`/evaluation/${TASK}`);
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 3, name: new RegExp(RESULT) }) });
  await expect(row).toHaveCount(1);
  return { context, row };
}

const versionRegion = (page: Page, version: string) =>
  page.getByRole('region', { name: new RegExp(`^Version ${version.replace(/\./g, '\\.')}`) });

test.describe('a pinned result moves from provisional to published (#583, #649)', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  let version = '';

  test.beforeAll(async ({ request }) => {
    version = await ensureLatestVersionDeclared(request, METHOD, `e2e-pinned-operator-${stamp}`);

    const submitted = await request.post(`${API}/v2/evaluation/tasks/${TASK}/submissions`, {
      headers: PARTICIPANT,
      data: {
        methodName: RESULT,
        intent: 'SCORED',
        predictions: predictionsOf(readFileSync(MODEL_A, 'utf8')),
      },
    });
    expect(submitted.ok(), `submit: ${submitted.status()} ${await submitted.text()}`).toBe(true);
  });

  test('the task page shows the new result as provisional, with its method version', async ({
    browser,
  }) => {
    const en = await resultRow(browser, 'en');
    await expect(en.row.getByRole('heading', { level: 3 })).not.toContainText('#');
    await expect(en.row.getByRole('link', { name: `${METHOD}@${version}` })).toHaveAttribute(
      'href',
      `/evaluation/routes/${METHOD}`,
    );
    await expect(en.row.getByText('provisional', { exact: true })).toBeVisible();
    await expect(
      en.row.getByText(
        'Provisional: the version of the evaluation method that produced this result is not approved yet',
        { exact: false },
      ),
    ).toBeVisible();
    await en.context.close();

    const fr = await resultRow(browser, 'fr');
    await expect(fr.row.getByRole('heading', { level: 3 })).not.toContainText('#');
    await expect(fr.row.getByText('provisoire', { exact: true })).toBeVisible();
    await expect(fr.row.getByText('n’est pas encore approuvée', { exact: false })).toBeVisible();
    await fr.context.close();
  });

  test('a reviewer begins the review of that version and approves it in the browser', async ({
    page,
  }) => {
    await signInAs(page, REVIEWER, 'evaluation-reviewer', `/evaluation/routes/${METHOD}`);

    let block = versionRegion(page, version);
    await block.getByRole('radio', { name: /^Begin the review\./ }).check();
    await block.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: `Begin the review of version ${version}` }).click();
    await expect(page.getByRole('status').filter({ hasText: 'is now under review' })).toBeVisible();

    block = versionRegion(page, version);
    await block.getByRole('radio', { name: /^Approve\./ }).check();
    await block.getByLabel(/^Rationale/).fill(RATIONALE);
    await block.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: `Approve version ${version}` }).click();
    await expect(page.getByRole('status').filter({ hasText: 'is now approved' })).toBeVisible();
  });

  test('the task page shows the same result as published and ranked', async ({ browser }) => {
    const en = await resultRow(browser, 'en');
    await expect(en.row.getByRole('heading', { level: 3 })).toContainText('#');
    await expect(en.row.getByText('published', { exact: true })).toBeVisible();
    await expect(en.row.getByText('provisional', { exact: true })).toHaveCount(0);
    await en.context.close();

    const fr = await resultRow(browser, 'fr');
    await expect(fr.row.getByRole('heading', { level: 3 })).toContainText('#');
    await expect(fr.row.getByText('publié', { exact: true })).toBeVisible();
    await fr.context.close();
  });
});

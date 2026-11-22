import { readFileSync } from 'node:fs';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Diagnostic-accuracy scoring for a binary finding (#650), end to end against
 * the real API. Nothing is mocked.
 *
 * Setup creates a BINARY_DIAGNOSTIC task with ten items (five positive, five
 * negative) and a CLASSIFICATION task, through the API as a host. Then:
 *
 *   1. The task page states the positive class in words.
 *   2. The template carries an optional score column.
 *   3. A file with a score on every line is checked (the check says an AUC
 *      will follow), submitted, and its page names every metric in full with
 *      its 95% interval, the counts table and the AUC.
 *   4. A file with one score missing is scored without an AUC, and says why.
 *   5. The task page row shows the rates with their intervals.
 *   6. A classification task keeps refusing a score column in the browser.
 *   7. axe-core on the binary task page and result page: no violations.
 *
 * Pre-conditions: Postgres + API + web running. `global-setup` removes
 * `e2e-eval-*` tasks between runs.
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const stamp = Date.now();
const BINARY = `e2e-eval-binary-${stamp}`;
const NOMINAL = `e2e-eval-nominal-${stamp}`;
const PARTICIPANT = `e2e-binary-participant-${stamp}`;
const POSITIVE = 'Nodule present';

const TRUTH = {
  p1: 1,
  p2: 1,
  p3: 1,
  p4: 1,
  p5: 1,
  n1: 0,
  n2: 0,
  n3: 0,
  n4: 0,
  n5: 0,
};

/**
 * p5 is missed and n1 is flagged: TP 4, FN 1, FP 1, TN 4. Scores rank every
 * positive above every negative except p5 (0.4) below n1 (0.6): 24 of the 25
 * positive-negative pairs are ordered correctly, so AUC = 0.96.
 */
const SCORED_FILE = [
  'item_id,label,score',
  'p1,1,0.95',
  'p2,1,0.9',
  'p3,1,0.8',
  'p4,1,0.7',
  'p5,0,0.4',
  'n1,1,0.6',
  'n2,0,0.3',
  'n3,0,0.2',
  'n4,0,0.1',
  'n5,0,0.05',
].join('\n');

/** The same labels with n5's score left empty: no AUC. */
const PARTLY_SCORED_FILE = SCORED_FILE.replace('n5,0,0.05', 'n5,0,');

const csv = (name: string, text: string) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(text, 'utf8'),
});

async function createTask(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await request.post(`${API}/v2/evaluation/tasks`, {
    headers: { Authorization: 'Bearer dev:e2e-eval-host:host' },
    data: body,
  });
  expect(res.ok(), `create task ${String(body.slug)}: ${res.status()}`).toBe(true);
}

async function signInAs(page: Page, user: string, roles: string, callback: string) {
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(callback)}`);
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles', { exact: false }).fill(roles);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === callback);
}

/** The value, and the interval line under it, of one metric on the submission page. */
function metricOf(page: Page, label: string) {
  const dd = page
    .locator('dt', { hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`) })
    .locator('xpath=following-sibling::dd[1]');
  return { value: dd.locator('span').first(), all: dd };
}

test.describe('binary-finding scoring (#650)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    await createTask(request, {
      slug: NOMINAL,
      name: 'E2E nominal task',
      datasetSlug: 'e2e-eval-dataset',
      taskKind: 'CLASSIFICATION',
      numClasses: 2,
      referableThreshold: 1,
      groundTruth: { a: 0, b: 1 },
    });
    await createTask(request, {
      slug: BINARY,
      name: 'E2E nodule present or absent',
      datasetSlug: 'e2e-eval-dataset',
      taskKind: 'BINARY_DIAGNOSTIC',
      numClasses: 2,
      referableThreshold: 1,
      positiveClassName: POSITIVE,
      groundTruth: TRUTH,
    });
  });

  test('the task page states the positive class, and the template has a score column', async ({
    page,
  }) => {
    await page.goto(`/evaluation/${BINARY}`);
    await expect(page.getByText('Binary finding').first()).toBeVisible();
    await expect(page.getByText('Positive class', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        `${POSITIVE}, written as label 1. Sensitivity and the positive predictive value are about this class.`,
      ),
    ).toBeVisible();
    // No ordinal vocabulary on a binary task.
    await expect(page.getByText('Referable threshold', { exact: true })).toHaveCount(0);

    await page.goto(`/evaluation/${BINARY}/submit`);
    await expect(page.getByText(`(${POSITIVE})`, { exact: false }).first()).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download template', exact: true }).click(),
    ]);
    const template = readFileSync(await download.path(), 'utf8');
    expect(template.split('\r\n')[0]).toBe('item_id,label,score');
    expect(template.split('\r\n')[1]).toBe('n1,,');
  });

  test('a fully scored file: rates with intervals, counts and AUC', async ({ page }) => {
    await signInAs(page, PARTICIPANT, 'researcher', `/evaluation/${BINARY}/submit`);

    await page.getByLabel('Method name').fill('E2E scored reader');
    await page.getByLabel('Predictions file').setInputFiles(csv('scored.csv', SCORED_FILE));
    await page.getByRole('button', { name: 'Check format' }).click();
    const result = page.locator('#submit-result');
    await expect(result.getByRole('heading', { name: 'The format is valid' })).toBeVisible();
    await expect(result).toContainText(
      'Every matched line has a score, so the result can include an AUC: it is reported when the scored items include both positive and negative cases.',
    );

    await page.getByRole('button', { name: 'Submit for scoring' }).click();
    await expect(page).toHaveURL(new RegExp(`/evaluation/${BINARY}/submissions/[0-9a-f-]{36}$`));

    // Every rate named in full, with its interval and what it rests on.
    // Wilson 95% for 4/5 is [0.3755, 0.9638]; for 8/10 [0.4902, 0.9433];
    // for 5/10 [0.2366, 0.7634].
    const sensitivity = metricOf(page, 'Sensitivity');
    await expect(sensitivity.value).toHaveText('80%');
    await expect(sensitivity.all).toContainText('95% CI 37.6% to 96.4%');
    await expect(sensitivity.all).toContainText('4 of 5');
    await expect(metricOf(page, 'Specificity').all).toContainText('95% CI 37.6% to 96.4%');
    await expect(metricOf(page, 'Positive predictive value').value).toHaveText('80%');
    await expect(metricOf(page, 'Negative predictive value').value).toHaveText('80%');
    await expect(metricOf(page, 'Accuracy').all).toContainText('95% CI 49% to 94.3%');
    await expect(metricOf(page, 'Prevalence').all).toContainText('95% CI 23.7% to 76.3%');
    await expect(metricOf(page, 'Balanced accuracy').value).toHaveText('80%');

    const auc = metricOf(page, 'Area under the ROC curve (AUC)');
    await expect(auc.value).toHaveText('0.960');
    await expect(auc.all).toContainText('95% CI');
    await expect(auc.all).toContainText('2,000 bootstrap resamples');

    // The counts table, with the positive class named on both axes.
    await expect(page.getByRole('heading', { level: 2, name: 'Counts' })).toBeVisible();
    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText([`Positive: ${POSITIVE}`, 'Negative']);
    await expect(table.getByRole('row').nth(1).getByRole('cell')).toHaveText([
      '4True positives',
      '1False negatives',
    ]);
    await expect(table.getByRole('row').nth(2).getByRole('cell')).toHaveText([
      '1False positives',
      '4True negatives',
    ]);

    // The task card on the same page states the positive class too.
    await expect(page.getByText('Positive class', { exact: true })).toBeVisible();
  });

  test('one missing score: scored, but no AUC, and the page says why', async ({ page }) => {
    await signInAs(page, PARTICIPANT, 'researcher', `/evaluation/${BINARY}/submit`);

    await page.getByLabel('Method name').fill('E2E partly scored');
    await page.getByLabel('Predictions file').setInputFiles(csv('partly.csv', PARTLY_SCORED_FILE));
    await page.getByRole('button', { name: 'Check format' }).click();
    await expect(page.locator('#submit-result')).toContainText(
      '1 matched line has no score, so the result will not include an AUC.',
    );
    await page.getByRole('button', { name: 'Submit for scoring' }).click();
    await expect(page).toHaveURL(new RegExp(`/evaluation/${BINARY}/submissions/[0-9a-f-]{36}$`));

    const auc = metricOf(page, 'Area under the ROC curve (AUC)');
    await expect(auc.value).toHaveText('Not reported');
    await expect(auc.all).toContainText('AUC needs a score for every scored item');
    // The rates are unaffected by the missing score.
    await expect(metricOf(page, 'Sensitivity').value).toHaveText('80%');
  });

  test('the task page row shows the rates with their intervals', async ({ page }) => {
    await page.goto(`/evaluation/${BINARY}`);
    const results = page.getByRole('list', { name: 'Submissions, best first' });
    // Both files tie on balanced accuracy (80%), so find the row by its name
    // rather than its position.
    const row = results
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: 'E2E scored reader' }) });
    await expect(row).toContainText('Sensitivity');
    await expect(row).toContainText('Positive predictive value');
    await expect(row).toContainText('95% CI 37.6% to 96.4%');
    await expect(row).toContainText('0.960');
    const partly = results
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: 'E2E partly scored' }) });
    await expect(partly).toContainText('Not reported');
    await expect(page.getByText(/Ordered best first by balanced accuracy/)).toBeVisible();
  });

  test('a classification task keeps refusing a score column in the browser', async ({ page }) => {
    await page.goto(`/evaluation/${NOMINAL}/submit`);
    await page
      .getByLabel('Predictions file')
      .setInputFiles(csv('with-score.csv', 'item_id,label,score\na,0,0.2\nb,1,0.9\n'));
    await page.getByRole('button', { name: 'Check format' }).click();
    await expect(page.locator('#submit-result')).toContainText(
      'A score column is not accepted for this task: it takes one whole-number label per item.',
    );
  });

  test('axe: no violations on the binary task page and result page', async ({ page }) => {
    const scan = async () =>
      (await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()).violations.map((v) => v.id);

    await page.goto(`/evaluation/${BINARY}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Results' })).toBeVisible();
    expect(await scan()).toEqual([]);

    await page.getByRole('link', { name: 'E2E scored reader' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Counts' })).toBeVisible();
    expect(await scan()).toEqual([]);

    await page.goto(`/evaluation/${BINARY}/submit`);
    expect(await scan()).toEqual([]);
  });
});

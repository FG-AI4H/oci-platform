import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Results by subgroup with small-cell suppression (#410), end to end against
 * the real API. Nothing is mocked.
 *
 * Setup creates a CLASSIFICATION task of 60 items that declares three fields
 * (age band, sex, site) through the API as a host, and scores two files that
 * have the SAME overall accuracy (90%): file A spreads its six errors, file B
 * puts all six in the 60-and-over band. Then:
 *
 *   1. The task page names the subgroup fields, links each result to its
 *      breakdown and offers a comparison.
 *   2. File B's page shows the drop in the 60-and-over band against the
 *      whole-set row, and withholds the small site and its complement.
 *   3. The comparison page puts A and B side by side with the difference.
 *   4. axe-core on the submission and comparison pages, at 375 px and at
 *      1280 px: no violations. Nothing overflows the page at 375 px.
 *
 * Pre-conditions: Postgres + API + web running. Run with PW_NO_RESET=1 when
 * the database is not the shared local one (#760).
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SHOTS = process.env.PW_SUBGROUP_SHOTS;

const stamp = Date.now();
const TASK = `e2e-eval-subgroups-${stamp}`;
const HOST = 'Bearer dev:e2e-eval-host:host';

const ids = Array.from({ length: 60 }, (_, i) => `img${String(i).padStart(2, '0')}`);
const labelOf = (i: number) => (i % 3 === 0 ? 1 : 0);
const truth = Object.fromEntries(ids.map((id, i) => [id, labelOf(i)]));
/** Site C (4 items) is too small; site B goes with it so C is not A's complement. */
const site = (i: number) => (i < 30 ? 'A' : i < 56 ? 'B' : 'C');
const values = Object.fromEntries(
  ids.map((id, i) => [
    id,
    { ageBand: i < 40 ? '<60' : '60+', sex: i % 2 === 0 ? 'F' : 'M', site: site(i) },
  ]),
);

/** Six errors each: A's spread across both bands, B's all aged 60 and over. */
const A_WRONG = new Set([0, 10, 20, 30, 45, 55]);
const B_WRONG = new Set([40, 42, 44, 46, 48, 50]);
const fileOf = (wrong: Set<number>) =>
  ids.map((id, i) => ({ imageId: id, grade: wrong.has(i) ? 1 - labelOf(i) : labelOf(i) }));

async function api(request: APIRequestContext, path: string, data: unknown, auth: string) {
  const res = await request.post(`${API}${path}`, { headers: { Authorization: auth }, data });
  expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return res.json() as Promise<{ id: string }>;
}

async function noAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('results by subgroup (#410)', () => {
  test.describe.configure({ mode: 'serial' });

  let submissionA = '';
  let submissionB = '';

  test.beforeAll(async ({ request }) => {
    await api(
      request,
      '/v2/evaluation/tasks',
      {
        slug: TASK,
        name: 'E2E finding by subgroup',
        datasetSlug: 'e2e-eval-dataset',
        taskKind: 'CLASSIFICATION',
        numClasses: 2,
        referableThreshold: 1,
        groundTruth: truth,
        subgroups: {
          fields: [
            {
              key: 'ageBand',
              label: 'Age band',
              values: [
                { value: '<60', label: 'Under 60' },
                { value: '60+', label: '60 and over' },
              ],
            },
            {
              key: 'sex',
              label: 'Sex',
              values: [
                { value: 'F', label: 'Female' },
                { value: 'M', label: 'Male' },
              ],
            },
            {
              key: 'site',
              label: 'Site',
              values: ['A', 'B', 'C'].map((v) => ({ value: v, label: `Site ${v}` })),
            },
          ],
          values,
        },
      },
      HOST,
    );
    submissionA = (
      await api(
        request,
        `/v2/evaluation/tasks/${TASK}/submissions`,
        { methodName: 'Model A', predictions: fileOf(A_WRONG) },
        `Bearer dev:e2e-subgroups-a-${stamp}:researcher`,
      )
    ).id;
    submissionB = (
      await api(
        request,
        `/v2/evaluation/tasks/${TASK}/submissions`,
        { methodName: 'Model B', predictions: fileOf(B_WRONG) },
        `Bearer dev:e2e-subgroups-b-${stamp}:researcher`,
      )
    ).id;
  });

  test('the task page names the fields, links each result to its breakdown and offers a comparison', async ({
    page,
  }) => {
    await page.goto(`/evaluation/${TASK}`);
    await expect(page.getByText('Subgroups', { exact: true })).toBeVisible();
    await expect(
      page.getByText(/Results are also reported by age band, sex, site\./),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /^Results by subgroup\s*: Model B$/ }),
    ).toHaveAttribute('href', `/evaluation/${TASK}/submissions/${submissionB}#subgroups`);
    await expect(
      page.getByRole('heading', { name: 'Compare two results by subgroup' }),
    ).toBeVisible();
  });

  test('file B’s page shows the drop for patients aged 60 and over, and withholds the small site', async ({
    page,
  }) => {
    await page.goto(`/evaluation/${TASK}/submissions/${submissionB}`);
    await expect(
      page.getByRole('heading', { name: 'Results by subgroup', level: 2 }),
    ).toBeVisible();

    const band = page.getByRole('region', { name: 'Results by age band' });
    const row = (name: string) =>
      band.getByRole('row').filter({ has: page.getByRole('rowheader', { name }) });
    // Columns: Macro F1, Accuracy, Balanced accuracy, Items.
    await expect(row('All scored items').getByRole('cell').nth(1)).toHaveText('90%');
    await expect(row('Under 60').getByRole('cell').nth(1)).toHaveText('100%');
    await expect(row('60 and over').getByRole('cell').nth(1)).toHaveText('70%');
    await expect(row('60 and over').getByRole('cell').nth(3)).toHaveText('20');

    const sites = page.getByRole('region', { name: 'Results by site' });
    await expect(sites.getByRole('row').filter({ hasText: 'Site A' })).toContainText('30');
    for (const s of ['Site B', 'Site C']) {
      const r = sites.getByRole('row').filter({ hasText: s });
      await expect(r).toContainText('Not reported');
      // No count and no figure for a withheld site, not even for screen readers.
      await expect(r).not.toContainText('%');
      await expect(r).not.toContainText(/\b(26|4)\b/);
    }
    await expect(
      page.getByText(/Groups with fewer than 11 scored items are not reported/),
    ).toBeVisible();

    // File A, the same overall figure, is even across the bands.
    await page.goto(`/evaluation/${TASK}/submissions/${submissionA}#subgroups`);
    const bandA = page.getByRole('region', { name: 'Results by age band' });
    await expect(
      bandA
        .getByRole('row')
        .filter({ has: page.getByRole('rowheader', { name: '60 and over' }) })
        .getByRole('cell')
        .nth(1),
    ).toHaveText('90%');
  });

  test('the comparison puts A and B side by side, group by group', async ({ page }) => {
    await page.goto(`/evaluation/${TASK}`);
    await page.getByLabel('First result').selectOption(submissionA);
    await page.getByLabel('Second result').selectOption(submissionB);
    await page.getByRole('button', { name: 'Compare by subgroup' }).click();
    await page.waitForURL((url) => url.pathname === `/evaluation/${TASK}/compare`);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Model A and Model B');
    await page.getByRole('link', { name: 'Accuracy', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Accuracy', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const band = page.getByRole('region', { name: 'Results by age band: Accuracy' });
    const sixty = band
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: '60 and over' }) });
    await expect(sixty.getByRole('cell')).toHaveText(['90%', '70%', '-20 pts']);
    const all = band
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: 'All scored items' }) });
    await expect(all.getByRole('cell')).toHaveText(['90%', '90%', '0 pts']);
    await expect(
      page
        .getByRole('region', { name: 'Results by site: Accuracy' })
        .getByRole('row')
        .filter({ hasText: 'Site C' }),
    ).toContainText('Not reported');
  });

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 800 },
  ]) {
    test(`no axe violations and no page overflow at ${viewport.width} px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      for (const [name, path] of [
        ['submission', `/evaluation/${TASK}/submissions/${submissionB}`],
        [
          'compare',
          `/evaluation/${TASK}/compare?a=${submissionA}&b=${submissionB}&metric=accuracy`,
        ],
        ['task', `/evaluation/${TASK}`],
      ] as const) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await noAxeViolations(page);
        await noHorizontalScroll(page);
        if (SHOTS) {
          if (name === 'submission') await page.locator('#subgroups').scrollIntoViewIfNeeded();
          await page.screenshot({
            path: `${SHOTS}/subgroups-${name}-${viewport.width}.png`,
            fullPage: true,
          });
        }
      }
    });
  }
});

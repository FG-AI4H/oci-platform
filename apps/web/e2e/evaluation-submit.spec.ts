import { readFileSync } from 'node:fs';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Submitting predictions from the browser and reading the result (#645),
 * end to end against the real API. Nothing is mocked.
 *
 * Setup creates two tasks through the API as a host — one grading, one
 * classification — each with six items and known reference labels, so every
 * number asserted below was worked out by hand. Then:
 *
 *   1. Signed out: the format check works and names duplicate, unknown and
 *      missing identifiers; there is no way to submit, only to sign in.
 *   2. Signed in: download the template, see a malformed file refused next to
 *      the file field with the method name kept, check a good file, submit it
 *      without choosing it again, and read the scores on its own page.
 *   3. The browser never talks to the API and never holds the token.
 *   4. A classification result carries its per-class table.
 *   5. A failed attempt is shown to its submitter and is a 404 for anyone else.
 *   6. "Grades" and "Referable threshold" appear on the grading task only.
 *   7. axe-core on both new pages: no violations.
 *
 * Pre-conditions: Postgres + API + web running. `global-setup` removes
 * `e2e-eval-*` tasks (and, by cascade, their submissions) between runs.
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const stamp = Date.now();
const GRADING = `e2e-eval-grading-${stamp}`;
const CLASSES = `e2e-eval-classes-${stamp}`;
const PARTICIPANT = `e2e-participant-${stamp}`;
/** The local sign-in stub's token for the participant; never expected in a page. */
const PARTICIPANT_TOKEN = `dev:${PARTICIPANT}:researcher`;

const GRADING_TRUTH = { e2e_01: 0, e2e_02: 1, e2e_03: 1, e2e_04: 0, e2e_05: 1, e2e_06: 0 };
const CLASSES_TRUTH = { c_01: 0, c_02: 1, c_03: 2, c_04: 1, c_05: 0, c_06: 2 };

/** One mistake (e2e_03) and one item left out (e2e_06). */
const GRADING_FILE = 'item_id,label\ne2e_01,0\ne2e_02,1\ne2e_03,0\ne2e_04,0\ne2e_05,1\n';
/** One mistake: c_03 is class 2 and is given 1. Semicolons, as a spreadsheet may save it. */
const CLASSES_FILE = 'item_id;label\nc_01;0\nc_02;1\nc_03;1\nc_04;1\nc_05;0\nc_06;2\n';

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

async function submissionCount(request: APIRequestContext, slug: string): Promise<number> {
  const res = await request.get(`${API}/v2/evaluation/tasks/${slug}`);
  const task = (await res.json()) as { submissions: unknown[] };
  return task.submissions.length;
}

test.describe('submit predictions from the browser (#645)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    // Classification first, so the grading task is the newest and heads the list.
    await createTask(request, {
      slug: CLASSES,
      name: 'E2E three findings',
      datasetSlug: 'e2e-eval-dataset',
      taskKind: 'CLASSIFICATION',
      numClasses: 3,
      referableThreshold: 1,
      groundTruth: CLASSES_TRUTH,
    });
    await createTask(request, {
      slug: GRADING,
      name: 'E2E finding present or absent',
      datasetSlug: 'e2e-eval-dataset',
      taskKind: 'GRADING',
      numClasses: 2,
      referableThreshold: 1,
      groundTruth: GRADING_TRUTH,
    });
  });

  test('signed out: the format check works, lists the identifiers, and stores nothing', async ({
    page,
    request,
  }) => {
    await page.goto(`/evaluation/${GRADING}/submit`);
    await expect(page.getByRole('heading', { level: 1, name: 'Submit predictions' })).toBeVisible();

    // No way to submit for scoring without an account — only to sign in.
    await expect(page.getByRole('button', { name: 'Submit for scoring' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sign in to submit for scoring' })).toBeVisible();
    await expect(page.getByText('Checking the format needs no account.')).toBeVisible();

    // e2e_01 twice, an identifier the task does not have, a label out of range,
    // and four items left out.
    await page
      .getByLabel('Predictions file')
      .setInputFiles(csv('draft.csv', 'item_id,label\ne2e_01,0\ne2e_01,1\nnot_mine,1\ne2e_02,5\n'));
    await page.getByRole('button', { name: 'Check format' }).click();

    const result = page.locator('#submit-result');
    await expect(
      result.getByRole('heading', { name: 'The file has 3 problems to fix' }),
    ).toBeVisible();

    const section = (title: string) =>
      result.locator('section').filter({ has: page.getByRole('heading', { name: title }) });
    await expect(
      section('Identifiers that appear more than once').getByRole('listitem'),
    ).toHaveText(['e2e_01']);
    await expect(section('Identifiers this task does not have').getByRole('listitem')).toHaveText([
      'not_mine',
    ]);
    await expect(section('Labels outside the range of this task').getByRole('listitem')).toHaveText(
      ['e2e_02'],
    );
    await expect(section('Labels outside the range of this task')).toContainText(
      'A label is a whole number from 0 to 1.',
    );
    // Items left out are allowed: said outside the list of problems, folded.
    const leftOut = result.locator('details');
    await expect(leftOut.locator('summary')).toHaveText(
      '4 items have no prediction. That is allowed.',
    );
    await expect(leftOut.getByRole('listitem').first()).toBeHidden();
    await leftOut.locator('summary').click();
    await expect(leftOut.getByRole('listitem')).toHaveText([
      'e2e_03',
      'e2e_04',
      'e2e_05',
      'e2e_06',
    ]);

    // A good file passes, still without an account.
    await page.getByLabel('Predictions file').setInputFiles(csv('good.csv', GRADING_FILE));
    // The earlier verdict was about the other file and is gone at once.
    await expect(result.getByRole('heading')).toHaveCount(0);
    await page.getByRole('button', { name: 'Check format' }).click();
    await expect(result.getByRole('heading', { name: 'The format is valid' })).toBeVisible();
    await expect(result).toContainText('5 lines read, matching 5 of the 6 items in this task.');
    await expect(result).toContainText('Sign in to submit this file for scoring.');

    // Checking wrote nothing: the task still has no submission.
    expect(await submissionCount(request, GRADING)).toBe(0);
  });

  test('signed in: template, malformed file, check, submit, read the scores', async ({
    page,
    request,
  }) => {
    // Every request the browser makes during the flow, to check afterwards
    // that none went to the API and none carried a bearer token.
    const browserRequests: { url: string; authorization: string | undefined }[] = [];
    page.on('request', (r) => {
      browserRequests.push({ url: r.url(), authorization: r.headers().authorization });
    });

    await signInAs(page, PARTICIPANT, 'researcher', `/evaluation/${GRADING}`);

    // From the task page to the form.
    await page.getByRole('link', { name: 'Submit predictions' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/evaluation/${GRADING}/submit$`));

    // Nothing spent yet — the signed-out checks above cost nothing either.
    await expect(page.locator('#quota-note')).toContainText(
      '3 of 3 scored submissions left this week.',
    );
    await expect(page.locator('#quota-note')).toContainText('10 of 10 left on this task in total.');

    // 1. The template: the header and one unlabelled line per item.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download template', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${GRADING}-predictions-template.csv`);
    const template = readFileSync(await download.path(), 'utf8');
    expect(template).toBe(
      'item_id,label\r\ne2e_01,\r\ne2e_02,\r\ne2e_03,\r\ne2e_04,\r\ne2e_05,\r\ne2e_06,\r\n',
    );

    // 2. A malformed file — the template sent back with one label typed and
    //    one mistyped — is refused next to the file field; the name stays.
    const methodName = page.getByLabel('Method name');
    const fileInput = page.getByLabel('Predictions file');
    await methodName.fill('E2E first reading');
    await fileInput.setInputFiles(
      csv(
        'unfinished.csv',
        template.replace('e2e_01,', 'e2e_01,1').replace('e2e_02,', 'e2e_02,yes'),
      ),
    );
    await page.getByRole('button', { name: 'Submit for scoring' }).click();

    const result = page.locator('#submit-result');
    await expect(
      result.getByRole('heading', {
        name: 'The file could not be read. Nothing was sent for scoring.',
      }),
    ).toBeVisible();
    await expect(result.getByRole('listitem')).toHaveText([
      'Line 3: The label for "e2e_02" must be a whole number such as 0 or 1. Found: yes',
      'Line 4: No label for "e2e_03".',
      'Line 5: No label for "e2e_04".',
      'Line 6: No label for "e2e_05".',
      'Line 7: No label for "e2e_06".',
    ]);
    // What to do about an empty label is said once, not on every line.
    await expect(
      result.getByText(
        'Where a label is missing, type it in, or delete the line to leave that item out.',
      ),
    ).toHaveCount(1);
    // The error is tied to the field it is about, and sits right under it.
    await expect(page.locator('#field-file-err')).toHaveText('There are 5 problems in this file.');
    await expect(fileInput).toHaveAttribute('aria-describedby', 'field-file-err submit-result');
    const fieldBox = await fileInput.boundingBox();
    const resultBox = await result.boundingBox();
    expect(resultBox!.y).toBeGreaterThan(fieldBox!.y);
    expect(resultBox!.y - (fieldBox!.y + fieldBox!.height)).toBeLessThan(80);

    await expect(methodName).toHaveValue('E2E first reading');
    await expect(page).toHaveURL(new RegExp(`/evaluation/${GRADING}/submit$`));
    expect(await submissionCount(request, GRADING)).toBe(0);

    // 3. A good file: check it…
    await fileInput.setInputFiles(csv('reading.csv', GRADING_FILE));
    await page.getByRole('button', { name: 'Check format' }).click();
    await expect(result.getByRole('heading', { name: 'The format is valid' })).toBeVisible();
    await expect(result).toContainText('You can submit this file for scoring.');
    await expect(methodName).toHaveValue('E2E first reading');

    // …then submit it, without choosing the file again.
    await page.getByRole('button', { name: 'Submit for scoring' }).click();
    await expect(page).toHaveURL(new RegExp(`/evaluation/${GRADING}/submissions/[0-9a-f-]{36}$`));

    // 4. The result page. true = 0,1,1,0,1 against sent = 0,1,0,0,1 over the
    //    five items sent: 4 of 5 exact; of the 3 referable, 2 found; both
    //    non-referable right; kappa = 1 − 1/2.6; 5 of the task's 6 items.
    await expect(page.getByRole('heading', { level: 1, name: 'E2E first reading' })).toBeVisible();
    await expect(page.getByText('scored', { exact: true })).toBeVisible();
    await expect(page.getByText('This is your submission.')).toBeVisible();

    const metric = (label: string) =>
      page
        .locator('dt', { hasText: new RegExp(`^${label}$`) })
        .locator('xpath=following-sibling::dd[1]/span[1]');
    await expect(metric('QWK')).toHaveText('0.615');
    await expect(metric('Accuracy')).toHaveText('80%');
    await expect(metric('Referable sensitivity')).toHaveText('66.7%');
    await expect(metric('Referable specificity')).toHaveText('100%');
    await expect(metric('Coverage')).toHaveText('83.3%');

    // The submission is pinned to the version of the reference predictions
    // method that serves it (#583), with that version's review status:
    // provisional on a fresh database, published once someone approved it.
    await expect(page.getByRole('heading', { level: 2, name: 'Evaluation method' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'oci-predictions-scoring' })).toHaveAttribute(
      'href',
      '/evaluation/routes/oci-predictions-scoring',
    );
    await expect(page.getByText(/^(provisional|published)$/)).toBeVisible();
    // A grading task has no per-class figures, so no such table is drawn.
    await expect(page.getByRole('heading', { name: 'Per-class results' })).toHaveCount(0);

    const submissionUrl = page.url();

    // 5. The task page lists it under its method name, linked to its page.
    await page.getByRole('link', { name: 'E2E finding present or absent' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/evaluation/${GRADING}$`));
    const row = page
      .getByRole('list', { name: 'Submissions, best first' })
      .getByRole('link', { name: 'E2E first reading' });
    await expect(row).toHaveAttribute('href', new URL(submissionUrl).pathname);

    // 6. One scored submission is used; the two refused files cost nothing.
    await page.goto(`/evaluation/${GRADING}/submit`);
    await expect(page.locator('#quota-note')).toContainText(
      '2 of 3 scored submissions left this week.',
    );
    expect(await submissionCount(request, GRADING)).toBe(1);

    // 7. The browser spoke to the web origin only, and never sent a token.
    const apiOrigin = new URL(API).origin;
    const webOrigin = new URL(page.url()).origin;
    expect(apiOrigin).not.toBe(webOrigin);
    expect(browserRequests.filter((r) => new URL(r.url).origin === apiOrigin)).toEqual([]);
    expect(browserRequests.filter((r) => r.authorization !== undefined)).toEqual([]);
    expect(await page.content()).not.toContain(PARTICIPANT_TOKEN);
  });

  test('a classification result carries its per-class table', async ({ page }) => {
    await signInAs(page, PARTICIPANT, 'researcher', `/evaluation/${CLASSES}/submit`);

    // The quota is per task: untouched here by the submission above.
    await expect(page.locator('#quota-note')).toContainText(
      '3 of 3 scored submissions left this week.',
    );

    await page.getByLabel('Method name').fill('E2E three-class model');
    await page.getByLabel('Predictions file').setInputFiles(csv('classes.csv', CLASSES_FILE));
    await page.getByRole('button', { name: 'Submit for scoring' }).click();
    await expect(page).toHaveURL(new RegExp(`/evaluation/${CLASSES}/submissions/[0-9a-f-]{36}$`));

    await expect(page.getByRole('heading', { level: 2, name: 'Per-class results' })).toBeVisible();
    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText([
      'Class',
      'Precision',
      'Recall',
      'F1',
      'Items',
    ]);
    // Class 1 was given to c_02, c_03 and c_04; two of those are class 1, and
    // both class-1 items were found.
    await expect(table.getByRole('row').nth(1).getByRole('cell')).toHaveText([
      '100%',
      '100%',
      '100%',
      '2',
    ]);
    await expect(table.getByRole('row').nth(2).getByRole('cell')).toHaveText([
      '66.7%',
      '100%',
      '80%',
      '2',
    ]);
    await expect(table.getByRole('row').nth(3).getByRole('cell')).toHaveText([
      '100%',
      '50%',
      '66.7%',
      '2',
    ]);

    // The ordinal vocabulary stays off a classification result…
    await expect(page.getByText('QWK', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Referable threshold', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Grades', { exact: true })).toHaveCount(0);

    // …and off its task page, which says "Classes" instead.
    await page.goto(`/evaluation/${CLASSES}`);
    await expect(page.getByRole('heading', { level: 2, name: 'About this task' })).toBeVisible();
    await expect(page.getByText('Classes', { exact: true })).toBeVisible();
    await expect(page.getByText('Referable threshold', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Grades', { exact: true })).toHaveCount(0);

    // The grading task keeps both.
    await page.goto(`/evaluation/${GRADING}`);
    await expect(page.getByText('Grades', { exact: true })).toBeVisible();
    await expect(page.getByText('Referable threshold', { exact: true })).toBeVisible();
  });

  test('a failed attempt is shown to its submitter and to nobody else', async ({
    page,
    browser,
    request,
  }) => {
    // The form never sends a file with a format error for scoring, so the
    // failed attempt is made the way a script would: straight to the API.
    const res = await request.post(`${API}/v2/evaluation/tasks/${GRADING}/submissions`, {
      headers: { Authorization: `Bearer ${PARTICIPANT_TOKEN}` },
      data: {
        methodName: 'E2E scripted attempt',
        predictions: [
          { imageId: 'e2e_01', grade: 0 },
          { imageId: 'e2e_01', grade: 1 },
        ],
      },
    });
    expect(res.status()).toBe(400);
    const { submissionId } = (await res.json()) as { submissionId: string };
    const path = `/evaluation/${GRADING}/submissions/${submissionId}`;

    // Its submitter sees it, with the reason, and it cost nothing.
    await signInAs(page, PARTICIPANT, 'researcher', path);
    await expect(
      page.getByRole('heading', { level: 1, name: 'E2E scripted attempt' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This file was not scored' })).toBeVisible();
    await expect(page.getByText('duplicate imageId "e2e_01" in predictions')).toBeVisible();
    await expect(
      page.getByText('This attempt did not count as a scored submission.', { exact: false }),
    ).toBeVisible();
    await page.goto(`/evaluation/${GRADING}/submit`);
    await expect(page.locator('#quota-note')).toContainText(
      '2 of 3 scored submissions left this week.',
    );

    // The task page lists the attempt but does not link to a page most
    // readers could not open.
    await page.goto(`/evaluation/${GRADING}`);
    const results = page.getByRole('list', { name: 'Submissions, best first' });
    await expect(results.getByText('E2E scripted attempt')).toBeVisible();
    await expect(results.getByRole('link', { name: 'E2E scripted attempt' })).toHaveCount(0);

    // Signed out, and signed in as someone else: not found.
    const anonymous = await browser.newContext();
    const anonymousPage = await anonymous.newPage();
    expect((await anonymousPage.goto(path))?.status()).toBe(404);
    await anonymous.close();

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signInAs(otherPage, `e2e-other-${stamp}`, 'researcher', `/evaluation/${GRADING}`);
    expect((await otherPage.goto(path))?.status()).toBe(404);
    await other.close();
  });

  test('an unknown submission id is a 404', async ({ page }) => {
    const missing = await page.goto(
      `/evaluation/${GRADING}/submissions/00000000-0000-4000-8000-000000000000`,
    );
    expect(missing?.status()).toBe(404);
    const malformed = await page.goto(`/evaluation/${GRADING}/submissions/not-an-id`);
    expect(malformed?.status()).toBe(404);
  });

  test('axe: no violations on the submit page or the submission page', async ({ page }) => {
    await signInAs(page, PARTICIPANT, 'researcher', `/evaluation/${GRADING}/submit`);

    const scan = async () =>
      (await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()).violations.map((v) => v.id);

    // The form as it first appears.
    expect(await scan()).toEqual([]);

    // With a refused file and its list of problems on screen.
    await page.getByLabel('Method name').fill('E2E axe');
    await page
      .getByLabel('Predictions file')
      .setInputFiles(csv('bad.csv', 'item_id,label\ne2e_01,0\ne2e_01,1\nnot_mine,1\n'));
    await page.getByRole('button', { name: 'Check format' }).click();
    await expect(page.locator('#submit-result').getByRole('heading').first()).toBeVisible();
    expect(await scan()).toEqual([]);

    // A scored grading result, reached from the task page. Wait on the URL and
    // on an exact heading: the task page has a heading that starts with
    // "Metrics" too, and scanning it by mistake would prove nothing.
    await page.goto(`/evaluation/${GRADING}`);
    await page.getByRole('link', { name: 'E2E first reading' }).click();
    await expect(page).toHaveURL(new RegExp(`/evaluation/${GRADING}/submissions/[0-9a-f-]{36}$`));
    await expect(
      page.getByRole('heading', { level: 2, name: 'Metrics', exact: true }),
    ).toBeVisible();
    expect(await scan()).toEqual([]);

    // A classification result, with the per-class table.
    await page.goto(`/evaluation/${CLASSES}`);
    await page.getByRole('link', { name: 'E2E three-class model' }).click();
    await expect(page).toHaveURL(new RegExp(`/evaluation/${CLASSES}/submissions/[0-9a-f-]{36}$`));
    await expect(page.getByRole('table')).toBeVisible();
    expect(await scan()).toEqual([]);
  });
});

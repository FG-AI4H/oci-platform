import { test, expect as baseExpect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Reviewing an evaluation method in the browser (#649), end to end against
 * the real API. Nothing is mocked.
 *
 * Setup registers a method through the API as its submitter, who is also an
 * evaluation reviewer (the strongest case for "review is in pairs"), and
 * declares version 1.0.0. Then:
 *
 *   1. Another reviewer finds it in the review queue, begins the review,
 *      is asked for a real rationale, goes back to edit without losing it,
 *      confirms, and approves. The rationale is published on the page.
 *   2. The submitter declares 1.1.0 in the browser, is told they cannot
 *      review it and offered only to withdraw it; a form tampered to begin
 *      the review is refused by the API, the refusal is explained and the
 *      text is kept. The API refuses the same call directly.
 *   3. axe-core on the queue, the confirmation step, the declare page and
 *      the refusal: no violations.
 *
 * Pre-conditions: Postgres + API + web running; run with PW_NO_RESET=1.
 * `global-setup` removes `e2e-route-*` methods between runs.
 */

// Server actions compile on first use under `next dev`.
const expect = baseExpect.configure({ timeout: 15_000 });

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const stamp = Date.now();
const SLUG = `e2e-route-${stamp}`;
const NAME = `E2E sealed method ${stamp}`;
const OWNER = `e2e-route-owner-${stamp}`;
const OWNER_ROLES = 'researcher,evaluation-reviewer';
const REVIEWER = `e2e-route-reviewer-${stamp}`;
const RATIONALE =
  'Adversarial test on the metrics path found no disclosure; declared caps match the sandbox.';

const DECLARATION = {
  version: '1.0.0',
  threatModel: {
    adversaries: [{ party: 'PLATFORM_OPERATOR', capability: 'reads all logs', defended: true }],
    assumptions: ['the sandbox has no network'],
    outOfScope: ['a malicious data host'],
  },
  disclosureProfile: {
    observations: [{ party: 'DATA_HOST', observes: 'its own data only' }],
    trustAnchor: 'CONTRACTUAL',
    keyGovernance: 'The data host holds the keys.',
    reproducible: { value: false },
  },
  operationalEnvelope: {
    permittedOperations: ['inference'],
    arithmeticPrecision: 'fp32',
    maxRuntimeSec: 3600,
    maxMemoryMb: 8192,
  },
};

async function signInAs(page: Page, user: string, roles: string, callback: string) {
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(callback)}`);
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles', { exact: false }).fill(roles);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === callback);
}

async function expectNoAxeViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.length}`),
    `axe on ${label}`,
  ).toEqual([]);
}

const versionRegion = (page: Page, version: string) =>
  page.getByRole('region', { name: new RegExp(`^Version ${version.replace(/\./g, '\\.')}`) });

test.describe('review an evaluation method in the browser (#649)', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test.beforeAll(async ({ request }) => {
    const owner = { Authorization: `Bearer dev:${OWNER}:${OWNER_ROLES}` };
    const created = await request.post(`${API}/v2/evaluation/routes`, {
      headers: owner,
      data: { slug: SLUG, name: NAME, mode: 'CONTAINER', providerName: 'E2E Labs' },
    });
    expect(created.ok(), `register: ${created.status()}`).toBe(true);
    const declared = await request.post(`${API}/v2/evaluation/routes/${SLUG}/versions`, {
      headers: owner,
      data: DECLARATION,
    });
    expect(declared.ok(), `declare: ${declared.status()}`).toBe(true);
  });

  test('a reviewer finds the version in the queue, begins the review and approves it', async ({
    page,
  }) => {
    await signInAs(page, REVIEWER, 'evaluation-reviewer', '/evaluation/routes');

    await page.getByRole('link', { name: 'Open the review queue' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Versions awaiting review' }),
    ).toBeVisible();
    await expectNoAxeViolations(page, 'review queue');
    const declaredGroup = page.getByRole('region', { name: /Declared: review not yet begun/ });
    await declaredGroup.getByRole('link', { name: `Review version 1.0.0 of ${NAME}` }).click();
    await expect(page).toHaveURL(new RegExp(`/evaluation/routes/${SLUG}`));

    // Begin the review. A note is optional for this step.
    let block = versionRegion(page, '1.0.0');
    await block.getByRole('radio', { name: /^Begin the review\./ }).check();
    await block.getByRole('button', { name: 'Continue' }).click();
    const beginHeading = page.getByRole('heading', {
      name: `Confirm: begin the review of version 1.0.0 of ${NAME}`,
    });
    await expect(beginHeading).toBeFocused();
    await page.getByRole('button', { name: 'Begin the review of version 1.0.0' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'is now under review' })).toBeVisible();

    // Approve: a rationale too short to make the decision checkable is refused.
    block = versionRegion(page, '1.0.0');
    await block.getByRole('radio', { name: /^Approve\./ }).check();
    await block.getByLabel(/^Rationale/).fill('ok fine');
    await block.getByRole('button', { name: 'Continue' }).click();
    await expect(block.getByText('Write at least 10 characters', { exact: false })).toBeVisible();
    await expect(block.getByRole('radio', { name: /^Approve\./ })).toBeChecked();

    await block.getByLabel(/^Rationale/).fill(RATIONALE);
    await block.getByRole('button', { name: 'Continue' }).click();

    // The confirmation says what approving does and shows the published text.
    const confirm = page.getByRole('region', {
      name: `Confirm: approve version 1.0.0 of ${NAME}`,
    });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText('Results scored under this version count')).toBeVisible();
    await expect(confirm.getByRole('blockquote')).toHaveText(RATIONALE);
    await expectNoAxeViolations(page, 'confirmation step');

    // Back to edit keeps both the decision and the text.
    await confirm.getByRole('button', { name: 'Back to edit' }).click();
    block = versionRegion(page, '1.0.0');
    await expect(block.getByRole('radio', { name: /^Approve\./ })).toBeChecked();
    await expect(block.getByLabel(/^Rationale/)).toHaveValue(RATIONALE);
    await block.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Approve version 1.0.0' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'is now approved' })).toBeVisible();
    block = versionRegion(page, '1.0.0');
    await expect(block.getByText('published', { exact: true })).toBeVisible();
    await expect(
      block.getByRole('heading', { name: 'Rationale published with the decision' }),
    ).toBeVisible();
    await expect(block.getByText(RATIONALE)).toBeVisible();
    await expectNoAxeViolations(page, 'method page after approval');

    // It has left the queue.
    await page.goto('/evaluation/routes/reviews');
    await expect(page.getByText(`${NAME}`)).toHaveCount(0);
  });

  test('the submitter declares a version, cannot review it, and is refused if they try', async ({
    page,
    request,
  }) => {
    await signInAs(page, OWNER, OWNER_ROLES, `/evaluation/routes/${SLUG}`);

    await page.getByRole('link', { name: 'Declare a new version' }).click();
    await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();
    await expect(page.getByText('The fields start from version 1.0.0')).toBeVisible();
    await expect(page.getByLabel('Arithmetic precision')).toHaveValue('fp32');
    await expectNoAxeViolations(page, 'declare page');
    // A version number already used is refused next to the field.
    await page.getByLabel(/^Version number/).fill('1.0.0');
    await page.getByRole('button', { name: 'Declare this version' }).click();
    await expect(page.getByText('Version 1.0.0 is already declared').first()).toBeVisible();
    await expect(page.getByLabel('Arithmetic precision')).toHaveValue('fp32');
    await page.getByLabel(/^Version number/).fill('1.1.0');
    await page.getByRole('button', { name: 'Declare this version' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Version 1.1.0 is declared' }),
    ).toBeVisible();

    const block = versionRegion(page, '1.1.0');
    await expect(
      block.getByText('You submitted this method, so you cannot review it.'),
    ).toBeVisible();
    await expect(block.getByRole('heading', { name: 'Review this version' })).toHaveCount(0);
    await expect(block.getByRole('heading', { name: 'Withdraw this version' })).toBeVisible();
    await expect(block.getByRole('radio')).toHaveCount(1);
    await expect(block.getByRole('radio', { name: /^Withdraw\./ })).toBeVisible();

    // A form tampered to begin the review instead: the platform refuses it.
    const radio = block.getByRole('radio', { name: /^Withdraw\./ });
    await radio.check();
    await block.getByLabel(/^Rationale/).fill('I would like to review my own method.');
    // Last, so no re-render puts the value back before the form is posted.
    await radio.evaluate((el) => {
      (el as HTMLInputElement).value = 'UNDER_REVIEW';
    });
    await block.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Begin the review of version 1.1.0' }).click();

    const refused = versionRegion(page, '1.1.0');
    await expect(refused.getByRole('heading', { name: 'Not recorded' })).toBeVisible();
    await expect(
      refused.getByText('The platform refused this decision. Review is in pairs', { exact: false }),
    ).toBeVisible();
    await expect(refused.getByLabel(/^Rationale/)).toHaveValue(
      'I would like to review my own method.',
    );
    await expect(refused.getByText('declared, not yet under review', { exact: false })).toHaveCount(
      0,
    );
    await expectNoAxeViolations(page, 'refusal');

    // And in the API, for the version the other reviewer approved.
    const direct = await request.post(`${API}/v2/evaluation/routes/${SLUG}/versions/1.1.0/review`, {
      headers: { Authorization: `Bearer dev:${OWNER}:${OWNER_ROLES}` },
      data: { status: 'UNDER_REVIEW' },
    });
    expect(direct.status()).toBe(403);
    const route = (await (await request.get(`${API}/v2/evaluation/routes/${SLUG}`)).json()) as {
      versions: Array<{ version: string; reviewStatus: string }>;
    };
    expect(route.versions.find((v) => v.version === '1.1.0')?.reviewStatus).toBe('DECLARED');
  });
});

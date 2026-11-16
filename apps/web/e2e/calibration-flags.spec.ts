import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Calibration-flags inbox (#554): supervisors see ACTIVE flags for a
 * campaign; annotators get no link and a not-authorised state.
 *
 * Flags have no POST endpoint (the API raises them from IRR scoring),
 * so the spec inserts two ACTIVE rows via `docker exec psql`, as
 * `federation-filter.spec.ts` does, and deletes them afterwards.
 *
 * Pre-conditions:
 *   - docker compose -f infra/local/docker-compose.yml up -d
 *   - pnpm --filter @oci/database db:migrate:deploy
 *   - pnpm --filter @oci/database db:seed:demo   (demo-rsna-* campaigns)
 *   - OCI_ENV=local pnpm --filter @oci/api dev
 *   - pnpm --filter @oci/web dev
 */

/** Seed campaign that receives the test flags. */
const FLAGGED_SLUG = 'demo-rsna-segmentation';
/** Seed DRAFT campaign with no tasks, so no flags: the empty state. */
const EMPTY_SLUG = 'demo-rsna-classification';

/** Distinct 8-char prefixes so each row's pseudonym is unique. */
const SKILL_ANNOTATOR = 'e2e55401-0000-4000-8000-000000000554';
const DRIFT_ANNOTATOR = 'e2e55402-0000-4000-8000-000000000554';
/**
 * Valid for the Postgres uuid column but not an RFC 4122 uuid (version
 * nibble 0), so the API's quality endpoint rejects it: a real failed
 * quality-summary request without stubbing the API.
 */
const BAD_ID_ANNOTATOR = 'e2e55403-0000-0000-0000-000000000554';

const FLAGS_TABLE = 'annotation.annotator_calibration_flags';
/** The flags table is renamed to this to make the flags endpoint fail. */
const FLAGS_TABLE_OFF = 'annotator_calibration_flags_e2e_off';

function psql(sql: string): void {
  execFileSync(
    'docker',
    ['exec', 'oci-postgres', 'psql', '-U', 'oci', '-d', 'oci_dev', '-c', sql],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
}

function deleteTestFlags(): void {
  psql(
    `DELETE FROM annotation.annotator_calibration_flags WHERE annotator_user_id IN ('${SKILL_ANNOTATOR}', '${DRIFT_ANNOTATOR}', '${BAD_ID_ANNOTATOR}');`,
  );
}

/** Puts the flags table back if a failed run left it renamed. */
function restoreFlagsTable(): void {
  psql(
    `ALTER TABLE IF EXISTS annotation.${FLAGS_TABLE_OFF} RENAME TO annotator_calibration_flags;`,
  );
}

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

test.describe('calibration-flags inbox (#554)', () => {
  test.beforeAll(() => {
    restoreFlagsTable();
    deleteTestFlags();
    // SKILL raised a day before DRIFT, so DRIFT must list first. The
    // SKILL score sits just under its threshold so the formatter can't
    // round it up to equal it.
    psql(`
      INSERT INTO annotation.annotator_calibration_flags
        (campaign_id, annotator_user_id, flag_type, metric, score, threshold, sample_size, window_meta, created_at)
      SELECT id, '${SKILL_ANNOTATOR}', 'SKILL', 'vs-gold', 0.596, 0.60, 24, '{}'::jsonb, NOW() - INTERVAL '1 day'
        FROM annotation.annotation_campaigns WHERE slug = '${FLAGGED_SLUG}';
      INSERT INTO annotation.annotator_calibration_flags
        (campaign_id, annotator_user_id, flag_type, metric, score, threshold, sample_size, window_meta, created_at)
      SELECT id, '${DRIFT_ANNOTATOR}', 'DRIFT', 'vs-self', 0.71, 0.85, 12, '{}'::jsonb, NOW()
        FROM annotation.annotation_campaigns WHERE slug = '${FLAGGED_SLUG}';
    `);
  });

  test.afterAll(() => {
    restoreFlagsTable();
    deleteTestFlags();
  });

  test('supervisor follows the link, sees flags newest-first, opens a quality summary', async ({
    page,
  }) => {
    await signInAs(page, 'sup', 'task-supervisor');
    await page.goto(`/annotation/campaigns/${FLAGGED_SLUG}`);
    await page.getByRole('link', { name: 'Calibration flags' }).click();
    await expect(page).toHaveURL(new RegExp(`/annotation/campaigns/${FLAGGED_SLUG}/calibration$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Calibration flags' })).toBeVisible();

    const rows = page.getByRole('region', { name: 'Active calibration flags' }).locator('tbody tr');
    await expect(rows).toHaveCount(2);
    // Newest first, pseudonymous ids only.
    await expect(rows.nth(0)).toContainText('e2e55402');
    await expect(rows.nth(0)).toContainText('Drift');
    await expect(rows.nth(0)).toContainText('0.71 < 0.85');
    await expect(rows.nth(1)).toContainText('e2e55401');
    await expect(rows.nth(1)).toContainText('Skill');
    await expect(rows.nth(1)).toContainText('0.596 < 0.60');
    await expect(rows.nth(1).getByRole('cell').nth(4)).toHaveText('24');
    await expect(page.getByText(SKILL_ANNOTATOR)).toHaveCount(0);

    await page.getByRole('link', { name: /annotator e2e55401/i }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: /quality summary — e2e55401/i }),
    ).toBeVisible();
    await expect(page.getByText('Gold samples scored')).toBeVisible();
    // Selection goes by flag id: the annotator's user id never reaches the URL.
    expect(page.url()).toMatch(/[?&]flag=[0-9a-f-]{36}/);
    expect(page.url()).not.toContain(SKILL_ANNOTATOR);
    const panel = page.locator('#annotator-quality');
    await expect(panel).toContainText('Skill · vs gold · 0.596 < 0.60');
  });

  test('a DRIFT flag restates its own score next to the gold summary', async ({ page }) => {
    await signInAs(page, 'sup', 'task-supervisor');
    await page.goto(`/annotation/campaigns/${FLAGGED_SLUG}/calibration`);
    await page.getByRole('link', { name: /annotator e2e55402/i }).click();

    const panel = page.locator('#annotator-quality');
    await expect(panel.getByRole('heading', { name: /quality summary — e2e55402/i })).toBeVisible();
    await expect(panel).toContainText('Drift · vs self · 0.71 < 0.85');
    await expect(panel.getByText('Agreement with gold standard')).toBeVisible();
  });

  test('an unknown flag id or a raw annotator id opens no quality summary', async ({ page }) => {
    await signInAs(page, 'sup', 'task-supervisor');
    for (const query of [
      `flag=${randomUUID()}`,
      `flag=${SKILL_ANNOTATOR}`,
      `annotator=${SKILL_ANNOTATOR}`,
    ]) {
      await page.goto(`/annotation/campaigns/${FLAGGED_SLUG}/calibration?${query}`);
      await expect(
        page.getByRole('region', { name: 'Active calibration flags' }).locator('tbody tr'),
      ).toHaveCount(2);
      await expect(page.getByRole('heading', { name: /quality summary/i })).toHaveCount(0);
    }
  });

  for (const { user, roles } of [
    { user: 'cm', roles: 'campaign-manager' },
    { user: 'alice', roles: 'admin' },
  ]) {
    test(`${roles} follows the link and sees the flags`, async ({ page }) => {
      await signInAs(page, user, roles);
      await page.goto(`/annotation/campaigns/${FLAGGED_SLUG}`);
      await page.getByRole('link', { name: 'Calibration flags' }).click();
      await expect(
        page.getByRole('region', { name: 'Active calibration flags' }).locator('tbody tr'),
      ).toHaveCount(2);
      await page.getByRole('link', { name: /annotator e2e55401/i }).click();
      await expect(
        page.getByRole('heading', { level: 2, name: /quality summary — e2e55401/i }),
      ).toBeVisible();
    });
  }

  test('a failing flags request shows the error state, not the API detail', async ({ page }) => {
    await signInAs(page, 'sup', 'task-supervisor');
    // Without its table the flags endpoint fails with a 500; the
    // campaign lookup before it doesn't use the table.
    psql(`ALTER TABLE ${FLAGS_TABLE} RENAME TO ${FLAGS_TABLE_OFF};`);
    try {
      await page.goto(`/annotation/campaigns/${FLAGGED_SLUG}/calibration`);
      await expect(
        page.getByRole('heading', { level: 2, name: 'Could not load calibration flags' }),
      ).toBeVisible();
      await expect(page.getByRole('region', { name: 'Active calibration flags' })).toHaveCount(0);
      await expect(page.getByText(/API 5\d\d|\/v2\/|calibration_flags/)).toHaveCount(0);
    } finally {
      restoreFlagsTable();
    }
  });

  test('a failing quality-summary request keeps the selected flag and shows an error', async ({
    page,
  }) => {
    psql(`
      INSERT INTO annotation.annotator_calibration_flags
        (campaign_id, annotator_user_id, flag_type, metric, score, threshold, sample_size, window_meta, created_at)
      SELECT id, '${BAD_ID_ANNOTATOR}', 'SKILL', 'vs-peers', 0.4, 0.6, 9, '{}'::jsonb, NOW() - INTERVAL '2 days'
        FROM annotation.annotation_campaigns WHERE slug = '${FLAGGED_SLUG}';
    `);
    try {
      await signInAs(page, 'sup', 'task-supervisor');
      await page.goto(`/annotation/campaigns/${FLAGGED_SLUG}/calibration`);
      await page.getByRole('link', { name: /annotator e2e55403/i }).click();

      const panel = page.locator('#annotator-quality');
      await expect(
        panel.getByRole('heading', { name: /quality summary — e2e55403/i }),
      ).toBeVisible();
      await expect(
        panel.getByRole('heading', { level: 3, name: 'Could not load the quality summary' }),
      ).toBeVisible();
      await expect(panel).toContainText('Skill · vs peers · 0.40 < 0.60');
      await expect(panel.getByText('Gold samples scored')).toHaveCount(0);
      await expect(page.getByText(/API 4\d\d|\/v2\//)).toHaveCount(0);
    } finally {
      psql(
        `DELETE FROM annotation.annotator_calibration_flags WHERE annotator_user_id = '${BAD_ID_ANNOTATOR}';`,
      );
    }
  });

  test('an expired session is sent to sign in again and returns to the inbox', async ({ page }) => {
    // Local dev tokens never expire, so this drives the sign-in step the
    // page redirects to on a 401 (the 401 mapping is unit-tested in
    // calibration/load.spec.ts). Signed in, /signin would normally
    // bounce straight back, which would loop on an expired token.
    const target = `/annotation/campaigns/${FLAGGED_SLUG}/calibration`;
    await signInAs(page, 'sup', 'task-supervisor');
    await page.goto(`/signin?reason=expired&callbackUrl=${encodeURIComponent(target)}`);
    await expect(page.getByRole('status')).toHaveText(
      'Your session has expired. Sign in again to continue.',
    );

    await page.getByLabel('User').fill('sup');
    await page.getByLabel('Roles').fill('task-supervisor');
    await page.getByRole('button', { name: /sign in.*local dev/i }).click();
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Calibration flags' })).toBeVisible();

    // Without the reason, a signed-in caller still bounces straight on.
    await page.goto(`/signin?callbackUrl=${encodeURIComponent(target)}`);
    await expect(page).toHaveURL(new RegExp(`${target}$`));
  });

  test('supervisor sees the empty state on a campaign without flags', async ({ page }) => {
    await signInAs(page, 'sup', 'task-supervisor');
    await page.goto(`/annotation/campaigns/${EMPTY_SLUG}/calibration`);
    await expect(page.getByText('No active calibration flags for this campaign.')).toBeVisible();
  });

  test('annotator gets no link and a not-authorised state', async ({ page }) => {
    await signInAs(page, 'ann', 'annotator');
    await page.goto(`/annotation/campaigns/${FLAGGED_SLUG}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Calibration flags' })).toHaveCount(0);

    await page.goto(`/annotation/campaigns/${FLAGGED_SLUG}/calibration`);
    await expect(
      page.getByRole('heading', { name: "You don't have access to calibration flags" }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Active calibration flags' })).toHaveCount(0);
  });

  /** Every render branch of the page, so axe covers each one. */
  const axeStates: {
    name: string;
    user: string;
    roles: string;
    open: (page: Page) => Promise<void>;
  }[] = [
    {
      name: 'inbox with a selected annotator',
      user: 'sup',
      roles: 'task-supervisor',
      open: async (page) => {
        await page.goto(`/annotation/campaigns/${FLAGGED_SLUG}/calibration`);
        await page.getByRole('link', { name: /annotator e2e55402/i }).click();
        await expect(
          page.getByRole('heading', { level: 2, name: /quality summary/i }),
        ).toBeVisible();
      },
    },
    {
      name: 'empty state',
      user: 'sup',
      roles: 'task-supervisor',
      open: async (page) => {
        await page.goto(`/annotation/campaigns/${EMPTY_SLUG}/calibration`);
        await expect(
          page.getByText('No active calibration flags for this campaign.'),
        ).toBeVisible();
      },
    },
    {
      name: 'not-authorised state',
      user: 'ann',
      roles: 'annotator',
      open: async (page) => {
        await page.goto(`/annotation/campaigns/${FLAGGED_SLUG}/calibration`);
        await expect(
          page.getByRole('heading', { name: "You don't have access to calibration flags" }),
        ).toBeVisible();
      },
    },
  ];

  for (const state of axeStates) {
    for (const colorScheme of ['light', 'dark'] as const) {
      test(`${state.name} has no axe violations (${colorScheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await signInAs(page, state.user, state.roles);
        await state.open(page);

        const results = await new AxeBuilder({ page })
          .include('main')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const summary = results.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`);
        expect(summary, 'axe violations').toEqual([]);
      });
    }
  }
});

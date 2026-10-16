import { execFileSync } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Campaign progress card (#556): counts per gate state, share done and
 * a burndown, for campaign managers and task supervisors.
 *
 * The spec clones the seeded RUNNING campaign `demo-rsna-segmentation`
 * into `e2e-progress-556` and gives it six tasks with known states and
 * dates, via `docker exec psql` as `calibration-flags.spec.ts` does, so
 * every count below is exact. Both are deleted afterwards.
 *
 *   created 3 days ago: 2 COMPLETED (yesterday), 1 SKIPPED (today),
 *                       1 AWAITING_ARBITRATION
 *   created yesterday:  2 INDEPENDENT
 *
 * Remaining per day: 4, 4, 4, then 3 today.
 *
 * Pre-conditions:
 *   - docker compose -f infra/local/docker-compose.yml up -d
 *   - pnpm --filter @oci/database db:migrate:deploy
 *   - pnpm --filter @oci/database db:seed:demo   (demo-rsna-* campaigns)
 *   - OCI_ENV=local pnpm --filter @oci/api dev
 *   - pnpm --filter @oci/web dev
 */

const SLUG = 'e2e-progress-556';
const PAGE = `/annotation/campaigns/${SLUG}`;

function psql(sql: string): void {
  execFileSync(
    'docker',
    [
      'exec',
      'oci-postgres',
      'psql',
      '-U',
      'oci',
      '-d',
      'oci_dev',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

function deleteCampaign(): void {
  psql(`
    DELETE FROM annotation.annotation_tasks
      WHERE campaign_id IN (SELECT id FROM annotation.annotation_campaigns WHERE slug = '${SLUG}');
    DELETE FROM annotation.annotation_campaigns WHERE slug = '${SLUG}';
  `);
}

/** Noon UTC, `days` days ago: away from day boundaries. */
const at = (days: number) =>
  `date_trunc('day', NOW()) + INTERVAL '12 hours' - INTERVAL '${days} days'`;

function seedCampaign(): void {
  psql(`
    CREATE TEMP TABLE c556 AS
      SELECT * FROM annotation.annotation_campaigns WHERE slug = 'demo-rsna-segmentation';
    UPDATE c556 SET id = gen_random_uuid(), slug = '${SLUG}', name = 'E2E progress 556',
      current_instructions_version = NULL;
    INSERT INTO annotation.annotation_campaigns SELECT * FROM c556;
    INSERT INTO annotation.annotation_tasks
      (campaign_id, sample_ref, n_annotators_required, gate_state, skip_reason, created_at, updated_at, completed_at)
    SELECT c.id, v.ref, 3, v.state::annotation."AnnotationGateState", v.reason, v.created, v.created, v.completed
      FROM c556 c, (VALUES
        ('e2e-556-a', 'COMPLETED',            NULL,         ${at(3)}, ${at(1)}),
        ('e2e-556-b', 'COMPLETED',            NULL,         ${at(3)}, ${at(1)}),
        ('e2e-556-c', 'SKIPPED',              'unreadable', ${at(3)}, ${at(0)}),
        ('e2e-556-d', 'AWAITING_ARBITRATION', NULL,         ${at(3)}, NULL),
        ('e2e-556-e', 'INDEPENDENT',          NULL,         ${at(1)}, NULL),
        ('e2e-556-f', 'INDEPENDENT',          NULL,         ${at(1)}, NULL)
      ) AS v(ref, state, reason, created, completed);
  `);
}

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

const progressCard = (page: Page) => page.locator('#campaign-progress');

test.describe('campaign progress card (#556)', () => {
  test.beforeAll(() => {
    deleteCampaign();
    seedCampaign();
  });
  test.afterAll(() => deleteCampaign());

  test('campaign manager sees counts, the share done and the burndown', async ({ page }) => {
    await signInAs(page, 'mgr', 'campaign-manager');
    await page.goto(PAGE);
    await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible();

    const card = progressCard(page);
    await expect(card).toContainText('50% done: 3 of 6 tasks (2 completed, 1 skipped)');
    for (const [label, count] of [
      ['Independent', '2'],
      ['Arbitration', '1'],
      ['Expert review', '0'],
      ['Completed', '2'],
      ['Skipped', '1'],
    ] as const) {
      await expect(card.getByRole('term').filter({ hasText: label }).locator('+ dd')).toHaveText(
        count,
      );
    }

    const chart = card.getByRole('img', { name: /burndown/i });
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAccessibleName(/^Burndown: 3 of 6 tasks remaining on /);
    await expect(chart.locator('polyline')).toHaveCount(1);

    // Screen-reader table: one row per day, oldest first, ending at 3.
    const rows = card.locator('table tbody tr');
    await expect(rows).toHaveCount(4);
    expect(await rows.locator('td:nth-child(2)').allTextContents()).toEqual(['4', '4', '4', '3']);

    // Managers keep the Tasks card with seeding.
    await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  });

  test('task supervisor sees the Progress card but not task seeding', async ({ page }) => {
    await signInAs(page, 'sup', 'task-supervisor');
    await page.goto(PAGE);
    await expect(progressCard(page)).toContainText('50% done: 3 of 6 tasks');
    await expect(page.getByRole('img', { name: /burndown/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toHaveCount(0);
  });

  test('annotator does not see the Progress card', async ({ page }) => {
    await signInAs(page, 'ann', 'annotator');
    await page.goto(PAGE);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toHaveCount(0);
    await expect(page.getByRole('img', { name: /burndown/i })).toHaveCount(0);
  });

  test('a running campaign with no tasks shows the empty state', async ({ page }) => {
    psql(`
      DELETE FROM annotation.annotation_tasks
        WHERE campaign_id IN (SELECT id FROM annotation.annotation_campaigns WHERE slug = '${SLUG}');
    `);
    try {
      await signInAs(page, 'mgr', 'campaign-manager');
      await page.goto(PAGE);
      await expect(progressCard(page)).toContainText('No tasks seeded yet.');
      await expect(page.getByRole('img', { name: /burndown/i })).toHaveCount(0);
    } finally {
      deleteCampaign();
      seedCampaign();
    }
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`Progress card has no axe violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await signInAs(page, 'mgr', 'campaign-manager');
      await page.goto(PAGE);
      await expect(page.getByRole('img', { name: /burndown/i })).toBeVisible();

      const results = await new AxeBuilder({ page })
        // Scoped to the card this ticket adds. The page has one existing
        // violation outside it: the danger-variant Lifecycle button fails
        // colour contrast in dark mode (2.2:1).
        .include('#campaign-progress')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const summary = results.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`);
      expect(summary, 'axe violations').toEqual([]);
    });
  }
});

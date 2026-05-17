import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the annotator queue web slice (#215, slice 2 — web).
 *
 * Drives the round-trip:
 *   1. Manager visits a RUNNING campaign → sees the Tasks card with the
 *      8 demo-seeded tasks (`demo-rsna-segmentation`).
 *   2. Manager pastes a fresh sample ref → server action creates a task
 *      → the table picks it up after revalidate.
 *   3. Annotator visits `/annotation/campaigns/<slug>/annotate` → sees
 *      a pulled assignment (the page does the pull-next server-side).
 *   4. Annotator submits the default JSON payload → success alert.
 *
 * Pre-conditions (same as the slice-1 spec):
 *   - docker compose -f infra/local/docker-compose.yml up -d
 *   - pnpm --filter @oci/database db:migrate:deploy
 *   - pnpm --filter @oci/database db:seed:demo
 *   - pnpm --filter @oci/api dev
 *   - pnpm --filter @oci/web dev
 */

const RUNNING_SLUG = 'demo-rsna-segmentation';

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

test.describe('annotator queue web slice', () => {
  test('campaign manager: sees the Tasks card with demo-seeded tasks + can seed more', async ({
    page,
  }) => {
    await signInAs(page, 'cm', 'campaign-manager');
    await page.goto(`/annotation/campaigns/${RUNNING_SLUG}`);

    // The Tasks card renders on a RUNNING campaign for the manager.
    const tasksCard = page
      .getByRole('region', { name: /tasks/i })
      .or(page.locator('article').filter({ hasText: /Total tasks/i }));
    await expect(page.getByText('Total tasks')).toBeVisible();
    await expect(page.getByText(/Independent/, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /seed tasks/i })).toBeVisible();

    // Seed a fresh one — the unique constraint on (campaign, sampleRef)
    // makes the spec idempotent across runs.
    const fresh = `e2e/sample-${Date.now()}`;
    await page.getByLabel(/seed sample references/i).fill(fresh);
    await page.getByRole('button', { name: /seed tasks/i }).click();
    await expect(page.getByText(/Created 1 task/i)).toBeVisible();
    void tasksCard;
  });

  test('annotator: pulls a task, submits the default JSON, sees success', async ({ page }) => {
    await signInAs(page, 'annie', 'annotator');
    await page.goto(`/annotation/campaigns/${RUNNING_SLUG}/annotate`);

    // The page's server-side pull-next probe should hand us a task.
    await expect(page.getByRole('heading', { name: /your current task/i })).toBeVisible();
    await expect(page.getByText(/rsna-pneumonia-2018/)).toBeVisible();
    await expect(page.getByLabel(/annotation/i)).toBeVisible();

    // Submit the pre-filled JSON. With N=3 on the demo campaign the
    // first submission should NOT advance the gate.
    await page.getByRole('button', { name: /^submit$/i }).click();
    await expect(page.getByText(/submission counted|gate advanced/i)).toBeVisible();
  });

  test('caller without an annotation role is redirected away from /annotate', async ({ page }) => {
    await signInAs(page, 'host-only', 'host');
    await page.goto(`/annotation/campaigns/${RUNNING_SLUG}/annotate`);
    // The page guard redirects to the campaign detail.
    await expect(page).toHaveURL(new RegExp(`/annotation/campaigns/${RUNNING_SLUG}$`));
  });
});

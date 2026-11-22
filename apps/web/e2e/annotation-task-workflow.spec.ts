import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the annotator queue web slice (#215, slice 2 — web).
 *
 * Drives the round-trip:
 *   1. Manager visits a RUNNING campaign → sees the Tasks card with the
 *      8 demo-seeded tasks (`demo-rsna-segmentation`).
 *   2. Manager pastes a fresh sample ref → server action creates a task
 *      → the table picks it up after revalidate.
 *   3. Annotator visits `/annotation/campaigns/<slug>/annotate` → nothing
 *      is reserved until they press Start (#646).
 *   4. Annotator skips a task, starts the next from the keyboard, and
 *      submits the default JSON payload → back on the queue.
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
    // Stat summary row uses short labels ("Total", "Independent", ...);
    // the parent Card carries the "Tasks" title.
    await expect(page.getByText('Total', { exact: true })).toBeVisible();
    await expect(page.getByText('Independent').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /seed tasks/i })).toBeVisible();

    // Seed a fresh one — the unique constraint on (campaign, sampleRef)
    // makes the spec idempotent across runs.
    const fresh = `e2e/sample-${Date.now()}`;
    await page.getByLabel(/seed sample references/i).fill(fresh);
    await page.getByRole('button', { name: /seed tasks/i }).click();
    await expect(page.getByText(/Created 1 task/i)).toBeVisible();
    void tasksCard;
  });

  test('annotator: starts a task, skips it, submits the next one', async ({ page }) => {
    // A fresh annotator per run: the demo campaign has few tasks.
    await signInAs(page, `annie-${Date.now()}`, 'annotator');
    await page.goto(`/annotation/campaigns/${RUNNING_SLUG}/annotate`);

    // Opening the page reserves nothing (#646).
    await expect(page.getByRole('heading', { name: /ready when you are/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /your current task/i })).toHaveCount(0);

    await page.getByRole('button', { name: /^start$/i }).click();
    await expect(page.getByRole('heading', { name: /your current task/i })).toBeVisible();
    // Free-text sample references have no image, so the reference is
    // shown. Which task comes first depends on what earlier runs seeded.
    const sampleRef = page
      .locator('dt', { hasText: /^Sample$/ })
      .locator('xpath=following-sibling::dd[1]');
    await expect(sampleRef).not.toBeEmpty();
    const skipped = await sampleRef.textContent();

    // Skip gives it back; the queue offers the next task, focused for Enter.
    await page.getByRole('button', { name: /^skip$/i }).click();
    await expect(page.getByRole('status')).toHaveText(/task skipped/i);
    const startNext = page.getByRole('button', { name: /start the next task/i });
    await expect(startNext).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /your current task/i })).toBeVisible();
    await expect(sampleRef).not.toHaveText(skipped ?? '');

    // Submit the pre-filled JSON; back to the queue.
    await page.getByRole('button', { name: /^submit$/i }).click();
    await expect(page.getByRole('status')).toHaveText(/your annotation was saved/i);
    await expect(page.getByRole('button', { name: /start the next task/i })).toBeFocused();
  });

  test('caller without an annotation role is redirected away from /annotate', async ({ page }) => {
    await signInAs(page, 'host-only', 'host');
    await page.goto(`/annotation/campaigns/${RUNNING_SLUG}/annotate`);
    // The page guard redirects to the campaign detail.
    await expect(page).toHaveURL(new RegExp(`/annotation/campaigns/${RUNNING_SLUG}$`));
  });
});

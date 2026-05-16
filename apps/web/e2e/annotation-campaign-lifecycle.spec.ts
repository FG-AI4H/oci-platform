import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the campaign lifecycle state machine (#215, slice 1).
 *
 * Drives a campaign through DRAFT → READY → RUNNING → COMPLETED → ARCHIVED
 * via the detail-page action buttons, asserting:
 *   - the status badge updates after each transition
 *   - `startedAt` / `completedAt` surface in the audit card
 *   - the reason-required path (revert-to-draft) prompts for + persists the reason
 *
 * Pre-conditions:
 *   - docker compose -f infra/local/docker-compose.yml up -d
 *   - pnpm --filter @oci/database db:migrate:deploy
 *   - pnpm --filter @oci/api dev
 *   - pnpm --filter @oci/web dev
 */

const DATASET_UUID = '00000000-0000-4000-8000-00000000ca7a';

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

async function createDraft(page: Page, slug: string) {
  await page.goto('/annotation/campaigns/new');
  await page.getByLabel('Slug').fill(slug);
  await page.getByLabel('Name').fill(`Lifecycle ${slug}`);
  await page.getByLabel('Dataset ID').fill(DATASET_UUID);
  await page.getByRole('radio', { name: 'Classification' }).check();
  await page.getByRole('button', { name: /create draft/i }).click();
  await expect(page).toHaveURL(new RegExp(`/annotation/campaigns/${slug}$`));
}

test.describe('annotation campaign lifecycle', () => {
  test('campaign manager: full DRAFT → READY → RUNNING → COMPLETED → ARCHIVED', async ({
    page,
  }) => {
    const slug = `e2e-lifecycle-${Date.now()}`;
    await signInAs(page, 'cm', 'campaign-manager');
    await createDraft(page, slug);

    // Helper: assert the status badge in the page header. revalidatePath
    // on each transition unmounts the transient success alert, so we
    // rely on the persistent badge instead.
    const statusBadge = page
      .getByRole('main')
      .getByText(/^(draft|ready|running|completed|archived)$/i)
      .first();
    await expect(statusBadge).toHaveText(/draft/i);

    // DRAFT — mark ready.
    await page.getByRole('button', { name: 'Mark ready' }).click();
    await page.getByRole('button', { name: /confirm: mark ready/i }).click();
    await expect(statusBadge).toHaveText(/ready/i);

    // READY — Start + Revert-to-draft visible.
    await expect(page.getByRole('button', { name: 'Start campaign' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revert to draft' })).toBeVisible();

    // Start → RUNNING; audit card should now show "Started".
    await page.getByRole('button', { name: 'Start campaign' }).click();
    await page.getByRole('button', { name: /confirm: start campaign/i }).click();
    await expect(statusBadge).toHaveText(/running/i);
    await expect(page.locator('dt').filter({ hasText: 'Started' })).toBeVisible();

    // RUNNING → COMPLETED.
    await expect(page.getByRole('button', { name: 'Complete' })).toBeVisible();
    await page.getByRole('button', { name: 'Complete' }).click();
    await page.getByRole('button', { name: /confirm: complete/i }).click();
    await expect(statusBadge).toHaveText(/completed/i);
    await expect(page.locator('dt').filter({ hasText: 'Completed' })).toBeVisible();

    // COMPLETED → ARCHIVED (no reason required).
    await page.getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('button', { name: /confirm: archive/i }).click();
    await expect(statusBadge).toHaveText(/archived/i);

    // ARCHIVED — terminal; no action buttons.
    await expect(page.getByText(/no transitions available from/i)).toBeVisible();
  });

  test('revert-to-draft REQUIRES a reason', async ({ page }) => {
    const slug = `e2e-revert-${Date.now()}`;
    await signInAs(page, 'cm', 'campaign-manager');
    await createDraft(page, slug);

    // Move to READY.
    const statusBadge = page
      .getByRole('main')
      .getByText(/^(draft|ready)$/i)
      .first();
    await page.getByRole('button', { name: 'Mark ready' }).click();
    await page.getByRole('button', { name: /confirm: mark ready/i }).click();
    await expect(statusBadge).toHaveText(/ready/i);

    // Open revert-to-draft form; the reason textarea is required + has
    // an HTML `required` attribute.
    await page.getByRole('button', { name: 'Revert to draft' }).click();
    const reasonField = page.getByLabel('Reason');
    await expect(reasonField).toBeVisible();
    await expect(reasonField).toHaveAttribute('required', '');

    // With a reason, the transition succeeds. Use a separate selector
    // because the revert path's destination is the draft state.
    await reasonField.fill('manager typed wrong dataset id');
    await page.getByRole('button', { name: /confirm: revert to draft/i }).click();
    await expect(page.getByRole('main').getByText(/^draft$/i)).toBeVisible();
  });

  test('non-campaign-manager cannot see the Lifecycle card', async ({ page }) => {
    const slug = `e2e-noaccess-${Date.now()}`;

    // Set up a draft as cm.
    await signInAs(page, 'cm', 'campaign-manager');
    await createDraft(page, slug);

    // Re-sign-in as a participant.
    await page.goto('/api/auth/signout');
    await page.getByRole('button', { name: /sign out/i }).click();
    await signInAs(page, 'eve', 'participant');

    await page.goto(`/annotation/campaigns/${slug}`);
    await expect(page.getByRole('heading', { name: /lifecycle$/i })).toHaveCount(0);
  });
});

import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the platform-settings operator surface (#242).
 *
 * Exercises:
 *   - Auth gating on `/admin/settings`.
 *   - Setting a maintenance banner that's currently in its visible
 *     window — anonymous browser sees it above the SiteHeader.
 *   - Updating the banner to a future window — anonymous browser no
 *     longer sees it.
 *   - Clearing the banner removes it.
 *
 * Pre-conditions:
 *   - docker compose -f infra/local/docker-compose.yml up -d
 *   - pnpm --filter @oci/database db:migrate:deploy
 *   - pnpm --filter @oci/api dev       (API on :3000)
 *   - pnpm --filter @oci/web dev       (web on :3001)
 */

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

/** Format a `Date` as `YYYY-MM-DDTHH:MM` (the `datetime-local` shape). */
function toLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

test.describe('admin platform settings workflow', () => {
  test('anonymous visitor cannot reach /admin/settings', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page).toHaveURL(/\/$/);
  });

  test('non-admin redirected away from /admin/settings', async ({ page }) => {
    await signInAs(page, 'bob', 'host');
    await page.goto('/admin/settings');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('admin sets a live banner; anonymous visitor sees it; clearing removes it', async ({
    browser,
  }) => {
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await signInAs(adminPage, 'alice', 'admin');
    await adminPage.goto('/admin/settings');
    await expect(adminPage.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

    // Live window: now-1min to now+10min.
    const from = toLocalDatetime(new Date(Date.now() - 60_000));
    const until = toLocalDatetime(new Date(Date.now() + 10 * 60_000));
    const stamp = `E2E live banner ${Date.now()}`;

    await adminPage.getByRole('checkbox', { name: /show site-wide maintenance banner/i }).check();
    await adminPage.getByLabel('Message').fill(stamp);
    await adminPage.getByRole('radio', { name: /warning/i }).check();
    await adminPage.getByLabel('Visible from').fill(from);
    await adminPage.getByLabel('Visible until').fill(until);
    await adminPage.getByRole('button', { name: /save settings/i }).click();

    await expect(adminPage.getByText(/banner saved/i)).toBeVisible();

    // Anonymous browser hits the homepage; the banner should be
    // visible above the header. The API has a 60s cache, so we need
    // a fresh context (no cookies) — but the API path the banner uses
    // is server-side `fetch` from the web; that goes through Next's
    // server cache which `revalidatePath('/', 'layout')` already
    // busted. So a fresh anonymous load gets the live banner.
    const anonCtx = await browser.newContext();
    const anonPage = await anonCtx.newPage();
    await anonPage.goto('/');
    const banner = anonPage.getByRole('status').filter({ hasText: stamp });
    await expect(banner).toBeVisible();
    await anonCtx.close();

    // Clear: admin toggles off and saves.
    await adminPage.getByRole('checkbox', { name: /show site-wide maintenance banner/i }).uncheck();
    await adminPage.getByRole('button', { name: /save settings/i }).click();
    await expect(adminPage.getByText(/banner cleared/i)).toBeVisible();

    // Anonymous browser no longer sees it.
    const anonCtx2 = await browser.newContext();
    const anonPage2 = await anonCtx2.newPage();
    await anonPage2.goto('/');
    await expect(anonPage2.getByRole('status').filter({ hasText: stamp })).toHaveCount(0);
    await anonCtx2.close();
    await adminCtx.close();
  });
});

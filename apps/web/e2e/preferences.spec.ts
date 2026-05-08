import { test, expect, type Page } from '@playwright/test';

/**
 * /settings — per-user UI preferences (PR M).
 *
 * Exercises the API + web round-trip end-to-end against the local
 * stack: the form posts to a server action, the server action
 * forwards to PUT /v2/preferences/me, mirrors the dark-mode value
 * into the `oci-theme` cookie, and the next SSR pass renders
 * `<html data-theme="…">` based on it.
 */

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fsettings');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(settings|dashboard|$)/);
}

test.describe('settings — preferences', () => {
  test('anonymous visitor is redirected to sign-in', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/signin/);
  });

  test('host can flip dark mode and the html data-theme attribute persists', async ({ page }) => {
    await signInAs(page, `prefs-${Date.now()}`, 'host');
    await page.goto('/settings');

    // Initial: no data-theme (system default).
    const initialAttr = await page.locator('html').getAttribute('data-theme');
    expect(['system', null]).toContain(initialAttr);

    await page.getByRole('radio', { name: /^Dark$/ }).check();
    await page.getByRole('button', { name: /save preferences/i }).click();

    // Server action redirects back to /settings?saved=1.
    await expect(page).toHaveURL(/\/settings\?saved=1/);
    await expect(page.getByRole('status')).toContainText(/preferences saved/i);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Reloading the page should still come back dark — proves the
    // cookie is round-tripped through SSR.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Pick light, verify, then reset to system to leave a clean DB row
    // for the next run.
    await page.getByRole('radio', { name: /^Light$/ }).check();
    await page.getByRole('button', { name: /save preferences/i }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.getByRole('radio', { name: /^System$/ }).check();
    await page.getByRole('button', { name: /save preferences/i }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('locale field accepts BCP-47 tags and rejects garbage', async ({ page }) => {
    await signInAs(page, `prefs-locale-${Date.now()}`, 'host');
    await page.goto('/settings');

    const localeField = page.getByLabel('Language');
    await localeField.fill('not-a-tag-because-too-many-parts-1234567890');
    await page.getByRole('button', { name: /save preferences/i }).click();

    // Validation surfaces inline; the page does not navigate.
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByText(/correct the errors/i)).toBeVisible();

    // Now a valid tag — should save.
    await localeField.fill('fr-CH');
    await page.getByRole('button', { name: /save preferences/i }).click();
    await expect(page).toHaveURL(/\/settings\?saved=1/);
    await expect(page.getByLabel('Language')).toHaveValue('fr-CH');
  });
});

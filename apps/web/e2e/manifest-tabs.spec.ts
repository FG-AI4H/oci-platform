import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the manifest tab switcher (PR L.2).
 *
 * The catalog detail page used to render only ~10 curated fields. Now
 * researchers can flip between Summary (curated), Full manifest
 * (every populated field, grouped by namespace), and Raw JSON
 * (collapsible tree).
 */

const FIXTURE = resolvePath(process.cwd(), '../api/scripts/fixtures/idrid.croissant.json');

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

test.describe('manifest tabs (PR L.2)', () => {
  test('host: publish then flip Summary → Full → Raw on the detail page', async ({ page }) => {
    const stamp = Date.now();
    const slug = `e2e-tabs-${stamp}`;
    await signInAs(page, '00000000-0000-4f00-8000-000000000f01', 'host');
    await page.goto('/catalog/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill(`Tabs ${stamp}`);
    await page.getByRole('radio', { name: 'PUBLIC' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}/publish$`));
    await page.getByRole('tab', { name: 'I already have a manifest' }).click();
    await page.getByLabel('Croissant manifest').fill(readFileSync(FIXTURE, 'utf8'));
    await page.getByRole('button', { name: /validate.*publish/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}$`));

    // Summary tab is the default — curated row labels visible.
    const tablist = page.getByRole('tablist', { name: 'Manifest view' });
    await expect(tablist.getByRole('tab', { name: 'Summary' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The IDRiD fixture's homepage URL is in the curated summary.
    await expect(
      page.getByText('https://idrid.grand-challenge.org', { exact: false }),
    ).toBeVisible();

    // Switch to Full manifest. It groups by namespace. The IDRiD
    // fixture uses bare keys (no sc: prefix) so most rows fall into
    // "Other"; `bio:*` keys group into "BioCroissant"; `@context` /
    // `@type` group into "JSON-LD framing".
    await tablist.getByRole('tab', { name: 'Full manifest' }).click();
    await expect(page.getByRole('heading', { name: 'JSON-LD framing', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'BioCroissant', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Other', exact: true })).toBeVisible();

    // Switch to Raw JSON. The tree shows the manifest's top-level
    // type as a value somewhere; we just assert the tree's root
    // collapsible is rendered.
    await tablist.getByRole('tab', { name: 'Raw JSON' }).click();
    // The toplevel object is rendered as `<details open>`; its
    // summary contains the count.
    const summaries = page.locator('summary');
    await expect(summaries.first()).toBeVisible();
  });
});

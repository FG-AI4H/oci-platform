import { expect, test, type Page } from '@playwright/test';

/**
 * A dataset without a published version is a draft: it must not appear in
 * the public catalogue, and its host must have a way back into the publish
 * flow. Regression for the abandoned-wizard case found on 15 November 2026.
 */

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles', { exact: false }).fill(roles);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

test.describe('catalogue drafts', () => {
  const slug = `e2e-draft-${Date.now()}`;

  test('a public draft is hidden from the list but reachable by its host, with a publish link', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await signInAs(host, 'draft-host', 'host');
    await host.goto('/catalog/new');
    await host.getByLabel('Slug').fill(slug);
    await host.getByLabel('Name').fill('Draft left in the wizard');
    await host.getByLabel('Description').fill('Created and abandoned by the drafts spec.');
    await host.getByRole('radio', { name: 'Public' }).check();
    await host.getByRole('button', { name: /create draft/i }).click();
    await host.waitForURL(new RegExp(`/catalog/${slug}/publish$`));

    // The host finds it under "My datasets", marked as a draft...
    await host.goto('/catalog?mine=1');
    const card = host.locator('a[href$="/catalog/' + slug + '"]');
    await expect(card).toBeVisible();
    await expect(card.getByText('draft', { exact: true })).toBeVisible();

    // ...and the detail page says what is missing and offers the way back.
    await host.goto(`/catalog/${slug}`);
    await expect(host.getByText(/Draft: not listed and not crawlable/)).toBeVisible();
    await host.getByRole('link', { name: 'Publish the first version' }).click();
    await expect(host).toHaveURL(new RegExp(`/catalog/${slug}/publish$`));
    await hostCtx.close();

    // Anonymous visitors see neither the card nor the page.
    const anonCtx = await browser.newContext();
    const anon = await anonCtx.newPage();
    await anon.goto('/catalog?q=' + encodeURIComponent('Draft left in the wizard'));
    await expect(anon.locator('a[href$="/catalog/' + slug + '"]')).toHaveCount(0);
    const res = await anon.goto(`/catalog/${slug}`);
    expect(res?.status()).toBe(404);
    await anonCtx.close();
  });
});

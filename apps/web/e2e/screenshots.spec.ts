import { readFileSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { test, type Page } from '@playwright/test';

/**
 * Capture-only spec: renders each surface and writes a screenshot to
 * `playwright-report/ux/`. Not run on CI by default — invoke explicitly
 * for design review:
 *
 *   pnpm exec playwright test screenshots --project=chromium
 */

const FIXTURE = resolvePath(process.cwd(), '../api/scripts/fixtures/idrid.croissant.json');
const OUT_DIR = resolvePath(process.cwd(), 'ux-screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const shot = (name: string) => resolvePath(OUT_DIR, name);

async function signIn(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await page.waitForURL(/\/(dashboard)?$/);
}

test.describe('UX captures', () => {
  test('homepage anonymous', async ({ page }) => {
    await page.goto('/');
    await page.screenshot({ path: shot('01-home-anon.png'), fullPage: true });
  });

  test('catalog list', async ({ page }) => {
    await page.goto('/catalog');
    await page.screenshot({ path: shot('02-catalog-list.png'), fullPage: true });
  });

  test('signin form (branded)', async ({ page }) => {
    await page.goto('/signin');
    await page.screenshot({ path: shot('03-signin-form.png'), fullPage: true });
  });

  test('host: new dataset form', async ({ page }) => {
    await signIn(page, 'screenshot-host', 'host');
    await page.goto('/catalog/new');
    await page.screenshot({ path: shot('04-new-dataset.png'), fullPage: true });
  });

  test('host: publish flow', async ({ page }) => {
    const slug = `ux-${Date.now()}`;
    await signIn(page, 'screenshot-host-2', 'host');
    await page.goto('/catalog/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill(`UX ${slug}`);
    await page.getByRole('radio', { name: 'PUBLIC' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await page.waitForURL(new RegExp(`/catalog/${slug}/publish$`));
    await page.screenshot({ path: shot('05-publish-empty.png'), fullPage: true });

    // Switch to the paste form (PR K wizard is the default).
    await page.getByRole('button', { name: 'I already have a manifest' }).click();
    await page.getByLabel('Croissant manifest').fill(readFileSync(FIXTURE, 'utf8'));
    await page.screenshot({ path: shot('06-publish-pasted.png'), fullPage: true });

    await page.getByLabel('Croissant manifest').fill('{"@type":"sc:Dataset","name":"x"}');
    await page.getByRole('button', { name: /validate.*publish/i }).click();
    await page.waitForSelector('text=/manifest validation failed/i');
    await page.screenshot({ path: shot('07-publish-errors.png'), fullPage: true });
  });

  test('host: detail page with JSON-LD', async ({ page }) => {
    const slug = `ux-detail-${Date.now()}`;
    await signIn(page, 'screenshot-host-3', 'host');
    await page.goto('/catalog/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill(`Detail ${slug}`);
    await page.getByRole('radio', { name: 'PUBLIC' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await page.waitForURL(new RegExp(`/catalog/${slug}/publish$`));
    // Switch to the paste form (PR K wizard is the default).
    await page.getByRole('button', { name: 'I already have a manifest' }).click();
    await page.getByLabel('Croissant manifest').fill(readFileSync(FIXTURE, 'utf8'));
    await page.getByRole('button', { name: /validate.*publish/i }).click();
    await page.waitForURL(new RegExp(`/catalog/${slug}$`));
    await page.screenshot({ path: shot('08-detail.png'), fullPage: true });
  });
});

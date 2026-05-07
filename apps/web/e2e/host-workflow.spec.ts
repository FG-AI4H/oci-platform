import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the catalog host workflow shipped in PRs C + D.
 *
 * What this exercises end-to-end:
 *   - The local-dev NextAuth Credentials provider (sign in as a host).
 *   - The header's host-only "New dataset" link.
 *   - /catalog/new — server action POST /v2/catalog/datasets.
 *   - /catalog/[slug]/publish — manifest paste, structured validation
 *     errors on bad input, redirect to detail page on happy path.
 *   - JSON-LD on the public detail page (PR C).
 *
 * Pre-conditions (the runner does not bring these up — keep them
 * outside the test scope so iterating against the same DB rows is
 * cheap during dev):
 *   - docker compose -f infra/local/docker-compose.yml up -d
 *   - pnpm --filter @oci/database db:migrate:deploy
 *   - pnpm --filter @oci/api dev      (API on :3000)
 *   - pnpm --filter @oci/web dev      (web on :3001)
 *
 * The suite uses a unique slug per run (`e2e-${Date.now()}`) so re-runs
 * don't trip over the unique-slug constraint.
 */

// Playwright runs from apps/web; the API fixtures live at
// apps/api/scripts/fixtures relative to the repo root.
const FIXTURE_PATH = resolvePath(process.cwd(), '../api/scripts/fixtures/idrid.croissant.json');

function readManifest(): string {
  return readFileSync(FIXTURE_PATH, 'utf8');
}

async function signInAs(page: Page, user: string, roles: string) {
  // Branded /signin page (PR H, #79). NextAuth's `pages.signIn`
  // routes here; the form posts to a server action that hands off
  // to NextAuth's credentials flow, then redirects to callbackUrl.
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

test.describe('catalog host workflow', () => {
  test('anonymous visitor sees no "New dataset" link', async ({ page }) => {
    await page.goto('/');
    // Header link is host-only; not present for anonymous.
    await expect(page.getByRole('link', { name: 'New dataset' })).toHaveCount(0);
  });

  test('participant cannot see "New dataset" link', async ({ page }) => {
    await signInAs(page, 'eve', 'participant');
    await expect(page.getByRole('link', { name: 'New dataset' })).toHaveCount(0);
  });

  test('host: create draft + reject invalid manifest + publish + JSON-LD on detail', async ({
    page,
  }) => {
    const slug = `e2e-${Date.now()}`;
    await signInAs(page, 'bob', 'host');

    // Header host-only link is visible
    const newLink = page.getByRole('link', { name: 'New dataset' });
    await expect(newLink).toBeVisible();
    await newLink.click();
    await expect(page).toHaveURL(/\/catalog\/new$/);

    // -- Create draft -----------------------------------------------------
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill(`E2E ${slug}`);
    await page.getByLabel('Description').fill('Dataset created by Playwright E2E.');
    // Visibility radios — pick PUBLIC so JSON-LD will emit on the detail page.
    await page.getByRole('radio', { name: 'PUBLIC' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}/publish$`));

    // -- Negative case: malformed JSON ------------------------------------
    await page.getByLabel('Croissant manifest').fill('not json');
    await page.getByRole('button', { name: /validate.*publish/i }).click();
    await expect(page.getByText(/manifest is not valid json/i)).toBeVisible();

    // -- Negative case: structured validation issues ----------------------
    await page.getByLabel('Croissant manifest').fill('{"@type":"sc:Dataset","name":"x"}');
    await page.getByRole('button', { name: /validate.*publish/i }).click();
    // The panel renders the message twice — once as the heading and
    // once as a paragraph; assert on the heading specifically.
    await expect(page.getByRole('heading', { name: /manifest validation failed/i })).toBeVisible();

    // -- Happy path: valid IDRiD manifest ---------------------------------
    await page.getByLabel('Croissant manifest').fill(readManifest());
    await page.getByRole('button', { name: /validate.*publish/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}$`));
    // Conformance badge is rendered exactly as `Croissant 1.1`.
    await expect(page.getByText('Croissant 1.1', { exact: true })).toBeVisible();

    // -- JSON-LD is present in the rendered HTML --------------------------
    const html = await page.content();
    const ldMatch = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    expect(ldMatch, 'JSON-LD script tag should be embedded').not.toBeNull();
    const jsonLd = JSON.parse(ldMatch![1]!.replace(/\\u003c/g, '<')) as Record<string, unknown>;
    expect(jsonLd['@type']).toBe('Dataset');
    expect(jsonLd['@id']).toMatch(new RegExp(`/catalog/${slug}$`));
  });

  test('host: slug conflict surfaces inline', async ({ page }) => {
    const slug = `e2e-conflict-${Date.now()}`;
    await signInAs(page, 'bob', 'host');

    // First create — succeeds
    await page.goto('/catalog/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill('First');
    await page.getByRole('radio', { name: 'PRIVATE' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}/publish$`));

    // Second attempt with same slug — 409 → inline error
    await page.goto('/catalog/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill('Duplicate');
    await page.getByRole('radio', { name: 'PRIVATE' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page.getByText(/already taken/i)).toBeVisible();
  });
});

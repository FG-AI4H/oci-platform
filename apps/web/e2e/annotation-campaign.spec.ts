import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the Phase B.A.1 annotation-campaign fullstack flow
 * (PR follow-up to #238 — web side of #222).
 *
 * What this exercises end-to-end against the running local stack:
 *   - Header gating: anonymous / non-campaign-manager users do not see
 *     the "New campaign" link.
 *   - /annotation/campaigns list — flat read, empty state copy + create
 *     CTA for authorised users.
 *   - /annotation/campaigns/new — server action POST
 *     /v2/annotation/campaigns. Uses the seeded `monai-label` /
 *     `ohif-viewer` integrations populated by the migration; the form
 *     fetches `/v2/annotation/tool-integrations` server-side.
 *   - Redirect to detail page on success + assertion the configuration
 *     card surfaces the values the user typed.
 *   - Slug-conflict path — 409 surfaces inline.
 *
 * Pre-conditions (the runner does not bring these up):
 *   - docker compose -f infra/local/docker-compose.yml up -d
 *   - pnpm --filter @oci/database db:migrate:deploy
 *   - pnpm --filter @oci/api dev    (API on :3000)
 *   - pnpm --filter @oci/web dev    (web on :3001)
 */

const DATASET_UUID = '00000000-0000-4000-8000-00000000ca7a';

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

test.describe('annotation campaign workflow', () => {
  test('anonymous visitor sees no "New campaign" link in primary nav', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'New campaign' })).toHaveCount(0);
  });

  test('participant cannot see "New campaign" link in primary nav', async ({ page }) => {
    await signInAs(page, 'eve', 'participant');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'New campaign' })).toHaveCount(0);
  });

  test('campaign manager: create draft + appears in list + detail surfaces values', async ({
    page,
  }) => {
    const slug = `e2e-campaign-${Date.now()}`;
    await signInAs(page, 'cm', 'campaign-manager');

    // Header campaign-manager link is visible. The list page renders a
    // second "New campaign" CTA in its empty state — scope to the primary
    // nav to disambiguate.
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const newLink = nav.getByRole('link', { name: 'New campaign' });
    await expect(newLink).toBeVisible();

    // Visit the list first — empty state or existing list. Either way
    // the page renders cleanly with the header CTA.
    await page.goto('/annotation/campaigns');
    await expect(page.getByRole('heading', { name: 'Campaigns', exact: true })).toBeVisible();

    await newLink.click();
    await expect(page).toHaveURL(/\/annotation\/campaigns\/new$/);

    // -- Create draft ------------------------------------------------------
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill(`E2E ${slug}`);
    await page
      .getByLabel('Description')
      .fill('Campaign created by Playwright E2E for the annotation track.');
    await page.getByLabel('Dataset ID').fill(DATASET_UUID);

    // Pick segmentation so we can assert the label on detail.
    await page.getByRole('radio', { name: 'Segmentation' }).check();

    // Bump nAnnotators to 5 (clinically defensible for safety-critical
    // tasks per ADR-0009) so we can assert the value on detail.
    const nField = page.getByLabel('Annotators per data point');
    await nField.fill('5');

    await page.getByRole('button', { name: /create draft/i }).click();

    // Redirected to detail page on success.
    await expect(page).toHaveURL(new RegExp(`/annotation/campaigns/${slug}$`));
    await expect(page.getByRole('heading', { name: `E2E ${slug}` })).toBeVisible();
    await expect(page.getByText('draft', { exact: false })).toBeVisible();
    await expect(page.getByText('Segmentation')).toBeVisible();
    await expect(page.getByText('5', { exact: true })).toBeVisible();

    // -- Back to list: new campaign appears -------------------------------
    await page.getByRole('link', { name: /campaigns$/i }).click();
    await expect(page).toHaveURL(/\/annotation\/campaigns$/);
    await expect(page.getByRole('link', { name: new RegExp(`E2E ${slug}`) })).toBeVisible();
  });

  test('campaign manager: slug conflict surfaces inline', async ({ page }) => {
    const slug = `e2e-campaign-dup-${Date.now()}`;
    await signInAs(page, 'cm', 'campaign-manager');

    // First create.
    await page.goto('/annotation/campaigns/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill('First');
    await page.getByLabel('Dataset ID').fill(DATASET_UUID);
    await page.getByRole('radio', { name: 'Classification' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page).toHaveURL(new RegExp(`/annotation/campaigns/${slug}$`));

    // Same slug again — expect 409 → inline error.
    await page.goto('/annotation/campaigns/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill('Duplicate');
    await page.getByLabel('Dataset ID').fill(DATASET_UUID);
    await page.getByRole('radio', { name: 'Classification' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page.getByText(/already taken/i)).toBeVisible();
  });
});

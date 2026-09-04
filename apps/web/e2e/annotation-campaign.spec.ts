import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the annotation-campaign create flow.
 *
 * Form layout (user feedback 2026-05-16):
 *   1. slug + name + description
 *   2. **task kind**          ← drives the tool filter
 *   3. **dataset picker**     ← typeahead against the catalog
 *   4. tool                   ← filtered by `supportedTaskKinds`
 *   5. nAnnotators + outputLicense
 *
 * Header simplification (also 2026-05-16): "New dataset" + "New
 * campaign" are no longer in the primary nav; those CTAs live on the
 * relevant list pages and (for campaigns) on the catalog detail page.
 *
 * Pre-conditions (the runner does not bring these up):
 *   - docker compose -f infra/local/docker-compose.yml up -d
 *   - pnpm --filter @oci/database db:migrate:deploy
 *   - pnpm --filter @oci/api dev    (API on :3000)
 *   - pnpm --filter @oci/web dev    (web on :3001)
 */

/** Seed-data slug — PUBLIC, visible to all roles. */
const SEED_DATASET_SLUG = 'rsna-pneumonia-2018';

/**
 * Text-only seed dataset (#247). Picking it must disable the spatial
 * task-kind radios (DETECTION / SEGMENTATION / LOCALIZATION) and keep
 * CLASSIFICATION + MULTI_MODAL enabled.
 */
const SEED_TEXT_DATASET_SLUG = 'demo-clinical-notes-2024';

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

/**
 * `<select>.selectOption({ label })` only accepts exact strings, not
 * regexes. Resolve the option's value by name then submit.
 */
async function selectToolByName(page: Page, namePrefix: string) {
  const select = page.getByLabel('Annotation tool');
  const value = await select
    .locator('option', { hasText: namePrefix })
    .first()
    .getAttribute('value');
  if (!value) throw new Error(`No tool option matching "${namePrefix}"`);
  await select.selectOption(value);
}

/** Pick a dataset via the typeahead. */
async function pickDataset(page: Page, query: string) {
  await page.getByLabel('Dataset').fill(query);
  // Wait for the listbox + click the first match.
  const listbox = page.locator('#dataset-picker-listbox');
  await expect(listbox).toBeVisible();
  await listbox.getByRole('option').first().click();
  // After picking, the "Change" button appears next to the selected
  // row — assert that to confirm the hidden datasetId got set.
  await expect(page.getByRole('button', { name: /change dataset/i })).toBeVisible();
}

test.describe('annotation campaigns — anonymous visitor (#488)', () => {
  test('signed-out visit redirects to sign-in with a callback, not a raw 401', async ({ page }) => {
    await page.goto('/annotation/campaigns');
    await expect(page).toHaveURL(/\/signin\?callbackUrl=(%2F|\/)annotation(%2F|\/)campaigns$/);
    await expect(page.getByText(/missing bearer token/i)).toHaveCount(0);
    await expect(page.getByText(/401 Unauthorized/i)).toHaveCount(0);
  });
});

test.describe('annotation campaign — header + form', () => {
  test('primary nav no longer carries "New dataset" or "New campaign"', async ({ page }) => {
    await signInAs(page, 'cm', 'campaign-manager');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'New campaign' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'New dataset' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Annotation' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Catalog' })).toBeVisible();
  });

  test('campaign manager: full create flow with dataset typeahead', async ({ page }) => {
    const slug = `e2e-campaign-${Date.now()}`;
    await signInAs(page, 'cm', 'campaign-manager');

    await page.goto('/annotation/campaigns');
    await expect(page.getByRole('heading', { name: 'Campaigns', exact: true })).toBeVisible();

    // List page surfaces a "New campaign" CTA for managers (header was removed).
    await page.getByRole('link', { name: 'New campaign' }).first().click();
    await expect(page).toHaveURL(/\/annotation\/campaigns\/new$/);

    // -- Identity --------------------------------------------------------
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill(`E2E ${slug}`);
    await page
      .getByLabel('Description')
      .fill('Campaign created by Playwright E2E for the annotation track.');

    // -- Task kind first -------------------------------------------------
    // Pick CLASSIFICATION so both seeded tools qualify (monai-label +
    // ohif-viewer both list CLASSIFICATION in supportedTaskKinds).
    await page.getByRole('radio', { name: 'Classification' }).check();

    // -- Dataset picker --------------------------------------------------
    await pickDataset(page, SEED_DATASET_SLUG);

    // -- Tool dropdown is filtered by task kind --------------------------
    const tool = page.getByLabel('Annotation tool');
    await expect(tool).toBeEnabled();
    // The placeholder option + at least one real option.
    await expect(tool.locator('option')).toContainText(['MONAI Label']);
    await selectToolByName(page, 'MONAI Label');

    await page.getByLabel('Annotators per data point').fill('5');

    await page.getByRole('button', { name: /create draft/i }).click();

    // Redirected to detail page on success.
    await expect(page).toHaveURL(new RegExp(`/annotation/campaigns/${slug}$`));
    await expect(page.getByRole('heading', { name: `E2E ${slug}` })).toBeVisible();
    await expect(page.getByText('Classification')).toBeVisible();
  });

  test('task-kind change re-filters the tool list (defence-in-depth)', async ({ page }) => {
    await signInAs(page, 'cm', 'campaign-manager');
    await page.goto('/annotation/campaigns/new');

    // No task kind yet → tool select is disabled with placeholder.
    const tool = page.getByLabel('Annotation tool');
    await expect(tool).toBeDisabled();

    // Pick SEGMENTATION — monai-label supports it, ohif-viewer does NOT.
    await page.getByRole('radio', { name: 'Segmentation' }).check();
    await expect(tool).toBeEnabled();
    const segmentationOptions = await tool.locator('option').allTextContents();
    expect(segmentationOptions.some((s) => /MONAI Label/.test(s))).toBe(true);
    expect(segmentationOptions.some((s) => /OHIF Viewer/.test(s))).toBe(false);

    // Switch to DETECTION — ohif-viewer supports it, monai-label does NOT.
    await page.getByRole('radio', { name: 'Detection' }).check();
    const detectionOptions = await tool.locator('option').allTextContents();
    expect(detectionOptions.some((s) => /OHIF Viewer/.test(s))).toBe(true);
    expect(detectionOptions.some((s) => /MONAI Label/.test(s))).toBe(false);
  });

  test('campaign manager: slug conflict surfaces inline', async ({ page }) => {
    const slug = `e2e-campaign-dup-${Date.now()}`;
    await signInAs(page, 'cm', 'campaign-manager');

    // First create.
    await page.goto('/annotation/campaigns/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill('First');
    await page.getByRole('radio', { name: 'Classification' }).check();
    await pickDataset(page, SEED_DATASET_SLUG);
    await selectToolByName(page, 'MONAI Label');
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page).toHaveURL(new RegExp(`/annotation/campaigns/${slug}$`));

    // Same slug again — expect 409 → inline error.
    await page.goto('/annotation/campaigns/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill('Duplicate');
    await page.getByRole('radio', { name: 'Classification' }).check();
    await pickDataset(page, SEED_DATASET_SLUG);
    await selectToolByName(page, 'MONAI Label');
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page.getByText(/already taken/i)).toBeVisible();
  });

  test('catalog dataset detail surfaces "Create annotation campaign" for managers + pre-fills the form', async ({
    page,
  }) => {
    await signInAs(page, 'cm', 'campaign-manager');

    await page.goto(`/catalog/${SEED_DATASET_SLUG}`);
    const cta = page.getByRole('link', { name: /create.*annotation campaign/i });
    await expect(cta).toBeVisible();
    await cta.click();

    // We landed on the new-campaign page with the picker already populated.
    await expect(page).toHaveURL(/\/annotation\/campaigns\/new\?datasetSlug=.*$/);
    await expect(page.getByRole('button', { name: /change dataset/i })).toBeVisible();
  });

  test('participant (non-campaign-manager) does NOT see the catalog CTA', async ({ page }) => {
    await signInAs(page, 'eve', 'participant');
    await page.goto(`/catalog/${SEED_DATASET_SLUG}`);
    await expect(page.getByRole('link', { name: /create.*annotation campaign/i })).toHaveCount(0);
  });

  test('text-only dataset disables spatial task-kind radios (#247)', async ({ page }) => {
    await signInAs(page, 'cm', 'campaign-manager');
    await page.goto('/annotation/campaigns/new');

    // Before picking a dataset every radio is enabled — no constraint
    // applies yet (form falls back to "allow all" when modalities are
    // unknown).
    await expect(page.getByRole('radio', { name: 'Segmentation' })).toBeEnabled();

    // Pick the text-only dataset.
    await pickDataset(page, SEED_TEXT_DATASET_SLUG);

    // Spatial task kinds disabled with rationale visible.
    await expect(page.getByRole('radio', { name: 'Segmentation' })).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Detection' })).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Localisation' })).toBeDisabled();
    await expect(page.getByText(/isn'?t supported for Text data/i).first()).toBeVisible();

    // Classification + Multi-modal remain enabled.
    await expect(page.getByRole('radio', { name: 'Classification' })).toBeEnabled();
    await expect(page.getByRole('radio', { name: 'Multi-modal' })).toBeEnabled();

    // The summary text under the heading lists the dataset modality.
    await expect(page.getByText(/Filtered against the dataset modality/i)).toBeVisible();
  });
});

import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the manifest wizard (PR K, #90).
 *
 * What this exercises end-to-end:
 *   1. Host signs in, creates a RESTRICTED dataset.
 *   2. Lands on /catalog/<slug>/publish with the wizard active.
 *   3. Walks the 6 input steps, filling structured fields (no JSON-LD).
 *   4. Reviews the generated manifest, publishes.
 *   5. Lands on the detail page with the dataset as PUBLISHED + DUO
 *      terms surfaced (which proves the manifest the wizard generated
 *      passed the catalog publish path).
 *   6. Switches to the paste-form escape hatch on a separate flow to
 *      confirm the tab still works (regression guard).
 *
 * Pre-conditions: docker compose + API on :3000 + web on :3001 (same
 * as the rest of the suite).
 */

const HOST = '00000000-0000-4f00-8000-000000000f01';

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

test.describe('manifest wizard', () => {
  test('host: walk wizard end-to-end → publishes a valid manifest', async ({ page }) => {
    const stamp = Date.now();
    const slug = `restricted-wiz-${stamp}`;
    const datasetName = `Wizard test ${stamp}`;

    await signInAs(page, HOST, 'host');
    await page.goto('/catalog/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill(datasetName);
    await page.getByRole('radio', { name: 'Restricted' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}/publish$`));

    // Wizard is the default mode; the tab is selected.
    await expect(page.getByRole('tab', { name: 'Wizard' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // ---------- Step 1: Identification ----------------------------------
    await page.getByLabel('Dataset name').fill(datasetName);
    await page
      .getByLabel('Description')
      .fill(
        'A wizard-generated test dataset for the manifest builder E2E. Validates that structured input round-trips through the catalog publish path.',
      );
    await page.getByLabel('Homepage').fill('https://example.org/');
    // License pre-filled to CC-BY-4.0; leave as is.
    // Version pre-filled to suggested next; leave as is.
    // Date pre-filled to today; leave as is.
    await page.getByRole('button', { name: /^Next:.*Creators/ }).click();

    // ---------- Step 2: Creators ----------------------------------------
    await page.locator('#wiz-creator-0-name').fill('Wizard Test Author');
    await page.getByRole('button', { name: /^Next:.*Biomedical context/ }).click();

    // ---------- Step 3: Biomedical context (skip — all optional) --------
    // Add at least one item to confirm BioCroissant fields round-trip.
    await page.getByLabel('Imaging modality').fill('X-ray');
    await page.getByRole('button', { name: /^Next:.*Provenance/ }).click();

    // ---------- Step 4: Provenance (bio-prov, #496) ---------------------
    // The dataset is OPEN (the draft form's default tier), so every block
    // is Recommended or Optional and the step can be passed through. Fill
    // the source organisation so a PROV-O block round-trips to the page.
    await expect(
      page.getByRole('heading', { name: 'Where did the data come from?' }),
    ).toBeVisible();
    await page.getByLabel('Organisation name').fill('Wizard Test Hospital');
    await page.getByRole('button', { name: /^Next:.*Data use/ }).click();

    // ---------- Step 5: Data use (DUO) ----------------------------------
    // RESTRICTED dataset — required at least one term. Pick GRU.
    await page.getByLabel(/General research use/i).check();
    await page.getByRole('button', { name: /^Next:.*Distributions/ }).click();

    // ---------- Step 6: Distributions (skip — empty distributions OK) ---
    await page.getByRole('button', { name: /^Next:.*Review/ }).click();

    // ---------- Review: generated JSON-LD visible -----------------------
    await expect(page.getByRole('heading', { name: /Ready to publish\?/ })).toBeVisible();
    // The preview pane is in the DOM; we don't assert a specific
    // JSON-LD text payload because the live-preview is rendered
    // multiple places (review + side pane) and the strict-mode
    // resolver picks one ambiguously. The publish step below proves
    // the manifest is valid.

    // Publish.
    await page.getByRole('button', { name: 'Publish version' }).click();

    // The action redirects to /catalog/<slug>; assert we land there.
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}$`), { timeout: 10_000 });

    // The detail page renders the BioCroissant + DUO fields, proving
    // the wizard's output passed validation + adoption.
    await expect(page.getByText('General research use', { exact: false })).toBeVisible();
    await expect(page.getByText('X-ray').first()).toBeVisible();
    // …and the provenance card, from the PROV-O block the step wrote.
    await expect(page.getByRole('heading', { name: 'Provenance' })).toBeVisible();
    await expect(page.getByText('Wizard Test Hospital')).toBeVisible();
  });

  test('host: paste-form escape hatch is still reachable', async ({ page }) => {
    const stamp = Date.now();
    const slug = `restricted-esc-${stamp}`;

    await signInAs(page, HOST, 'host');
    await page.goto('/catalog/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill(`Escape hatch ${stamp}`);
    await page.getByRole('radio', { name: 'Restricted' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}/publish$`));

    // Switch to the paste form.
    await page.getByRole('tab', { name: 'I already have a manifest' }).click();
    await expect(page.getByRole('tab', { name: 'I already have a manifest' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The paste form's manifest textarea is visible.
    await expect(page.getByLabel('Croissant manifest')).toBeVisible();
  });
});

import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for the "Files" card on the dataset detail page:
 *
 *   - real filenames, not the `croissantId` UUIDs the card used to show;
 *   - the image preview dialog (open, focus, Escape, focus return);
 *   - the "Download all" link and its `?manifest=` flag.
 *
 * Runs against the seeded `idrid-grading-demo` dataset: 30 hosted
 * `image/jpeg` distributions, PUBLIC, none access-gated — so every file
 * is both previewable and bulk-downloadable. That dataset only exists
 * where `db:seed:demo` has run (local, dev, int), so each test skips
 * rather than fails when it's absent, and also when the catalog API
 * isn't reachable (the page then renders its error state with a 200).
 */

const SLUG = 'idrid-grading-demo';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function gotoDataset(page: Page) {
  const response = await page.goto(`/catalog/${SLUG}`);
  test.skip(response?.status() === 404, `${SLUG} is not seeded in this environment`);
  const unavailable = await page.getByText('Catalog unavailable', { exact: false }).count();
  test.skip(unavailable > 0, 'catalog API is not reachable from this environment');
  await expect(page.getByRole('heading', { name: /^Files$/ })).toBeVisible();
}

test.describe('dataset files card', () => {
  test('anonymous: rows are labelled with filenames, not UUIDs', async ({ page }) => {
    await gotoDataset(page);

    // The seeded slice keeps its source names (IDRiD_001.jpg …), which
    // is what `filename` derives from the storage key.
    await expect(page.getByText('IDRiD_001.jpg', { exact: true })).toBeVisible();

    // Regression guard on the bug this replaced: no row label is a bare
    // UUID. `croissantId` is still the fallback, but never for a row
    // whose bytes the platform holds.
    const uuidLabels = page.locator('p').filter({ hasText: UUID });
    await expect(uuidLabels).toHaveCount(0);
  });

  test('anonymous: every hosted image row offers a preview', async ({ page }) => {
    await gotoDataset(page);

    const downloadLinks = page.locator('a[href*="/distributions/"][href$="/download"]');
    const previewButtons = page.getByRole('button', { name: /^Preview / });
    const fileCount = await downloadLinks.count();
    expect(fileCount).toBeGreaterThan(0);

    // Every file in this dataset is an image, so the two counts match.
    // On a mixed dataset the preview count would be the smaller of the
    // two — non-image distributions get no preview action.
    await expect(previewButtons).toHaveCount(fileCount);
  });

  test('anonymous: preview opens, traps focus, closes on Escape and returns focus', async ({
    page,
  }) => {
    await gotoDataset(page);

    const trigger = page.getByRole('button', { name: 'Preview IDRiD_001.jpg' });
    await trigger.click();

    // Accessible name comes from the dialog's own heading — the
    // filename, so a screen-reader user knows which file they opened.
    const dialog = page.getByRole('dialog', { name: 'IDRiD_001.jpg' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Focus moved into the dialog (onto the close button).
    const close = dialog.getByRole('button', { name: /^Close preview of IDRiD_001\.jpg$/ });
    await expect(close).toBeFocused();

    // The image is the proxy download route — the same URL the row's
    // download link uses — with a meaningful alt.
    const image = dialog.getByRole('img', { name: 'Preview of IDRiD_001.jpg' });
    await expect(image).toHaveAttribute('src', /\/distributions\/[^/]+\/download$/);
    await expect(image).toBeVisible();

    // Focus is trapped: the close button is the dialog's only focusable
    // element, so Tab cycles through the document root and back to it —
    // and never reaches the trigger, or anything else behind the modal.
    await page.keyboard.press('Tab');
    await expect(trigger).not.toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('anonymous: preview closes on the close button and on backdrop click', async ({ page }) => {
    await gotoDataset(page);

    const trigger = page.getByRole('button', { name: 'Preview IDRiD_001.jpg' });
    const dialog = page.getByRole('dialog', { name: 'IDRiD_001.jpg' });

    await trigger.click();
    await dialog.getByRole('button', { name: /^Close preview of/ }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Backdrop: the <dialog> element paints it, so a click at the very
    // edge of the viewport lands on the element rather than the panel.
    await trigger.click();
    await expect(dialog).toBeVisible();
    await dialog.click({ position: { x: 2, y: 2 } });
    await expect(dialog).toBeHidden();
  });

  test('anonymous: download-all link carries the manifest flag the checkbox sets', async ({
    page,
  }) => {
    await gotoDataset(page);

    const link = page.getByRole('link', { name: 'Download all files' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `/catalog/${SLUG}/download?manifest=false`);

    // What the archive holds, and what it always holds.
    await expect(page.getByText(/A ZIP with all 30 files/)).toBeVisible();
    await expect(page.getByText(/LICENSE\.txt and CITATION\.txt/)).toBeVisible();

    const includeManifest = page.getByLabel(/Include metadata \(croissant\.json\)/);
    await includeManifest.check();
    await expect(link).toHaveAttribute('href', `/catalog/${SLUG}/download?manifest=true`);

    await includeManifest.uncheck();
    await expect(link).toHaveAttribute('href', `/catalog/${SLUG}/download?manifest=false`);
  });

  test('anonymous: the bulk archive route streams a ZIP', async ({ page }) => {
    await gotoDataset(page);

    // Fetch through Playwright's request context rather than clicking:
    // a real click hands the response to the browser's download
    // manager, which tells us nothing about the bytes.
    const res = await page.request.get(`/catalog/${SLUG}/download?manifest=true`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/application\/zip/);
    expect(res.headers()['content-disposition']).toMatch(/attachment/);

    const body = await res.body();
    // Local ZIP file header.
    expect(body.subarray(0, 4).toString('hex')).toBe('504b0304');
  });
});

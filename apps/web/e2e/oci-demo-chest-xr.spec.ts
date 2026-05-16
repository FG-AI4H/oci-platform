import { test, expect } from '@playwright/test';

/**
 * E2E for the OCI-curated demo dataset (#251). Verifies the end-to-
 * end S3 path works against the live local stack:
 *
 *   anonymous viewer → /catalog/oci-demo-chest-xr
 *     → "Files" card lists 5 hosted distributions
 *     → click the first download link
 *     → API 302s to a presigned S3 URL
 *     → bytes arrive with content-type image/png
 *
 * Pre-conditions:
 *   - docker compose -f infra/local/docker-compose.yml up -d
 *   - pnpm --filter @oci/database db:migrate:deploy
 *   - apps/migrate/upload-fixtures.mjs has been run once
 *     (uploads the bundled PNGs to oci-datasets-local in MinIO)
 *   - pnpm --filter @oci/database db:seed:demo
 *     (inserts the dataset + distribution rows)
 *   - pnpm --filter @oci/api dev    (API on :3000)
 *   - pnpm --filter @oci/web dev    (web on :3001)
 *
 * The deployed environments (dev / int) get all of this automatically
 * via the migrate ECS task on every deploy.
 */

const SLUG = 'oci-demo-chest-xr';

test.describe('OCI demo dataset — hosted file download', () => {
  test('anonymous: detail page lists 5 hosted files', async ({ page }) => {
    await page.goto(`/catalog/${SLUG}`);
    await expect(
      page.getByRole('heading', { name: /OCI Demo: Synthetic Chest XR/i }),
    ).toBeVisible();

    // The "Files" card title was softened from "Distributions" by #250.
    await expect(page.getByRole('heading', { name: /^Files$/ })).toBeVisible();

    // Each row carries a "hosted" badge (rendered when the
    // distribution is platform-hosted and the bytes are READY).
    const hostedBadges = page.getByText('hosted', { exact: true });
    await expect(hostedBadges).toHaveCount(5);

    // Five distinct download links, one per distribution.
    const downloadLinks = page.locator(`a[href*="/distributions/"][href$="/download"]`);
    await expect(downloadLinks).toHaveCount(5);
  });

  test('anonymous: clicking the first download yields image/png bytes', async ({ page }) => {
    await page.goto(`/catalog/${SLUG}`);

    // Grab the first hosted download link. The detail page emits a
    // web-side proxy URL (`/catalog/<slug>/distributions/<id>/
    // download`) — the proxy attaches the caller's bearer to the API
    // call and 302s to the presigned S3 URL.
    const firstLink = page.locator(`a[href*="/distributions/"][href$="/download"]`).first();
    const relativeHref = await firstLink.getAttribute('href');
    expect(relativeHref).toMatch(/^\/catalog\/oci-demo-chest-xr\/distributions\/[^/]+\/download$/);

    // Fetch via Playwright's request context — auto-follows the
    // proxy → API → S3 chain.
    const res = await page.request.get(relativeHref!);

    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/image\/png/);

    const body = await res.body();
    // PNG signature.
    expect(body.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    // Size matches what the manifest declares for sample-001.png.
    expect(body.length).toBe(43281);
  });
});

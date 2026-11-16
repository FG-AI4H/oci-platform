import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { test, expect } from '@playwright/test';

/**
 * E2E for the anonymous hosted-file download path (#251), against the
 * bundled `idrid-grading-demo` fixture (the PUBLIC / OPEN dataset with
 * bytes in S3). Verifies the end-to-end S3 path works on the live
 * local stack:
 *
 *   anonymous viewer → /catalog/idrid-grading-demo
 *     → "Files" card lists the 30 hosted distributions
 *     → click one download link
 *     → API 302s to a presigned S3 URL
 *     → bytes arrive with content-type image/jpeg
 *
 * This spec used to target `oci-demo-chest-xr`; that dataset is now
 * RESTRICTED at the REGISTERED tier so the access-request flow can be
 * demonstrated (#492), and is no longer visible to anonymous callers —
 * see `oci-demo-chest-xr.spec.ts` for its gated behaviour.
 *
 * Pre-conditions:
 *   - docker compose -f infra/local/docker-compose.yml up -d
 *   - pnpm --filter @oci/database db:migrate:deploy
 *   - apps/migrate/upload-fixtures.mjs has been run once
 *     (uploads the bundled fixture files to oci-datasets-local in MinIO)
 *   - pnpm --filter @oci/database db:seed:demo
 *     (inserts the dataset + distribution rows)
 *   - pnpm --filter @oci/api dev    (API on :3000)
 *   - pnpm --filter @oci/web dev    (web on :3001)
 *
 * The deployed environments (dev / int) get all of this automatically
 * via the migrate ECS task on every deploy.
 */

const SLUG = 'idrid-grading-demo';

const FIXTURE_MANIFEST = resolvePath(
  process.cwd(),
  `../../packages/database/seed/fixtures/${SLUG}/manifest.json`,
);

interface FixtureDistribution {
  '@id': string;
  name: string;
  contentSize: string;
}

function fixtureDistributions(): FixtureDistribution[] {
  const manifest = JSON.parse(readFileSync(FIXTURE_MANIFEST, 'utf8')) as {
    distribution: FixtureDistribution[];
  };
  return manifest.distribution;
}

test.describe('IDRiD demo dataset — hosted file download', () => {
  test('anonymous: detail page lists every hosted file', async ({ page }) => {
    const distributions = fixtureDistributions();
    await page.goto(`/catalog/${SLUG}`);
    await expect(page.getByRole('heading', { name: /IDRiD — DR Grading/i })).toBeVisible();

    // The "Files" card title was softened from "Distributions" by #250.
    await expect(page.getByRole('heading', { name: /^Files$/ })).toBeVisible();

    // Each row carries a "hosted" badge (rendered when the
    // distribution is platform-hosted and the bytes are READY).
    const hostedBadges = page.getByText('hosted', { exact: true });
    await expect(hostedBadges).toHaveCount(distributions.length);

    // One download link per distribution.
    const downloadLinks = page.locator(`a[href*="/distributions/"][href$="/download"]`);
    await expect(downloadLinks).toHaveCount(distributions.length);
  });

  test('anonymous: clicking a download yields image/jpeg bytes of the declared size', async ({
    page,
  }) => {
    const distributions = fixtureDistributions();
    await page.goto(`/catalog/${SLUG}`);

    // Grab the first hosted download link. The detail page emits a
    // web-side proxy URL (`/catalog/<slug>/distributions/<id>/
    // download`) — the proxy attaches the caller's bearer to the API
    // call and 302s to the presigned S3 URL.
    const firstLink = page.locator(`a[href*="/distributions/"][href$="/download"]`).first();
    const relativeHref = await firstLink.getAttribute('href');
    expect(relativeHref).toMatch(new RegExp(`^/catalog/${SLUG}/distributions/([^/]+)/download$`));

    // The distribution id in the URL is the manifest's @id, so the
    // declared size is known regardless of which file renders first.
    const distributionId = relativeHref!.split('/distributions/')[1]!.split('/')[0]!;
    const declared = distributions.find((d) => d['@id'] === distributionId);
    expect(declared, `distribution ${distributionId} is in manifest.json`).toBeDefined();
    const declaredBytes = Number.parseInt(declared!.contentSize, 10);

    // Fetch via Playwright's request context — auto-follows the
    // proxy → API → S3 chain.
    const res = await page.request.get(relativeHref!);

    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/image\/jpeg/);

    const body = await res.body();
    // JPEG SOI marker.
    expect(body.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    expect(body.length).toBe(declaredBytes);
  });
});

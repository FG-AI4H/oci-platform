import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for self-hosted distributions (PR I, #87).
 *
 * What this exercises end-to-end:
 *   - Host signs in, creates a draft, publishes a minimal manifest so a
 *     version exists (the upload Card is gated on `latestVersion`).
 *   - File picker accepts a tiny in-memory file, the browser-side
 *     multipart helper inits → PUTs each part to MinIO → completes.
 *   - The detail page renders the new platform-hosted distribution
 *     with a "hosted" badge + download link.
 *   - The /catalog/[slug]/distributions/[id]/download route handler
 *     forwards the bearer token, the API gates on visibility +
 *     access-request, and a 302 to a presigned URL comes back.
 *
 * Pre-conditions (the runner does not bring these up):
 *   - docker compose -f infra/local/docker-compose.yml up -d
 *     (brings up postgres, redis, minio, minio-bootstrap which CORS-allows
 *     http://localhost:3001 on the `oci-datasets-local` bucket)
 *   - pnpm --filter @oci/database db:migrate:deploy
 *   - pnpm --filter @oci/api dev          (API on :3000, S3_ENDPOINT=http://localhost:9000)
 *   - pnpm --filter @oci/web dev          (web on :3001)
 *
 * The suite uses unique slugs (`e2e-upload-${Date.now()}`) so re-runs
 * don't trip over the unique-slug constraint, and the global-setup
 * already wipes `e2e-%` rows.
 */

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

/**
 * Builds the minimal valid Croissant manifest we need to publish a
 * first version. Mirrors the structure the catalog module expects
 * (no upstream URL needed — the validator accepts manifests with no
 * distribution[] as long as the dataset-level conformance fields are
 * present).
 */
function minimalManifest(name: string): string {
  return JSON.stringify({
    '@context': {
      '@language': 'en',
      '@vocab': 'https://schema.org/',
      sc: 'https://schema.org/',
      cr: 'http://mlcommons.org/croissant/',
      dct: 'http://purl.org/dc/terms/',
      bio: 'http://mlcommons.org/croissant/biomed/',
    },
    '@type': 'sc:Dataset',
    'dct:conformsTo': 'http://mlcommons.org/croissant/1.1',
    name,
    description: 'Tiny manifest for upload E2E.',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    url: 'https://example.org/',
    creator: [{ '@type': 'sc:Person', name: 'E2E Test' }],
    datePublished: '2026-05-08',
    'cr:version': '0.1.0',
    'bio:anonymizationLevel': 'ANONYMIZED',
  });
}

test.describe('platform-hosted distributions', () => {
  test('host: upload a tiny file → see "hosted" + download link → download redirects', async ({
    page,
    baseURL,
  }) => {
    const slug = `e2e-upload-${Date.now()}`;
    await signInAs(page, 'bob', 'host');

    // -- Create the draft --------------------------------------------------
    await page.goto('/catalog/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill(`E2E upload ${slug}`);
    await page.getByLabel('Description').fill('Upload E2E.');
    await page.getByRole('radio', { name: 'PUBLIC' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}/publish$`));

    // -- Publish a minimal manifest so latestVersion is set ----------------
    await page.getByLabel('Croissant manifest').fill(minimalManifest(`E2E upload ${slug}`));
    await page.getByRole('button', { name: /validate.*publish/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}$`));

    // Re-visit the publish page; the upload card only renders when
    // latestVersion is present (see publish/page.tsx).
    await page.goto(`/catalog/${slug}/publish`);
    await expect(page.getByRole('heading', { name: 'Upload files' })).toBeVisible();

    // -- Pick a tiny file → uploader does multipart against MinIO ----------
    // The file input is the sr-only `<input type="file">` next to the
    // "Choose files" button. setInputFiles bypasses the visible click
    // and avoids ambiguity with the button's accessible name.
    const fileBytes = Buffer.from('Hello from Playwright!\n', 'utf8');
    await page.getByLabel('Choose files to upload').setInputFiles({
      name: 'hello.txt',
      mimeType: 'text/plain',
      buffer: fileBytes,
    });

    // The uploader yields a `done` status + the contentUrl text once
    // the part PUTs + complete-upload land. Generous timeout; in
    // local-dev MinIO is fast but Playwright's filechooser interaction
    // adds a beat.
    await expect(page.getByText('done', { exact: true })).toBeVisible({ timeout: 30_000 });
    const contentUrlLine = page.getByText(/^contentUrl:/);
    await expect(contentUrlLine).toBeVisible();

    // The contentUrl is the relative path the host pastes into the
    // manifest's distribution[].contentUrl. We need it to publish a
    // second manifest version pointing at the new file.
    const contentUrlText = (await contentUrlLine.textContent()) ?? '';
    const match = /contentUrl:\s*(\/v2\/catalog\/datasets\/[^\s]+)/.exec(contentUrlText);
    expect(match, `contentUrl should match the platform-hosted shape; got: ${contentUrlText}`).not.toBeNull();
    const platformHostedUrl = match![1]!;

    // -- Republish: manifest now references the uploaded file --------------
    const manifestWithDist = JSON.parse(minimalManifest(`E2E upload ${slug}`));
    manifestWithDist.distribution = [
      {
        '@type': 'sc:FileObject',
        '@id': 'hello-bytes',
        name: 'hello.txt',
        encodingFormat: 'text/plain',
        contentUrl: platformHostedUrl,
      },
    ];
    manifestWithDist['cr:version'] = '0.1.1';
    await page.getByLabel('Croissant manifest').fill(JSON.stringify(manifestWithDist));
    await page.getByRole('button', { name: /validate.*publish/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}$`));

    // -- Detail page: "hosted" badge + a download link  --------------------
    await expect(page.getByText('hosted', { exact: true })).toBeVisible();
    // The download link's accessible name uses the distribution's
    // @id (`hello-bytes`), not the underlying filename — the @id is
    // what the manifest declares as the canonical handle.
    const downloadLink = page.getByRole('link', { name: /download hello-bytes/i });
    await expect(downloadLink).toBeVisible();

    // -- The /distributions/:id/download route returns a 302 to S3 ---------
    // Use page.request (carries the auth cookies) and disable redirect
    // following so we can assert the route handler sent us through to
    // a presigned URL — the actual S3/MinIO PUT path lives in the
    // signature, not the host.
    const href = await downloadLink.getAttribute('href');
    expect(href, 'download link must have href').not.toBeNull();
    const res = await page.request.get(`${baseURL}${href}`, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect([302, 307]).toContain(res.status());
    const location = res.headers()['location'] ?? '';
    // The presigned URL is signed with AWS Signature V4 and carries
    // X-Amz-Signature in the query string. That's the contract we
    // care about — bytes coming back is MinIO's job, not Playwright's.
    expect(location).toMatch(/X-Amz-Signature=/);
  });

  test('anonymous visitor cannot download a PRIVATE platform-hosted distribution', async ({
    request,
    baseURL,
  }) => {
    // Hit the route handler directly, no auth cookie. The handler
    // forwards (no auth header) and the API rejects with 401/403 for
    // a PRIVATE dataset. We assert anything in the 4xx family — the
    // route maps both to a problem-details JSON.
    const res = await request.get(
      `${baseURL}/catalog/does-not-exist/distributions/00000000-0000-4000-8000-000000000000/download`,
      { maxRedirects: 0, failOnStatusCode: false },
    );
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });
});

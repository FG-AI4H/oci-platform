import { test, expect, type Page } from '@playwright/test';
import { manifestWizardInputToCroissant } from '@oci/croissant';
// The Part 10 writer of the header-reading package's own tests, reached
// by path: the web app does not depend on `@oci/dicom`.
import { ctSlice } from '../../../packages/dicom/src/test-support/build-part10';

/**
 * E2E for the operator's review of held DICOM images (#674, ADR-0026):
 * a host uploads images whose headers carry a patient id, other readers
 * do not see them, an operator reviews the findings and accepts them
 * with a reason, and the images are then there for everyone.
 *
 * The spec seeds what it needs through the upload API. Every file is
 * synthetic and every "patient" value is invented here. The slug is
 * `e2e-…`, so the suite's global setup removes it on the next run.
 *
 * Needs the local stack (API in local mode, an S3-compatible store, the
 * web app). Where that is missing every test skips rather than fails.
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const HOST_TOKEN = 'dev:e2e-review-host:host';
const SLUG = `e2e-review-${Date.now().toString(36)}`;
const NAME = `E2E held images ${SLUG.slice(-6)}`;
const SERIES = '1.2.826.0.1.3680043.8.498.674.95';
const IMAGES = 4;
// Invented. A study code and a shifted date, as a de-identified file has.
const PATIENT_CODE = 'E2E-STUDY-0042';
const STUDY_DATE = '20010101';
const REASON = 'Study codes and shifted dates, as agreed with the host.';

test.describe.configure({ mode: 'serial' });

async function api<T>(path: string, init: RequestInit = {}, token = HOST_TOKEN): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function upload(name: string, bytes: Uint8Array): Promise<string | null> {
  const contentType = 'application/dicom';
  const init = await api<{ uploadId: string; key: string }>(
    `/v2/catalog/datasets/${SLUG}/uploads`,
    {
      method: 'POST',
      body: JSON.stringify({ filename: name, contentType, contentSize: bytes.length }),
    },
  );
  const uploadId = encodeURIComponent(init.uploadId);
  const part = await api<{ url: string }>(
    `/v2/catalog/datasets/${SLUG}/uploads/${uploadId}/parts/1/url?key=${encodeURIComponent(init.key)}`,
  );
  const put = await fetch(part.url, { method: 'PUT', body: bytes });
  if (!put.ok) throw new Error(`PUT → ${put.status}`);
  const query = new URLSearchParams({
    key: init.key,
    contentType,
    contentSize: String(bytes.length),
  });
  const done = await api<{ dicomCheckStatus?: string | null }>(
    `/v2/catalog/datasets/${SLUG}/uploads/${uploadId}/complete?${query}`,
    {
      method: 'POST',
      body: JSON.stringify({
        parts: [{ partNumber: 1, etag: put.headers.get('etag') }],
        croissantId: name,
      }),
    },
  );
  return done.dicomCheckStatus ?? null;
}

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2F');
  await page.fill('#signin-user', user);
  await page.fill('#signin-roles', roles);
  await page.getByRole('button', { name: /Sign in \(local dev\)/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'));
}

let seedFailure: string | null = null;
const statuses: Array<string | null> = [];

test.beforeAll(async () => {
  try {
    await api('/v2/catalog/datasets', {
      method: 'POST',
      body: JSON.stringify({ slug: SLUG, name: NAME, visibility: 'PUBLIC' }),
    });
    await api(`/v2/catalog/datasets/${SLUG}/versions`, {
      method: 'POST',
      body: JSON.stringify({
        version: '1.0.0',
        croissant: manifestWizardInputToCroissant({
          conformsTo: 'http://mlcommons.org/croissant/1.1',
          name: NAME,
          description: 'Synthetic images for the end-to-end test of the operator review.',
          license: 'https://creativecommons.org/licenses/by/4.0/',
          homepage: 'https://example.org/',
          version: '1.0.0',
          datePublished: '2026-11-20',
          creators: [{ type: 'Organization', name: 'Test' }],
          imagingModality: [],
          bodyRegion: [],
          diseaseCondition: [],
          duoTerms: [],
          distributions: [],
        }),
      }),
    });
    for (let n = 1; n <= IMAGES; n += 1) {
      statuses.push(
        await upload(
          `held-${n}.dcm`,
          ctSlice([
            { tag: '00080018', vr: 'UI', value: `${SERIES}.${n}` },
            { tag: '00080020', vr: 'DA', value: STUDY_DATE },
            { tag: '00100020', vr: 'LO', value: PATIENT_CODE },
            { tag: '0020000e', vr: 'UI', value: SERIES },
            { tag: '00200013', vr: 'IS', value: String(n) },
            { tag: '00200032', vr: 'DS', value: `-100\\-100\\${n * 5}` },
          ]),
        ),
      );
    }
  } catch (err) {
    seedFailure = err instanceof Error ? err.message : String(err);
  }
});

test.beforeEach(() => {
  test.skip(seedFailure !== null, `local stack not available for seeding: ${seedFailure}`);
});

test.describe('operator review of held DICOM images', () => {
  test('the upload holds every image, and another reader sees none of them', async ({ page }) => {
    expect(statuses).toEqual(Array.from({ length: IMAGES }, () => 'HELD'));

    await page.goto(`/catalog/${SLUG}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Imaging series' })).toHaveCount(0);
    await expect(page.getByText('held-1.dcm')).toHaveCount(0);
  });

  test('the review is not for a host: the pages send them away and the API refuses', async ({
    page,
  }) => {
    await signInAs(page, 'e2e-review-host', 'host');

    await page.goto(`/admin/dicom/${SLUG}`);
    await expect(page).not.toHaveURL(/\/admin\//);
    await expect(page.getByText(PATIENT_CODE)).toHaveCount(0);

    const res = await fetch(`${API}/v2/storage/datasets/${SLUG}/dicom/findings`, {
      headers: { Authorization: `Bearer ${HOST_TOKEN}` },
    });
    expect(res.status).toBe(403);

    // The host does see their own held images, and is told why.
    await page.goto(`/catalog/${SLUG}`, { waitUntil: 'networkidle' });
    await expect(page.getByText(`${IMAGES} images are held`)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review the findings' })).toHaveCount(0);
  });

  test('an operator finds the dataset in the queue, with what was found and on how many images', async ({
    page,
  }) => {
    await signInAs(page, 'e2e-review-operator', 'admin');
    await page.goto('/admin');
    await page.getByRole('link', { name: /Held images/ }).click();
    await expect(page.getByRole('heading', { name: 'Held images', level: 1 })).toBeVisible();

    await page.getByRole('link', { name: `Review ${NAME}` }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/dicom/${SLUG}$`));
    await expect(page.getByRole('heading', { name: NAME, level: 1 })).toBeVisible();
    await expect(page.getByText(`${IMAGES} images are held for 2 findings.`)).toBeVisible();

    const patientId = page.getByRole('group', { name: 'Patient ID' });
    await expect(patientId).toContainText(PATIENT_CODE);
    await expect(patientId).toContainText(`${IMAGES} images · 1 series`);
    await expect(page.getByRole('group', { name: 'Study date' })).toContainText(STUDY_DATE);

    // Nothing is accepted by default, and nothing can be sent empty.
    for (const box of await page.getByRole('checkbox').all()) await expect(box).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Accept the selected findings' })).toBeDisabled();
  });

  test('accepting one of two findings releases nothing', async ({ page }) => {
    await signInAs(page, 'e2e-review-operator', 'admin');
    await page.goto(`/admin/dicom/${SLUG}`);

    await page.getByRole('group', { name: 'Patient ID' }).getByRole('checkbox').check();
    await expect(page.getByText('1 finding selected of 2.')).toBeVisible();
    await page.getByLabel(/^Reason/).fill(REASON);
    await page.getByRole('button', { name: 'Accept the selected findings' }).click();

    await expect(page.getByText(/Decision recorded\. 0 images released/)).toBeVisible();
    await expect(page.getByText(`${IMAGES} images still held for other findings.`)).toBeVisible();
    // The accepted finding is gone from the list; the other is still there.
    await expect(page.getByRole('group', { name: 'Patient ID' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Study date' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Decisions recorded' })).toBeVisible();
    await expect(page.getByText(REASON)).toBeVisible();

    const anonymous = await fetch(`${API}/v2/storage/datasets/${SLUG}/dicom/series`);
    expect(((await anonymous.json()) as { total: number }).total).toBe(0);
  });

  test('a reason is required, and what was ticked is kept', async ({ page }) => {
    await signInAs(page, 'e2e-review-operator', 'admin');
    await page.goto(`/admin/dicom/${SLUG}`);

    await page.getByRole('group', { name: 'Study date' }).getByRole('checkbox').check();
    const reason = page.getByLabel(/^Reason/);
    await reason.fill('ok');
    // Past the browser's own check, to see the server's answer.
    await reason.evaluate((el) => el.removeAttribute('minlength'));
    await page.getByRole('button', { name: 'Accept the selected findings' }).click();

    await expect(page.getByText('give a reason of at least 10 characters')).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'Study date' }).getByRole('checkbox'),
    ).toBeChecked();
    await expect(reason).toHaveValue('ok');
  });

  test('accepting the last finding releases the images, for every reader', async ({ page }) => {
    await signInAs(page, 'e2e-review-operator', 'admin');
    await page.goto(`/admin/dicom/${SLUG}`);

    await page.getByRole('group', { name: 'Study date' }).getByRole('checkbox').check();
    await page.getByLabel(/^Reason/).fill(REASON);
    await page.getByRole('button', { name: 'Accept the selected findings' }).click();

    await expect(page.getByText(`Decision recorded. ${IMAGES} images released`)).toBeVisible();
    await expect(
      page.getByText('Nothing is waiting for a decision on this dataset.'),
    ).toBeVisible();

    // The queue no longer lists the dataset.
    await page.goto('/admin/dicom');
    await expect(page.getByRole('link', { name: `Review ${NAME}` })).toHaveCount(0);

    // And a reader who is not signed in now has the series, and can open it.
    const anonymous = await page.context().browser()?.newContext();
    if (!anonymous) throw new Error('no browser');
    const reader = await anonymous.newPage();
    await reader.goto(`/catalog/${SLUG}`, { waitUntil: 'networkidle' });
    await expect(reader.getByRole('heading', { name: 'Imaging series' })).toBeVisible();
    await expect(reader.getByText(`${IMAGES} images`, { exact: false }).first()).toBeVisible();
    // No notice about held images (the file names here contain the word).
    await expect(reader.getByText(/images? (is|are) held/)).toHaveCount(0);
    await expect(reader.getByText('held-1.dcm')).toBeVisible();
    await reader.getByRole('button', { name: 'View CT series 2' }).click();
    await expect(reader.getByTestId('dicom-status')).toHaveText(`All ${IMAGES} images loaded`, {
      timeout: 60_000,
    });
    await anonymous.close();
  });

  test('a file uploaded later with the same values is not held again; a new value is', async () => {
    const same = await upload(
      'later.dcm',
      ctSlice([
        { tag: '00080018', vr: 'UI', value: `${SERIES}.99` },
        { tag: '00080020', vr: 'DA', value: STUDY_DATE },
        { tag: '00100020', vr: 'LO', value: PATIENT_CODE },
        { tag: '0020000e', vr: 'UI', value: SERIES },
        { tag: '00200013', vr: 'IS', value: '99' },
      ]),
    );
    expect(same).toBe('RELEASED');

    const other = await upload(
      'other-patient.dcm',
      ctSlice([
        { tag: '00080018', vr: 'UI', value: `${SERIES}.100` },
        { tag: '00100020', vr: 'LO', value: 'E2E-STUDY-0043' },
        { tag: '0020000e', vr: 'UI', value: SERIES },
      ]),
    );
    expect(other).toBe('HELD');
  });

  test('a burned-in annotation flag is accepted on the images held now, and holds the next one', async ({
    page,
  }) => {
    const burnedIn = (n: number) =>
      ctSlice([
        { tag: '00080018', vr: 'UI', value: `${SERIES}.2${n}` },
        { tag: '00080020', vr: 'DA', value: STUDY_DATE },
        { tag: '00100020', vr: 'LO', value: PATIENT_CODE },
        { tag: '0020000e', vr: 'UI', value: `${SERIES}.9` },
        { tag: '00280301', vr: 'CS', value: 'YES' },
      ]);
    // The code and the date are accepted already; the flag is not.
    expect(await upload('burned-1.dcm', burnedIn(1))).toBe('HELD');

    await signInAs(page, 'e2e-review-operator', 'admin');
    await page.goto(`/admin/dicom/${SLUG}`);
    const flag = page.getByRole('group', { name: 'Burned-in annotation' });
    await expect(flag).toContainText('No value to show');
    await expect(flag).toContainText(
      'An image uploaded later with the same finding is held again.',
    );
    await flag.getByRole('checkbox').check();
    await page.getByLabel(/^Reason/).fill('Looked at the image: the overlay is a scale bar.');
    await page.getByRole('button', { name: 'Accept the selected findings' }).click();
    await expect(page.getByText(/Decision recorded\. 1 image released/)).toBeVisible();

    // The same flag on a file nobody looked at.
    expect(await upload('burned-2.dcm', burnedIn(2))).toBe('HELD');
    await page.goto(`/admin/dicom/${SLUG}`);
    await expect(page.getByRole('group', { name: 'Burned-in annotation' })).toContainText(
      '1 image · 1 series',
    );
  });
});

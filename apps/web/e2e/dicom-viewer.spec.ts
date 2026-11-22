import { test, expect, type Page } from '@playwright/test';
import { manifestWizardInputToCroissant } from '@oci/croissant';
import { DicomViewSchema, type DicomSeriesDetail, type DicomSeriesList } from '@oci/shared-types';
// The Part 10 writer of the header-reading package's own tests. Reached
// by path, not through the package: the web app does not depend on
// `@oci/dicom`, and this file has no import of its own.
import { ctSlice } from '../../../packages/dicom/src/test-support/build-part10';

/**
 * E2E for the built-in DICOM viewer on the dataset page (#674, ADR-0026).
 *
 * The spec seeds what it needs through the upload API: a PUBLIC dataset
 * with a 12-image CT series and a series in a transfer syntax the
 * viewer has no decoder for. Every file is synthetic, generated here;
 * no patient data and no downloaded fixture. The slug is `e2e-…`, so
 * the suite's global setup removes it on the next run.
 *
 * Needs the local stack: the API in local mode (it accepts the `dev:`
 * bearer used to seed), an S3-compatible store, and the web app. Where
 * that is missing every test skips rather than fails.
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const HOST_TOKEN = 'dev:e2e-dicom-host:host';
const SLUG = `e2e-dicom-${Date.now().toString(36)}`;
const SIZE = 64;
const IMAGES = 12;
const CT_SERIES = '1.2.826.0.1.3680043.8.498.674.81';
const VIDEO_SERIES = '1.2.826.0.1.3680043.8.498.674.82';

/** Air, a soft-tissue disc with a dense rim, and a ring that grows with the slice. */
function phantom(n: number): Uint8Array {
  const out = new Int16Array(SIZE * SIZE);
  const centre = SIZE / 2;
  const ring = 6 + n;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const r = Math.hypot(x - centre, y - centre);
      let hu = -1000;
      if (r < 28) hu = 40;
      if (r < 28 && r > 25) hu = 700;
      if (Math.abs(r - ring) < 1.5) hu = 300;
      out[y * SIZE + x] = hu;
    }
  }
  return new Uint8Array(out.buffer);
}

function slice(series: string, seriesNumber: number, n: number, syntax?: string): Uint8Array {
  return ctSlice(
    [
      { tag: '00080018', vr: 'UI', value: `${series}.${n}` },
      { tag: '0020000e', vr: 'UI', value: series },
      { tag: '00200011', vr: 'IS', value: String(seriesNumber) },
      { tag: '00200013', vr: 'IS', value: String(n) },
      { tag: '00200032', vr: 'DS', value: `-16\\-16\\${n * 2}` },
      { tag: '00280002', vr: 'US', value: 1 },
      { tag: '00280010', vr: 'US', value: SIZE },
      { tag: '00280011', vr: 'US', value: SIZE },
      { tag: '00280101', vr: 'US', value: 16 },
      { tag: '00280102', vr: 'US', value: 15 },
      { tag: '00281052', vr: 'DS', value: '0' },
      { tag: '00281053', vr: 'DS', value: '1' },
      { tag: '7fe00010', vr: 'OW', value: phantom(n) },
    ],
    syntax,
  );
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${HOST_TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function upload(name: string, bytes: Uint8Array): Promise<void> {
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
  await api(`/v2/catalog/datasets/${SLUG}/uploads/${uploadId}/complete?${query}`, {
    method: 'POST',
    body: JSON.stringify({
      parts: [{ partNumber: 1, etag: put.headers.get('etag') }],
      croissantId: name,
    }),
  });
}

let seedFailure: string | null = null;

test.beforeAll(async () => {
  try {
    await api('/v2/catalog/datasets', {
      method: 'POST',
      body: JSON.stringify({ slug: SLUG, name: 'E2E DICOM viewer', visibility: 'PUBLIC' }),
    });
    await api(`/v2/catalog/datasets/${SLUG}/versions`, {
      method: 'POST',
      body: JSON.stringify({
        version: '1.0.0',
        croissant: manifestWizardInputToCroissant({
          conformsTo: 'http://mlcommons.org/croissant/1.1',
          name: 'E2E DICOM viewer',
          description: 'Synthetic images for the end-to-end test of the DICOM viewer.',
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
    // Uploaded from the last image to the first: the viewer has to
    // order the stack, not the upload.
    for (let n = IMAGES; n >= 1; n -= 1) {
      await upload(`ct-${String(n).padStart(2, '0')}.dcm`, slice(CT_SERIES, 1, n));
    }
    for (let n = 1; n <= 2; n += 1) {
      // MPEG-2 video: a transfer syntax the viewer has no decoder for.
      await upload(`video-${n}.dcm`, slice(VIDEO_SERIES, 2, n, '1.2.840.10008.1.2.4.100'));
    }
  } catch (err) {
    seedFailure = err instanceof Error ? err.message : String(err);
  }
});

async function openSeries(page: Page, title: string) {
  test.skip(seedFailure !== null, `local stack not available for seeding: ${seedFailure}`);
  await page.goto(`/catalog/${SLUG}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Imaging series' })).toBeVisible();
  await page.getByRole('button', { name: `View ${title}` }).click();
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}

const counter = (page: Page) => page.getByTestId('dicom-counter');
const windowReadout = (page: Page) => page.getByTestId('dicom-window');

test.describe('DICOM viewer on the dataset page', () => {
  test('anonymous: the dataset page lists its series, named without any DICOM UID', async ({
    page,
  }) => {
    test.skip(seedFailure !== null, `local stack not available for seeding: ${seedFailure}`);
    await page.goto(`/catalog/${SLUG}`, { waitUntil: 'networkidle' });

    const rows = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: /^View / }) });
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('CT series 1');
    await expect(rows.nth(0)).toContainText(`${IMAGES} images · ${SIZE} × ${SIZE}`);
    await expect(rows.nth(1)).toContainText('CT series 2');
    await expect(page.getByText('1.2.826.0.1.3680043', { exact: false })).toHaveCount(0);
    // Nothing is held, so nothing is said about held images.
    await expect(page.getByText(/held/)).toHaveCount(0);
  });

  test('anonymous: a series opens, loads whole, and is in stack order', async ({ page }) => {
    await openSeries(page, 'CT series 1');

    await expect(counter(page)).toHaveText(`1 / ${IMAGES}`, { timeout: 60_000 });
    await expect(page.getByTestId('dicom-status')).toHaveText(`All ${IMAGES} images loaded`, {
      timeout: 60_000,
    });
    // The window the files themselves propose.
    await expect(windowReadout(page)).toHaveText('W 80 · L 40');
    await expect(page.getByTestId('dicom-viewport')).toHaveAccessibleName(
      `CT series 1, image 1 of ${IMAGES}`,
    );
  });

  test('keyboard: arrows, page keys, Home and End move through the stack', async ({ page }) => {
    await openSeries(page, 'CT series 1');
    await expect(counter(page)).toHaveText(`1 / ${IMAGES}`, { timeout: 60_000 });

    const viewport = page.getByTestId('dicom-viewport');
    await viewport.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(counter(page)).toHaveText(`3 / ${IMAGES}`);
    await page.keyboard.press('ArrowUp');
    await expect(counter(page)).toHaveText(`2 / ${IMAGES}`);
    await page.keyboard.press('End');
    await expect(counter(page)).toHaveText(`${IMAGES} / ${IMAGES}`);
    await page.keyboard.press('ArrowDown');
    await expect(counter(page)).toHaveText(`${IMAGES} / ${IMAGES}`);
    await page.keyboard.press('PageUp');
    await expect(counter(page)).toHaveText(`2 / ${IMAGES}`);
    await page.keyboard.press('Home');
    await expect(counter(page)).toHaveText(`1 / ${IMAGES}`);
  });

  test('the slider and the wheel move through the stack', async ({ page }) => {
    await openSeries(page, 'CT series 1');
    await expect(counter(page)).toHaveText(`1 / ${IMAGES}`, { timeout: 60_000 });

    const slider = page.getByTestId('dicom-slider');
    await slider.fill('7');
    await expect(counter(page)).toHaveText(`7 / ${IMAGES}`);
    await expect(slider).toHaveAttribute('aria-valuetext', `Image 7 of ${IMAGES}`);

    // One notch of a mouse wheel is one image, never two: Chromium
    // reports a notch as 100 pixels.
    await page.getByTestId('dicom-viewport').hover();
    await page.mouse.wheel(0, 100);
    await expect(counter(page)).toHaveText(`8 / ${IMAGES}`);
    await page.mouse.wheel(0, 100);
    await expect(counter(page)).toHaveText(`9 / ${IMAGES}`);
    await page.mouse.wheel(0, -100);
    await expect(counter(page)).toHaveText(`8 / ${IMAGES}`);
  });

  test('window: presets, typed values and a drag all change it, and the picture with it', async ({
    page,
  }) => {
    await openSeries(page, 'CT series 1');
    await expect(page.getByTestId('dicom-status')).toHaveText(`All ${IMAGES} images loaded`, {
      timeout: 60_000,
    });
    const viewport = page.getByTestId('dicom-viewport');
    const picture = async () => (await viewport.screenshot()).toString('base64');

    const brain = page.getByRole('button', { name: 'Brain', exact: true });
    await expect(brain).toHaveAttribute('aria-pressed', 'true');
    const asBrain = await picture();

    const bone = page.getByRole('button', { name: 'Bone', exact: true });
    await bone.click();
    await expect(windowReadout(page)).toHaveText('W 2000 · L 500');
    await expect(bone).toHaveAttribute('aria-pressed', 'true');
    await expect(brain).toHaveAttribute('aria-pressed', 'false');
    expect(await picture()).not.toBe(asBrain);

    await page.getByRole('button', { name: 'Lung', exact: true }).click();
    await expect(windowReadout(page)).toHaveText('W 1500 · L -600');

    // Without dragging: type the numbers.
    await page.getByTestId('dicom-window-width').fill('400');
    await page.getByTestId('dicom-window-width').press('Enter');
    await page.getByTestId('dicom-window-level').fill('60');
    await page.getByTestId('dicom-window-level').press('Enter');
    await expect(windowReadout(page)).toHaveText('W 400 · L 60');

    const box = await viewport.boundingBox();
    if (!box) throw new Error('viewport has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    await expect(windowReadout(page)).not.toHaveText('W 400 · L 60');

    // A slow drag to the left narrows a narrow window. It must not be
    // rounded away one pixel at a time.
    await brain.click();
    await expect(windowReadout(page)).toHaveText('W 80 · L 40');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2, { steps: 20 });
    await page.mouse.up();
    await expect(windowReadout(page)).toHaveText('W 70 · L 40');
  });

  test('the view an answer stores follows the image drawn, the window and inversion', async ({
    page,
  }) => {
    test.skip(seedFailure !== null, `local stack not available for seeding: ${seedFailure}`);
    // The display order, as the API gives it. The files were uploaded
    // last to first, so this is not the upload order.
    const { series } = await api<DicomSeriesList>(`/v2/storage/datasets/${SLUG}/dicom/series`);
    const ct = series.find((s) => s.seriesNumber === 1);
    if (!ct) throw new Error('CT series 1 not indexed');
    const detail = await api<DicomSeriesDetail>(`/v2/storage/dicom/series/${ct.id}`);
    const ids = detail.instances.map((instance) => instance.distributionId);
    expect(ids).toHaveLength(IMAGES);

    await openSeries(page, 'CT series 1');
    await expect(page.getByTestId('dicom-status')).toHaveText(`All ${IMAGES} images loaded`, {
      timeout: 60_000,
    });
    const viewport = page.getByTestId('dicom-viewport');
    const view = async (): Promise<unknown> => {
      const raw = await viewport.getAttribute('data-view');
      return raw === null ? null : (JSON.parse(raw) as unknown);
    };

    await expect.poll(view).toEqual({
      distributionId: ids[0],
      position: 1,
      imageCount: IMAGES,
      window: { width: 80, center: 40 },
      inverted: false,
    });
    expect(DicomViewSchema.safeParse(await view()).success).toBe(true);

    await viewport.focus();
    await page.keyboard.press('End');
    await expect(counter(page)).toHaveText(`${IMAGES} / ${IMAGES}`);
    await expect.poll(view).toMatchObject({ distributionId: ids[IMAGES - 1], position: IMAGES });
    await page.keyboard.press('PageUp');
    await expect.poll(view).toMatchObject({ distributionId: ids[1], position: 2 });

    await page.getByRole('button', { name: 'Subdural', exact: true }).click();
    await expect(windowReadout(page)).toHaveText('W 200 · L 75');
    await expect.poll(view).toMatchObject({ position: 2, window: { width: 200, center: 75 } });

    await page.getByRole('button', { name: 'Invert', exact: true }).click();
    await expect.poll(view).toMatchObject({ inverted: true });
  });

  test('zoom, move and invert change the picture, and reset restores it', async ({ page }) => {
    await openSeries(page, 'CT series 1');
    await expect(page.getByTestId('dicom-status')).toHaveText(`All ${IMAGES} images loaded`, {
      timeout: 60_000,
    });
    const viewport = page.getByTestId('dicom-viewport');
    // Away from the edge: the focus ring is drawn there.
    const picture = async () => {
      const box = await viewport.boundingBox();
      if (!box) throw new Error('viewport has no box');
      const shot = await page.screenshot({
        clip: { x: box.x + 8, y: box.y + 8, width: box.width - 16, height: box.height - 16 },
      });
      return shot.toString('base64');
    };
    const original = await picture();

    await page.getByRole('button', { name: 'Zoom in' }).click();
    const zoomed = await picture();
    expect(zoomed).not.toBe(original);

    await page.getByRole('button', { name: 'Move right' }).click();
    expect(await picture()).not.toBe(zoomed);
    await viewport.focus();
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(picture).toBe(zoomed);

    const invert = page.getByRole('button', { name: 'Invert' });
    await page.keyboard.press('i');
    await expect(invert).toHaveAttribute('aria-pressed', 'true');
    expect(await picture()).not.toBe(zoomed);

    await page.keyboard.press('r');
    await expect(invert).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(picture).toBe(original);
  });

  test('the dialog closes on Escape and gives focus back to the row', async ({ page }) => {
    const dialog = await openSeries(page, 'CT series 1');
    await expect(counter(page)).toHaveText(`1 / ${IMAGES}`, { timeout: 60_000 });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'View CT series 1' })).toBeFocused();
  });

  test('a series the viewer cannot decode says so and names the compression', async ({ page }) => {
    const dialog = await openSeries(page, 'CT series 2');

    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText('The viewer cannot decode this series', { timeout: 60_000 });
    await expect(alert).toContainText('MPEG-2 video (1.2.840.10008.1.2.4.100)');
    await expect(page.getByTestId('dicom-slider')).toHaveCount(0);
  });

  test.describe('when storage refuses', () => {
    const storageOrigin = new URL(process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:9000').origin;
    const refusal = {
      status: 403,
      body: 'Request has expired',
      headers: { 'access-control-allow-origin': '*' },
    };
    const isSeriesRequest = (url: string) =>
      /\/dicom\/series\/[0-9a-f-]+$/.test(new URL(url).pathname);

    test('addresses part-way: the viewer renews them once and loads everything', async ({
      page,
      context,
    }) => {
      test.skip(seedFailure !== null, `local stack not available for seeding: ${seedFailure}`);
      let seriesRequests = 0;
      page.on('request', (request) => {
        if (isSeriesRequest(request.url())) seriesRequests += 1;
      });
      // What an expired signature looks like: after three files, storage
      // refuses, until the series has been asked for once more. (In dev,
      // React runs the effect twice, so count from the first refusal.)
      let served = 0;
      let askedWhenRefusalBegan: number | null = null;
      await context.route(
        (url) => url.origin === storageOrigin,
        async (route) => {
          if (
            served >= 3 &&
            (askedWhenRefusalBegan === null || seriesRequests === askedWhenRefusalBegan)
          ) {
            askedWhenRefusalBegan ??= seriesRequests;
            await route.fulfill(refusal);
            return;
          }
          served += 1;
          await route.continue();
        },
      );

      const dialog = await openSeries(page, 'CT series 1');
      await expect(page.getByTestId('dicom-status')).toHaveText(`All ${IMAGES} images loaded`, {
        timeout: 60_000,
      });
      expect(askedWhenRefusalBegan).not.toBeNull();
      expect(seriesRequests).toBe((askedWhenRefusalBegan ?? 0) + 1);
      await expect(dialog.getByRole('alert')).toHaveCount(0);
    });

    test('the first image, once: the series still opens', async ({ page, context }) => {
      test.skip(seedFailure !== null, `local stack not available for seeding: ${seedFailure}`);
      let refusedOnce = false;
      await context.route(
        (url) => url.origin === storageOrigin && url.pathname.endsWith('/ct-01.dcm'),
        async (route) => {
          if (!refusedOnce) {
            refusedOnce = true;
            await route.fulfill(refusal);
            return;
          }
          await route.continue();
        },
      );

      await openSeries(page, 'CT series 1');
      await expect(page.getByTestId('dicom-status')).toHaveText(`All ${IMAGES} images loaded`, {
        timeout: 60_000,
      });
      expect(refusedOnce).toBe(true);
      await expect(counter(page)).toHaveText(`1 / ${IMAGES}`);
    });

    test('the first image, for good: an error, not a black box that claims to be an image', async ({
      page,
      context,
    }) => {
      test.skip(seedFailure !== null, `local stack not available for seeding: ${seedFailure}`);
      await context.route(
        (url) => url.origin === storageOrigin && url.pathname.endsWith('/ct-01.dcm'),
        (route) => route.fulfill(refusal),
      );

      const dialog = await openSeries(page, 'CT series 1');
      await expect(dialog.getByRole('alert')).toContainText('The series could not be opened', {
        timeout: 60_000,
      });
      await expect(counter(page)).toHaveCount(0);
      await expect(page.getByTestId('dicom-status')).not.toContainText('loaded');
    });

    test('one image, for good: it is named when reached, and the others are all there', async ({
      page,
      context,
    }) => {
      test.skip(seedFailure !== null, `local stack not available for seeding: ${seedFailure}`);
      await context.route(
        (url) => url.origin === storageOrigin && url.pathname.endsWith('/ct-07.dcm'),
        (route) => route.fulfill(refusal),
      );

      const dialog = await openSeries(page, 'CT series 1');
      await expect(page.getByTestId('dicom-status')).toHaveText(
        `${IMAGES - 1} of ${IMAGES} images loaded, 1 could not be loaded`,
        { timeout: 90_000 },
      );
      await expect(dialog.getByRole('alert')).toContainText(
        `1 of ${IMAGES} images could not be loaded`,
      );

      const viewport = page.getByTestId('dicom-viewport');
      const standIn = page.getByTestId('dicom-stand-in');
      await viewport.focus();
      for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowDown');
      await expect(counter(page)).toHaveText(`6 / ${IMAGES}`);
      await expect(standIn).toHaveCount(0);

      // The missing image is a position of its own: the counter moves
      // to it, and the previous picture does not pass for it.
      await page.keyboard.press('ArrowDown');
      await expect(counter(page)).toHaveText(`7 / ${IMAGES}`);
      await expect(standIn).toHaveText('Image 7 could not be loaded');
      // No image is on screen, so none may be recorded as seen.
      await expect(viewport).not.toHaveAttribute('data-view');

      await page.keyboard.press('ArrowDown');
      await expect(counter(page)).toHaveText(`8 / ${IMAGES}`);
      await expect(standIn).toHaveCount(0);
      await expect(viewport).toHaveAttribute('data-view', /"position":8,/);

      await page.getByTestId('dicom-slider').fill('7');
      await expect(counter(page)).toHaveText(`7 / ${IMAGES}`);
      await expect(standIn).toHaveText('Image 7 could not be loaded');
      // Back on the image: the slider has the focus after `fill`.
      await viewport.focus();
      await page.keyboard.press('ArrowUp');
      await expect(counter(page)).toHaveText(`6 / ${IMAGES}`);
      await expect(standIn).toHaveCount(0);
    });

    test('and the renewal fails too: what is on screen stays', async ({ page, context }) => {
      test.skip(seedFailure !== null, `local stack not available for seeding: ${seedFailure}`);
      // Storage refuses after three files, and from then on the web app
      // cannot renew either: the session ran out.
      let served = 0;
      let refusing = false;
      await context.route(
        (url) => url.origin === storageOrigin,
        async (route) => {
          if (served >= 3) {
            refusing = true;
            await route.fulfill(refusal);
            return;
          }
          served += 1;
          await route.continue();
        },
      );
      await context.route(
        (url) => isSeriesRequest(url.href),
        async (route) => {
          if (refusing) {
            await route.fulfill({ status: 401, body: '{"message":"Sign in"}' });
            return;
          }
          await route.continue();
        },
      );

      const dialog = await openSeries(page, 'CT series 1');
      await expect(page.getByTestId('dicom-status')).toContainText('could not be loaded', {
        timeout: 90_000,
      });
      // Still a viewer, on its first image, saying what is missing.
      await expect(counter(page)).toHaveText(`1 / ${IMAGES}`);
      await expect(dialog.getByRole('alert')).toContainText('images could not be loaded');
      await expect(dialog.getByText('The viewer could not start')).toHaveCount(0);
    });
  });
});

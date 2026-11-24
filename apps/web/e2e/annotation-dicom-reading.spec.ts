import { test, expect, type Page, type Request } from '@playwright/test';
import { createDicomDataset, ctPhantomSlice, uploadDicom } from './support/synthetic-dicom';

/**
 * Reading a DICOM series as an annotation task (#674, #646), end to
 * end against the local stack, with real files in object storage:
 *
 *   1. A campaign manager makes one task per series of the pinned
 *      version. A series with a held image is left out (ADR-0026).
 *   2. Three readers each open the series in the built-in viewer, move
 *      to a slice, set a window and answer. The answer carries what
 *      was on screen; while the image is not drawn it is not sent.
 *   3. An arbiter who read none of it sees the series and the three
 *      answers, and settles it with a reason; that answer carries the
 *      view too.
 *
 * The API refuses an answer on a series without a matching view (its
 * unit tests); this spec checks the browser sends the view the viewer
 * shows. Every file is synthetic, generated here.
 */

const STAMP = Date.now().toString(36);
const DATASET = `e2e-dicom-reading-${STAMP}`;
const IMAGES = 8;
const CT_SERIES = '1.2.826.0.1.3680043.8.498.674.91';
const HELD_SERIES = '1.2.826.0.1.3680043.8.498.674.92';
const SAVED = /your annotation was saved/i;

let seedFailure: string | null = null;

test.beforeAll(async () => {
  try {
    await createDicomDataset(DATASET, 'E2E DICOM reading');
    // Last to first: the order on screen comes from the headers.
    for (let n = IMAGES; n >= 1; n -= 1) {
      await uploadDicom(DATASET, `ct-${n}.dcm`, ctPhantomSlice(CT_SERIES, 1, n));
    }
    await uploadDicom(DATASET, 'other-1.dcm', ctPhantomSlice(HELD_SERIES, 2, 1));
    // A made-up patient code: the check holds the file, and its series
    // can make no task.
    await uploadDicom(
      DATASET,
      'other-2.dcm',
      ctPhantomSlice(HELD_SERIES, 2, 2, [{ tag: '00100020', vr: 'LO', value: 'E2E-0001' }]),
    );
  } catch (err) {
    seedFailure = err instanceof Error ? err.message : String(err);
  }
});

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

/** A started campaign with labels and three readers, its tasks made; returns its slug. */
async function seriesCampaign(page: Page): Promise<string> {
  const slug = `e2e-series-${Date.now()}`;
  await signInAs(page, 'cm', 'campaign-manager');
  await page.goto(`/annotation/campaigns/new?datasetSlug=${DATASET}`);
  await page.getByLabel('Slug').fill(slug);
  await page.getByLabel('Name').fill(`Series reading ${slug}`);
  await page.getByRole('radio', { name: 'Classification' }).check();
  await page.getByRole('textbox', { name: 'Labels' }).fill('No bleed\nBleed');
  await page.getByRole('checkbox', { name: /cannot assess/i }).check();
  const tool = page.getByLabel('Annotation tool');
  const value = await tool
    .locator('option', { hasText: 'MONAI Label' })
    .first()
    .getAttribute('value');
  await tool.selectOption(value ?? '');
  await page.getByLabel('Annotators per data point').fill('3');
  await page.getByRole('button', { name: /create draft/i }).click();
  await expect(page).toHaveURL(new RegExp(`/annotation/campaigns/${slug}$`));
  await page.getByRole('button', { name: 'Mark ready' }).click();
  await page.getByRole('button', { name: /confirm: mark ready/i }).click();
  await page.getByRole('button', { name: 'Start campaign' }).click();
  await page.getByRole('button', { name: /confirm: start campaign/i }).click();

  await page.getByRole('button', { name: 'Count files and series' }).click();
  const status = page.getByRole('status');
  await expect(status).toContainText('1 sample matches: 1 new task.');
  await expect(status).toContainText(
    '1 DICOM series was left out: it has images held for de-identification findings.',
  );
  await page.getByRole('button', { name: /^Create 1 task$/ }).click();
  await expect(page.getByText(/^Created 1 task\. 1 DICOM series was left out/)).toBeVisible();
  return slug;
}

const counter = (page: Page) => page.getByTestId('dicom-counter');
const viewport = (page: Page) => page.getByTestId('dicom-viewport');

async function shownView(page: Page): Promise<string> {
  const raw = await viewport(page).getAttribute('data-view');
  if (!raw) throw new Error('the viewer shows no view');
  return raw;
}

/** The form post that carries the answer to the web app's server action. */
function answerPost(page: Page): Promise<Request> {
  return page.waitForRequest(
    (r) => r.method() === 'POST' && (r.postData() ?? '').includes('"distributionId"'),
  );
}

test.describe('reading a DICOM series as a task (#674)', () => {
  test.beforeEach(() => {
    test.skip(seedFailure !== null, `local stack not available for seeding: ${seedFailure}`);
  });

  test('three readers answer with what was on screen; an arbiter settles it, the series in view', async ({
    browser,
    page,
  }) => {
    test.setTimeout(180_000);
    const manager = await browser.newPage();
    const slug = await seriesCampaign(manager);

    const stamp = Date.now();
    const readings = [
      { reader: `ct-reader-a-${stamp}`, label: 'No bleed', slice: 1, preset: null },
      { reader: `ct-reader-b-${stamp}`, label: 'Bleed', slice: 5, preset: 'Subdural' },
      { reader: `ct-reader-c-${stamp}`, label: 'Cannot assess', slice: 8, preset: 'Bone' },
    ];
    for (const [i, { reader, label, slice, preset }] of readings.entries()) {
      const p = await browser.newPage();
      await signInAs(p, reader, 'annotator');

      // The first reader tries to answer before the image is drawn.
      let release: () => void = () => undefined;
      if (i === 0) {
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        await p.route(
          (url) => url.searchParams.has('X-Amz-Signature') && url.pathname.endsWith('.dcm'),
          async (route) => {
            await gate;
            await route.continue();
          },
        );
      }

      await p.goto(`/annotation/campaigns/${slug}/annotate`);
      await p.getByRole('button', { name: /^start$/i }).click();
      await expect(viewport(p)).toBeVisible();
      // Nothing on the page names the file or the dataset.
      await expect(p.getByText(/ct-\d+\.dcm/)).toHaveCount(0);
      await expect(p.getByText(DATASET)).toHaveCount(0);

      if (i === 0) {
        await p.getByRole('radio', { name: label, exact: true }).check();
        await p.getByRole('button', { name: /^submit/i }).click();
        await expect(p.getByText(/the image is not on screen yet/i)).toBeVisible();
        release();
      }

      await expect(counter(p)).toHaveText(`1 / ${IMAGES}`, { timeout: 60_000 });
      await p.getByTestId('dicom-slider').fill(String(slice));
      await expect(counter(p)).toHaveText(`${slice} / ${IMAGES}`);
      if (preset) await p.getByRole('button', { name: preset, exact: true }).click();
      await expect
        .poll(async () => JSON.parse(await shownView(p)) as unknown)
        .toMatchObject({
          position: slice,
          imageCount: IMAGES,
          window: preset === 'Bone' ? { width: 2000, center: 500 } : expect.any(Object),
        });
      const shown = await shownView(p);

      await p.getByRole('radio', { name: label, exact: true }).check();
      const posted = answerPost(p);
      await p.getByRole('button', { name: /^submit/i }).click();
      // What the form sent is what the screen showed.
      expect((await posted).postData()).toContain(shown);
      await expect(p.getByRole('status')).toHaveText(SAVED);
      await p.close();
    }

    // An arbiter who read none of it.
    await signInAs(page, `ct-arbiter-${stamp}`, 'arbitration-annotator');
    await page.goto(`/annotation/campaigns/${slug}/annotate`);
    await page.getByRole('button', { name: /^start$/i }).click();
    await expect(counter(page)).toHaveText(`1 / ${IMAGES}`, { timeout: 60_000 });
    const answered = page.getByRole('region', { name: 'What the readers answered' });
    await expect(answered.getByText('No bleed', { exact: true })).toHaveCount(1);
    await expect(answered.getByText('Bleed', { exact: true })).toHaveCount(1);
    for (const { reader } of readings) await expect(page.getByText(reader)).toHaveCount(0);

    await page.getByTestId('dicom-slider').fill('5');
    await expect(counter(page)).toHaveText(`5 / ${IMAGES}`);
    await expect
      .poll(async () => JSON.parse(await shownView(page)) as unknown)
      .toMatchObject({
        position: 5,
      });
    const shown = await shownView(page);
    await page.getByRole('radio', { name: 'Bleed', exact: true }).check();
    await page
      .getByRole('textbox', { name: 'Reason' })
      .fill('Thin subdural collection on slice 5.');
    const posted = answerPost(page);
    await page.getByRole('button', { name: /^submit/i }).click();
    expect((await posted).postData()).toContain(shown);
    await expect(page.getByRole('status')).toHaveText(SAVED);

    await manager.reload();
    const tasksSummary = manager.locator('dl', {
      has: manager.locator('dt', { hasText: /^Total$/ }),
    });
    await expect(
      tasksSummary
        .locator('div', { has: manager.locator('dt', { hasText: /^Completed$/ }) })
        .locator('dd'),
    ).toHaveText('1');
    await manager.close();
  });
});

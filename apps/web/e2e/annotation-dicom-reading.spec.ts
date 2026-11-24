import AxeBuilder from '@axe-core/playwright';
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
 *      answers, each with the image and window it was given on, shows
 *      two of them in the viewer, and settles it with a reason; that
 *      answer carries the view too.
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
/** A dataset whose one series is declared lossy 12-bit JPEG, which the viewer refuses (#778). */
const JPEG12_DATASET = `e2e-dicom-reading-jpeg12-${STAMP}`;
const JPEG12_SERIES = '1.2.826.0.1.3680043.8.498.674.93';
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
    await createDicomDataset(JPEG12_DATASET, 'E2E DICOM reading, lossy JPEG');
    for (let n = 1; n <= 2; n += 1) {
      await uploadDicom(
        JPEG12_DATASET,
        `jpeg12-${n}.dcm`,
        ctPhantomSlice(JPEG12_SERIES, 1, n, [], '1.2.840.10008.1.2.4.51'),
      );
    }
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

/**
 * A started campaign with labels, its tasks made; returns its slug. The
 * reading dataset has one series to read and one held; the other, one
 * series and nothing held.
 */
async function seriesCampaign(
  page: Page,
  options: { dataset?: string; readers?: number } = {},
): Promise<string> {
  const dataset = options.dataset ?? DATASET;
  const slug = `e2e-series-${Date.now()}`;
  await signInAs(page, 'cm', 'campaign-manager');
  await page.goto(`/annotation/campaigns/new?datasetSlug=${dataset}`);
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
  await page.getByLabel('Annotators per data point').fill(String(options.readers ?? 3));
  await page.getByRole('button', { name: /create draft/i }).click();
  await expect(page).toHaveURL(new RegExp(`/annotation/campaigns/${slug}$`));
  await page.getByRole('button', { name: 'Mark ready' }).click();
  await page.getByRole('button', { name: /confirm: mark ready/i }).click();
  await page.getByRole('button', { name: 'Start campaign' }).click();
  await page.getByRole('button', { name: /confirm: start campaign/i }).click();

  await page.getByRole('button', { name: 'Count files and series' }).click();
  const status = page.getByRole('status');
  await expect(status).toContainText('1 sample matches: 1 new task.');
  const held = dataset === DATASET;
  if (held) {
    await expect(status).toContainText(
      '1 DICOM series was left out: it has images held for de-identification findings.',
    );
  }
  await page.getByRole('button', { name: /^Create 1 task$/ }).click();
  await expect(page.getByText(/^Created 1 task\./)).toBeVisible();
  return slug;
}

const counter = (page: Page) => page.getByTestId('dicom-counter');
const viewport = (page: Page) => page.getByTestId('dicom-viewport');

async function shownView(page: Page): Promise<string> {
  const raw = await viewport(page).getAttribute('data-view');
  if (!raw) throw new Error('the viewer shows no view');
  return raw;
}

/** A key as a French (AZERTY) keyboard sends it: what it types, and the physical key. */
async function pressAzerty(page: Page, key: string, code: string) {
  await viewport(page).evaluate(
    (element, k) => {
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: k.key, code: k.code, bubbles: true, cancelable: true }),
      );
    },
    { key, code },
  );
  // Let the viewer draw whatever the key did before anyone looks.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
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
        // Submit stays disabled until the image is drawn, as for a plain
        // image (#646 review, item 5); the action's own check is the
        // backstop behind it.
        await p.getByRole('radio', { name: label, exact: true }).check();
        await expect(p.getByRole('button', { name: /^submit/i })).toBeDisabled();
        await expect(p.getByText(/submit is available once the image is on screen/i)).toBeVisible();
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

    // On a French keyboard the 6 key types "-". In the viewer it is not a
    // zoom (and with no answer 6 it does nothing); the minus key still is.
    await expect(page.getByTestId('dicom-status')).toHaveText(`All ${IMAGES} images loaded`);
    await viewport(page).focus();
    const before = await viewport(page).screenshot();
    await pressAzerty(page, '-', 'Digit6');
    expect((await viewport(page).screenshot()).equals(before)).toBe(true);
    await pressAzerty(page, '-', 'Minus');
    expect((await viewport(page).screenshot()).equals(before)).toBe(false);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();

    // Where each reader was when they answered (#674), and a way to look there.
    await expect(answered.getByText(`Image 5 of ${IMAGES} · W 200 · L 75`)).toBeVisible();
    await expect(answered.getByText(`Image 8 of ${IMAGES} · W 2000 · L 500`)).toBeVisible();
    await expect(answered.getByText(`Image 1 of ${IMAGES} · W 80 · L 40`)).toBeVisible();
    const windowReadout = page.getByTestId('dicom-window');
    await answered.getByRole('button', { name: 'Show image 8' }).click();
    await expect(counter(page)).toHaveText(`8 / ${IMAGES}`);
    await expect(windowReadout).toHaveText('W 2000 · L 500');
    await answered.getByRole('button', { name: 'Show image 5' }).click();
    await expect(counter(page)).toHaveText(`5 / ${IMAGES}`);
    await expect(windowReadout).toHaveText('W 200 · L 75');
    // The presets fade to their new colours: check contrast once they have.
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== 'running'),
    );
    const axe = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      axe.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`),
      'axe violations on the arbitration page of a series',
    ).toEqual([]);
    // The arbiter answers on what they were shown.
    await expect
      .poll(async () => JSON.parse(await shownView(page)) as unknown)
      .toMatchObject({ position: 5, window: { width: 200, center: 75 } });
    const shown = await shownView(page);
    // The 2 key types "é" on a French keyboard: in the viewer it picks answer 2.
    await viewport(page).focus();
    await pressAzerty(page, 'é', 'Digit2');
    await expect(page.getByRole('radio', { name: 'Bleed', exact: true })).toBeChecked();
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

  test('a series the viewer refuses tells the reader to skip the task, not to download it', async ({
    browser,
    page,
  }) => {
    const manager = await browser.newPage();
    const slug = await seriesCampaign(manager, { dataset: JPEG12_DATASET, readers: 1 });
    await manager.close();

    await signInAs(page, `ct-reader-jpeg12-${Date.now()}`, 'annotator');
    await page.goto(`/annotation/campaigns/${slug}/annotate`);
    await page.getByRole('button', { name: /^start$/i }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'cannot show this series faithfully' });
    await expect(alert).toBeVisible({ timeout: 60_000 });
    // On a task screen there is no viewer to close and no file to download.
    await expect(alert).toContainText('Skip this task and tell the campaign manager.');
    await expect(alert).not.toContainText('Download');
    // Skip is there to do it.
    await expect(page.getByRole('button', { name: /^skip/i })).toBeVisible();
  });
});

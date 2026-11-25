import { readFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

/**
 * Reading images in the browser (#646), end to end:
 *
 *   1. A campaign manager creates a CLASSIFICATION campaign with labels
 *      on the hosted IDRiD demo slice, starts it, and creates its tasks
 *      from the dataset's files without typing a file name.
 *   2. An annotator reads three images and skips one, keyboard only:
 *      Enter starts, a number picks the label, Enter submits.
 *   3. Three readers disagree on an image; an arbiter who read none of
 *      it sees the image and the three answers without names, and
 *      settles it with a reason. A reader who is also an arbiter is not
 *      given the task they read.
 *
 * Local runs have no object storage (no MinIO image), so the browser's
 * requests for the signed image addresses are answered here with the
 * matching seed fixture. Everything up to the address — the task, the
 * signing, who may see it — is the real API.
 *
 * Pre-conditions: the local stack with `db:seed:demo` (see
 * annotation-task-workflow.spec.ts).
 */

const DATASET_SLUG = 'idrid-grading-demo';
// Playwright runs from apps/web (like access-requests.spec.ts).
const FIXTURES = path.resolve(
  process.cwd(),
  '../../packages/database/seed/fixtures/idrid-grading-demo',
);
const SAVED = /your annotation was saved/i;

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

/** Answer signed image requests with the seed fixture of the same name. */
async function serveSignedImages(page: Page) {
  await page.route(
    (url) => url.searchParams.has('X-Amz-Signature') && url.pathname.includes(`/${DATASET_SLUG}/`),
    async (route) => {
      const name = path.basename(new URL(route.request().url()).pathname);
      await route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        body: readFileSync(path.join(FIXTURES, name)),
      });
    },
  );
}

/** Create, start and fill a labelled campaign; returns its slug. */
async function labelledCampaignWithTasks(
  page: Page,
  taskCount: number,
  options: { readers?: number; allowComment?: boolean } = {},
): Promise<string> {
  const slug = `e2e-images-${Date.now()}`;
  await signInAs(page, 'cm', 'campaign-manager');
  await page.goto(`/annotation/campaigns/new?datasetSlug=${DATASET_SLUG}`);
  await page.getByLabel('Slug').fill(slug);
  await page.getByLabel('Name').fill(`Image reading ${slug}`);
  await page.getByRole('radio', { name: 'Classification' }).check();
  await page
    .getByRole('textbox', { name: 'Labels' })
    .fill('No DR\nMild NPDR\nModerate NPDR or worse');
  await page.getByRole('checkbox', { name: /cannot assess/i }).check();
  if (options.allowComment) {
    await page.getByRole('checkbox', { name: /add a comment/i }).check();
  }
  const tool = page.getByLabel('Annotation tool');
  const value = await tool
    .locator('option', { hasText: 'MONAI Label' })
    .first()
    .getAttribute('value');
  await tool.selectOption(value ?? '');
  await page.getByLabel('Annotators per data point').fill(String(options.readers ?? 1));
  await page.getByRole('button', { name: /create draft/i }).click();
  await expect(page).toHaveURL(new RegExp(`/annotation/campaigns/${slug}$`));

  await page.getByRole('button', { name: 'Mark ready' }).click();
  await page.getByRole('button', { name: /confirm: mark ready/i }).click();
  await page.getByRole('button', { name: 'Start campaign' }).click();
  await page.getByRole('button', { name: /confirm: start campaign/i }).click();
  await expect(page.getByRole('button', { name: 'Count files and series' })).toBeVisible();

  // Tasks from the dataset's files: count first, then confirm.
  await page.getByLabel('At most').fill(String(taskCount));
  await page.getByRole('button', { name: 'Count files and series' }).click();
  await expect(page.getByRole('status')).toHaveText(
    new RegExp(`^${taskCount} samples? match(es)?: ${taskCount} new tasks?\\.$`),
  );
  await page.getByRole('button', { name: new RegExp(`^Create ${taskCount} tasks?$`) }).click();
  await expect(page.getByText(new RegExp(`^Created ${taskCount} tasks?\\.$`))).toBeVisible();

  // Running it again creates nothing new.
  await page.getByRole('button', { name: 'Count files and series' }).click();
  await expect(page.getByRole('status')).toHaveText(
    new RegExp(
      `^${taskCount} samples? match(es)?: 0 new tasks, ${taskCount} already ha(s|ve) one\\.$`,
    ),
  );
  await expect(page.getByRole('button', { name: /^Create \d/ })).toHaveCount(0);
  return slug;
}

async function expectImageShown(page: Page) {
  const img = page.getByRole('img', { name: /image to read/i });
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
  // The file name can carry the answer: it is not on the page.
  await expect(page.getByText(/IDRiD_\d+/)).toHaveCount(0);
}

test.describe('reading images in the browser (#646)', () => {
  test('a manager creates the tasks from files; an annotator reads three images and skips one by keyboard', async ({
    page,
    browser,
  }) => {
    const manager = await browser.newPage();
    const slug = await labelledCampaignWithTasks(manager, 4);

    await serveSignedImages(page);
    await signInAs(page, `reader-${Date.now()}`, 'annotator');
    await page.goto(`/annotation/campaigns/${slug}/annotate`);
    await page.getByRole('button', { name: /^start$/i }).focus();
    await page.keyboard.press('Enter');

    // First image: the viewer answers to its keys, then label 1.
    await expectImageShown(page);
    await page.keyboard.press('+');
    await expect(page.getByRole('listitem').filter({ hasText: /^Zoom/ })).toHaveText(/Zoom\s+125%/);
    await page.keyboard.press('i');
    await expect(page.getByRole('button', { name: /invert/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('f');
    await expect(page.getByRole('listitem').filter({ hasText: /^Zoom/ })).toHaveText(/Zoom\s+100%/);
    await page.keyboard.press('1');
    await expect(page.getByRole('radio', { name: 'No DR' })).toBeChecked();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toHaveText(SAVED);

    // Second image: skipped.
    await page.keyboard.press('Enter');
    await expectImageShown(page);
    await page.getByRole('button', { name: /^skip$/i }).click();
    await expect(page.getByRole('status')).toHaveText(/task skipped/i);

    // Third and fourth: label 2, then "Cannot assess" (key 0).
    for (const [key, name] of [
      ['2', 'Mild NPDR'],
      ['0', 'Cannot assess'],
    ] as const) {
      await page.keyboard.press('Enter');
      await expectImageShown(page);
      await page.keyboard.press(key);
      await expect(page.getByRole('radio', { name })).toBeChecked();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('status')).toHaveText(SAVED);
    }

    // Three readings done, the skipped image still waiting.
    await manager.reload();
    const tasksSummary = manager.locator('dl', {
      has: manager.locator('dt', { hasText: /^Total$/ }),
    });
    await expect(
      tasksSummary
        .locator('div', { has: manager.locator('dt', { hasText: /^Completed$/ }) })
        .locator('dd'),
    ).toHaveText('3');
    await expect(
      tasksSummary
        .locator('div', { has: manager.locator('dt', { hasText: /^Independent$/ }) })
        .locator('dd'),
    ).toHaveText('1');
    await manager.close();
  });

  test('an arbiter who read none of it settles a disagreement, seeing the image and the anonymous answers', async ({
    page,
    browser,
  }) => {
    const manager = await browser.newPage();
    const slug = await labelledCampaignWithTasks(manager, 1, { readers: 3, allowComment: true });

    // Three readers, three different answers, each with a comment.
    const stamp = Date.now();
    const readings = [
      { reader: `reader-a-${stamp}`, answer: 'No DR' },
      { reader: `reader-b-${stamp}`, answer: 'Mild NPDR' },
      { reader: `reader-c-${stamp}`, answer: 'Moderate NPDR or worse' },
    ];
    const readers = readings.map((r) => r.reader);
    for (const [i, { reader, answer }] of readings.entries()) {
      const p = await browser.newPage();
      await serveSignedImages(p);
      await signInAs(p, reader, 'annotator');
      await p.goto(`/annotation/campaigns/${slug}/annotate`);
      await p.getByRole('button', { name: /^start$/i }).click();
      await expectImageShown(p);
      await p.getByRole('radio', { name: answer }).check();
      await p.getByRole('textbox', { name: 'Comment' }).fill(`Comment ${i + 1}`);
      await p.getByRole('button', { name: /^submit/i }).click();
      await expect(p.getByRole('status')).toHaveText(SAVED);
      await p.close();
    }

    // A reader who also arbitrates is not given the task they read.
    const readerArbiter = await browser.newPage();
    await signInAs(readerArbiter, readers[0]!, 'arbitration-annotator');
    await readerArbiter.goto(`/annotation/campaigns/${slug}/annotate`);
    await readerArbiter.getByRole('button', { name: /^start$/i }).click();
    await expect(readerArbiter.getByText(/no tasks are waiting for you/i)).toBeVisible();
    await readerArbiter.close();

    // An arbiter who read none of it.
    await serveSignedImages(page);
    await signInAs(page, `arbiter-${stamp}`, 'arbitration-annotator');
    await page.goto(`/annotation/campaigns/${slug}/annotate`);
    await page.getByRole('button', { name: /^start$/i }).click();
    await expectImageShown(page);
    const answered = page.getByRole('region', { name: 'What the readers answered' });
    for (const [i, { answer }] of readings.entries()) {
      await expect(answered.getByText(answer, { exact: true })).toBeVisible();
      await expect(answered.getByText(`Comment ${i + 1}`)).toBeVisible();
    }
    // Who gave which answer is not on the page.
    for (const reader of readers) await expect(page.getByText(reader)).toHaveCount(0);
    const axe = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      axe.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`),
      'axe violations on the arbitration page',
    ).toEqual([]);

    // A final label without a reason is not sent.
    await page.keyboard.press('2');
    await expect(page.getByRole('radio', { name: 'Mild NPDR' })).toBeChecked();
    const reason = page.getByRole('textbox', { name: 'Reason' });
    await expect(reason).toHaveAttribute('required', '');
    await reason.fill('Isolated microaneurysms only, no haemorrhage.');
    await page.getByRole('button', { name: /^submit/i }).click();
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

  test('no answer before the image is on screen, by button or by keyboard (#646 review, item 5)', async ({
    page,
    browser,
  }) => {
    const manager = await browser.newPage();
    const slug = await labelledCampaignWithTasks(manager, 1);
    await manager.close();

    // Hold the image until the test lets it through.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) =>
        url.searchParams.has('X-Amz-Signature') && url.pathname.includes(`/${DATASET_SLUG}/`),
      async (route) => {
        await held;
        const name = path.basename(new URL(route.request().url()).pathname);
        await route.fulfill({
          status: 200,
          contentType: 'image/jpeg',
          body: readFileSync(path.join(FIXTURES, name)),
        });
      },
    );
    await signInAs(page, `slow-reader-${Date.now()}`, 'annotator');
    await page.goto(`/annotation/campaigns/${slug}/annotate`);
    await page.getByRole('button', { name: /^start$/i }).click();

    const submit = page.getByRole('button', { name: /^submit/i });
    await expect(page.getByText('Loading the next image…')).toBeVisible();
    await expect(submit).toBeDisabled();
    await expect(page.getByText(/submit is available once the image is on screen/i)).toBeVisible();
    // Number + Enter picks the label but sends nothing.
    await page.keyboard.press('1');
    await expect(page.getByRole('radio', { name: 'No DR' })).toBeChecked();
    await page.keyboard.press('Enter');
    await expect(page.getByText(SAVED)).toHaveCount(0);
    await expect(submit).toBeVisible();

    release();
    await expectImageShown(page);
    await expect(submit).toBeEnabled();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toHaveText(SAVED);
  });

  test('an image that fails to load cannot be answered, only skipped (#646 review, item 5)', async ({
    page,
    browser,
  }) => {
    const manager = await browser.newPage();
    const slug = await labelledCampaignWithTasks(manager, 1);
    await manager.close();

    await page.route(
      (url) =>
        url.searchParams.has('X-Amz-Signature') && url.pathname.includes(`/${DATASET_SLUG}/`),
      (route) => route.fulfill({ status: 403, body: 'expired' }),
    );
    await signInAs(page, `failed-image-${Date.now()}`, 'annotator');
    await page.goto(`/annotation/campaigns/${slug}/annotate`);
    await page.getByRole('button', { name: /^start$/i }).click();

    await expect(page.getByText(/the image could not be loaded/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^submit/i })).toBeDisabled();
    await page.getByRole('button', { name: /^skip$/i }).click();
    await expect(page.getByRole('status')).toHaveText(/task skipped/i);
  });

  test('a reader in French on a French keyboard: the page, the viewer and the number keys (#646 review, items 3 and 4)', async ({
    page,
    browser,
  }) => {
    const manager = await browser.newPage();
    const slug = await labelledCampaignWithTasks(manager, 1);
    await manager.close();

    await serveSignedImages(page);
    await signInAs(page, `lecteur-${Date.now()}`, 'annotator');
    // A new user has no stored language, so the cookie decides. Set after
    // signing in, which the English sign-in labels need.
    await page.context().addCookies([
      {
        name: 'oci-locale',
        value: 'fr',
        url: process.env.PW_BASE_URL ?? 'http://localhost:3001',
      },
    ]);
    await page.goto(`/annotation/campaigns/${slug}/annotate`);
    await expect(page.getByText(/rien ne vous est réservé/i)).toBeVisible();
    await page.getByRole('button', { name: /^commencer$/i }).click();

    const img = page.getByRole('img', { name: /image à lire \(étape : lecture indépendante\)/i });
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true);
    await expect(page.getByRole('toolbar', { name: 'Réglages de l’image' })).toBeVisible();
    await expect(page.getByText('(appuyez sur le chiffre)')).toBeVisible();

    // What an AZERTY top row sends without Shift: the character on the
    // key, and the physical key as `code`.
    const press = (key: string, code: string) =>
      page.evaluate(
        ([k, c]) =>
          document.dispatchEvent(
            new KeyboardEvent('keydown', { key: k, code: c, bubbles: true, cancelable: true }),
          ),
        [key, code] as const,
      );
    const zoom = page.getByRole('listitem').filter({ hasText: /^Zoom/ });
    // The 6 key gives "-": it is not a zoom key there.
    await press('-', 'Digit6');
    await expect(zoom).toHaveText(/Zoom\s+100%/);
    // The 2 key gives "é" and picks the second label.
    await press('é', 'Digit2');
    await expect(page.getByRole('radio', { name: 'Mild NPDR' })).toBeChecked();
    await press('&', 'Digit1');
    await expect(page.getByRole('radio', { name: 'No DR' })).toBeChecked();

    await page.getByRole('button', { name: /^valider/i }).click();
    await expect(page.getByRole('status')).toHaveText(/votre réponse a été enregistrée/i);
  });

  test('a campaign manager in French: the campaign page, its tasks and the new-campaign form (#646 review)', async ({
    page,
  }) => {
    const slug = await labelledCampaignWithTasks(page, 1);
    await page.context().addCookies([
      {
        name: 'oci-locale',
        value: 'fr',
        url: process.env.PW_BASE_URL ?? 'http://localhost:3001',
      },
    ]);

    await page.goto(`/annotation/campaigns/${slug}`);
    await expect(page.getByRole('main').getByText('en cours', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cycle de vie' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Terminer' })).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Créer des tâches à partir des fichiers du jeu de données',
      }),
    ).toBeVisible();
    await page.getByLabel('Au plus').fill('1');
    await page.getByRole('button', { name: 'Compter les fichiers et les séries' }).click();
    await expect(page.getByRole('status')).toHaveText(
      // French puts 0 in the singular.
      '1 échantillon correspond : 0 nouvelle tâche, 1 en a déjà une.',
    );

    await page.goto('/annotation/campaigns/new');
    await expect(page.getByRole('heading', { name: 'Nouvelle campagne' })).toBeVisible();
    await page.getByRole('radio', { name: 'Classification' }).check();
    await expect(page.getByRole('textbox', { name: 'Étiquettes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Créer le brouillon' })).toBeVisible();
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`the annotate page with an image has no axe violations (${colorScheme})`, async ({
      page,
      browser,
    }) => {
      const manager = await browser.newPage();
      const slug = await labelledCampaignWithTasks(manager, 1);
      await manager.close();

      await page.emulateMedia({ colorScheme });
      await serveSignedImages(page);
      await signInAs(page, `axe-reader-${Date.now()}`, 'annotator');
      await page.goto(`/annotation/campaigns/${slug}/annotate`);
      await page.getByRole('button', { name: /^start$/i }).click();
      await expectImageShown(page);

      const results = await new AxeBuilder({ page })
        .include('main')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const summary = results.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`);
      expect(summary, 'axe violations').toEqual([]);
    });
  }
});

import { test, expect, type Page } from '@playwright/test';

/**
 * The reading exercise of the December 2026 radiology workshop (#644), as
 * the `radiology-workshop` seed profile leaves it: the facilitator starts
 * the seeded campaign, and a reader working in French opens it, gets an
 * image of the pinned dataset version and sees the campaign's French
 * answers, « Non interprétable » included.
 *
 * Nothing is created through the interface: the campaign, its labels and
 * its 60 tasks come from `packages/database/seed/profiles/radiology-
 * workshop/seed.sql`. The profile's images are a synthetic stand-in that is
 * not committed, so the browser's request for the signed image address is
 * answered here with a small PNG. Everything up to that address (the task,
 * its `file:` reference, the signing, who may see it) is the real API.
 *
 * Pre-conditions: a local stack (`OCI_ENV=local`) with the demo seed and
 * then the profile's `seed.sql` replayed. Skipped where the profile is not
 * seeded. The campaign is started here if it is still READY, as seeded; run
 * the profile reset (`apps/migrate/reset-profile.mjs`) to bring it back.
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const CAMPAIGN = 'nih-chestxray14-reading';
const DATASET_SLUG = 'nih-chestxray14-workshop';
const MANAGER = { 'X-Dev-User': 'workshop-facilitator', 'X-Dev-Roles': 'campaign-manager' };

/** An 8 × 8 grey PNG: the stand-in images are drawn by a script, not committed. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWNowAEYhpYEAILzYAEeEbvlAAAAAElFTkSuQmCC',
  'base64',
);

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

async function inFrench(page: Page) {
  await page
    .context()
    .addCookies([
      { name: 'oci-locale', value: 'fr', url: process.env.PW_BASE_URL ?? 'http://localhost:3001' },
    ]);
}

test.describe('the workshop reading campaign, as seeded (#644)', () => {
  test.beforeAll(async ({ request }) => {
    const campaign = await request.get(`${API}/v2/annotation/campaigns/${CAMPAIGN}`, {
      headers: MANAGER,
    });
    test.skip(campaign.status() === 404, 'the radiology-workshop seed profile is not seeded here');
    expect(campaign.ok()).toBe(true);
  });

  test('the facilitator starts it; a reader in French gets an image and the French answers', async ({
    page,
    browser,
  }) => {
    // The facilitator, in French, on the campaign page: the seeded campaign
    // waits READY with its 60 tasks until Start.
    const facilitator = await browser.newPage();
    await signInAs(facilitator, 'workshop-facilitator', 'campaign-manager');
    await inFrench(facilitator);
    await facilitator.goto(`/annotation/campaigns/${CAMPAIGN}`);
    const start = facilitator.getByRole('button', { name: 'Lancer la campagne' });
    if (await start.isVisible()) {
      await start.click();
      await facilitator.getByRole('button', { name: /confirmer : lancer la campagne/i }).click();
    }
    await expect(
      facilitator.getByRole('main').getByText('en cours', { exact: true }),
    ).toBeVisible();
    await facilitator.close();

    // A reader, in French. The signed address of the image is answered here.
    let signedImageRequests = 0;
    await page.route(
      (url) =>
        url.searchParams.has('X-Amz-Signature') && url.pathname.includes(`/${DATASET_SLUG}/`),
      async (route) => {
        signedImageRequests += 1;
        await route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      },
    );
    await signInAs(page, `lecteur-atelier-${Date.now()}`, 'annotator');
    await inFrench(page);
    await page.goto(`/annotation/campaigns/${CAMPAIGN}/annotate`);
    await page.getByRole('button', { name: /^commencer$/i }).click();

    const img = page.getByRole('img', { name: /image à lire \(étape : lecture indépendante\)/i });
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true);
    expect(signedImageRequests).toBeGreaterThan(0);
    // The task names a platform file id, never a storage key or a file name.
    await expect(page.getByText(/standin_\d+|\.png/)).toHaveCount(0);

    // The campaign's answers, in French, on keys 1, 2 and 0.
    await expect(page.getByText('(appuyez sur le chiffre)')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Absent' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Présent' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Non interprétable' })).toBeVisible();
    await page.keyboard.press('2');
    await expect(page.getByRole('radio', { name: 'Présent' })).toBeChecked();
    await page.keyboard.press('0');
    await expect(page.getByRole('radio', { name: 'Non interprétable' })).toBeChecked();
  });
});

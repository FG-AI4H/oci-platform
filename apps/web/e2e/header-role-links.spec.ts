import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * The header's role links to the method review queue and the audit
 * trail (#776), at every width and in both languages. From `xl` (1280
 * px) up the links sit in a row; below it they are in the "Menu"
 * disclosure (#743). A caller with more than five links keeps the menu
 * up to `2xl` (1536 px). Each test checks which of the two the header
 * shows, that no header control overlaps another and the page does not
 * scroll sideways, then opens the menu where it is shown. Admins get
 * neither entry: both pages are tiles on /admin.
 *
 * Signs in through the local dev form only and reads no data, so it
 * needs the web app alone (the pages it lands on may say the API is
 * unavailable; the header is what is checked).
 */

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 740 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'tablet-wide', width: 1279, height: 800 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'desktop-wide', width: 1536, height: 900 },
] as const;

const LANGUAGES = [
  {
    name: 'en',
    locale: 'en-GB',
    nav: 'Primary',
    menu: 'Menu',
    reviews: 'Reviews',
    audit: 'Audit trail',
    admin: 'Admin',
  },
  {
    name: 'fr',
    locale: 'fr-FR',
    nav: 'Navigation principale',
    menu: 'Menu',
    reviews: 'Revues de méthodes',
    audit: 'Journal d’audit',
    admin: 'Administration',
  },
] as const;

type Viewport = (typeof VIEWPORTS)[number];
type Language = (typeof LANGUAGES)[number];

async function signedInPage(
  browser: Browser,
  vp: Viewport,
  lang: Language,
  roles: string,
): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    locale: lang.locale,
  });
  const page = await ctx.newPage();
  await page.goto('/signin?callbackUrl=%2Fsettings');
  await page.locator('#signin-user').fill(`header-${roles.replace(/,/g, '-')}`);
  await page.locator('#signin-roles').fill(roles);
  await page.locator('form button[type="submit"]').last().click();
  await page.waitForURL(/\/settings/);
  return page;
}

/** Whether the header should show the menu: below xl, or below 2xl past five links. */
function expectsMenu(vp: Viewport, linkCount: number): boolean {
  if (vp.width < 1280) return true;
  if (vp.width < 1536) return linkCount > 5;
  return false;
}

/**
 * The primary navigation as the caller sees it, the row or the opened
 * menu, after checking which of the two is shown and that nothing in
 * the header overlaps.
 */
async function primaryNav(page: Page, vp: Viewport, lang: Language, linkCount: number) {
  const header = page.locator('header').first();
  const menu = header.locator('summary', { hasText: lang.menu });
  if (expectsMenu(vp, linkCount)) await expect(menu).toBeVisible();
  else await expect(menu).toBeHidden();
  // Checked with the menu closed, as the header first shows.
  expect(await headerOverlaps(page)).toEqual([]);
  if (await menu.isVisible()) await menu.click();
  const nav = header.getByRole('navigation', { name: lang.nav });
  await expect(nav).toHaveCount(1);
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(linkCount + (expectsMenu(vp, linkCount) ? 2 : 0));
  return nav;
}

/** Pairs of visible header controls whose boxes intersect. */
async function headerOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const header = document.querySelector('header');
    if (!header) return ['no header'];
    const items = [...header.querySelectorAll('a, button, summary')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.closest('details:not([open]) > div');
    });
    const overlaps: string[] = [];
    items.forEach((a, i) => {
      for (const b of items.slice(i + 1)) {
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        if (
          ra.left < rb.right - 1 &&
          rb.left < ra.right - 1 &&
          ra.top < rb.bottom - 1 &&
          rb.top < ra.bottom - 1
        ) {
          overlaps.push(`${a.textContent?.trim()} × ${b.textContent?.trim()}`);
        }
      }
    });
    if (document.documentElement.scrollWidth > window.innerWidth) overlaps.push('page scrolls');
    return overlaps;
  });
}

test.describe('header role links (#776)', () => {
  for (const lang of LANGUAGES) {
    for (const vp of VIEWPORTS) {
      test(`${lang.name} ${vp.name}: a reviewer reaches the review queue`, async ({ browser }) => {
        const page = await signedInPage(browser, vp, lang, 'evaluation-reviewer');
        const nav = await primaryNav(page, vp, lang, 5);
        await expect(nav.getByRole('link', { name: lang.audit, exact: true })).toHaveCount(0);
        await nav.getByRole('link', { name: lang.reviews, exact: true }).click();
        await expect(page).toHaveURL(/\/evaluation\/routes\/reviews$/);
        await page.context().close();
      });

      test(`${lang.name} ${vp.name}: a regulator reaches the audit trail`, async ({ browser }) => {
        const page = await signedInPage(browser, vp, lang, 'regulator');
        const nav = await primaryNav(page, vp, lang, 5);
        await expect(nav.getByRole('link', { name: lang.reviews, exact: true })).toHaveCount(0);
        await expect(nav.getByRole('link', { name: lang.admin, exact: true })).toHaveCount(0);
        await nav.getByRole('link', { name: lang.audit, exact: true }).click();
        await expect(page).toHaveURL(/\/admin\/audit$/);
        await page.context().close();
      });

      for (const roles of ['admin', 'host,admin', 'admin,evaluation-reviewer,regulator']) {
        test(`${lang.name} ${vp.name}: ${roles} keeps the links it had before`, async ({
          browser,
        }) => {
          const page = await signedInPage(browser, vp, lang, roles);
          // Catalog, Models, Evaluation, Annotation, Inbox, Admin.
          const nav = await primaryNav(page, vp, lang, 6);
          await expect(nav.getByRole('link', { name: lang.admin, exact: true })).toHaveCount(1);
          await expect(nav.getByRole('link', { name: lang.reviews, exact: true })).toHaveCount(0);
          await expect(nav.getByRole('link', { name: lang.audit, exact: true })).toHaveCount(0);
          await page.context().close();
        });
      }

      for (const [roles, count] of [
        ['host,evaluation-reviewer', 6],
        ['evaluation-reviewer,regulator', 6],
        ['host,evaluation-reviewer,regulator', 7],
      ] as const) {
        test(`${lang.name} ${vp.name}: ${roles} gets its entries, uncrowded`, async ({
          browser,
        }) => {
          const page = await signedInPage(browser, vp, lang, roles);
          const nav = await primaryNav(page, vp, lang, count);
          await expect(nav.getByRole('link', { name: lang.reviews, exact: true })).toHaveCount(1);
          const audit = roles.includes('regulator') ? 1 : 0;
          await expect(nav.getByRole('link', { name: lang.audit, exact: true })).toHaveCount(audit);
          await page.context().close();
        });
      }

      test(`${lang.name} ${vp.name}: a plain user sees neither`, async ({ browser }) => {
        // An empty role list signs in as host + admin, so name a plain role.
        const page = await signedInPage(browser, vp, lang, 'participant');
        const nav = await primaryNav(page, vp, lang, 4);
        await expect(nav.getByRole('link', { name: lang.reviews, exact: true })).toHaveCount(0);
        await expect(nav.getByRole('link', { name: lang.audit, exact: true })).toHaveCount(0);
        await page.context().close();
      });
    }
  }
});

test.describe('review queue tile on /admin (#776)', () => {
  const desktop = VIEWPORTS[3];
  const english = LANGUAGES[0];

  test('an admin finds the review queue next to the audit trail', async ({ browser }) => {
    const page = await signedInPage(browser, desktop, english, 'admin');
    await page.goto('/admin');
    const tiles = page.getByRole('main').getByRole('link');
    await expect(tiles.filter({ hasText: 'Audit trail' })).toHaveAttribute('href', '/admin/audit');
    const queue = tiles.filter({ hasText: 'Review queue' });
    await expect(queue).toHaveAttribute('href', '/evaluation/routes/reviews');
    await queue.click();
    await expect(page).toHaveURL(/\/evaluation\/routes\/reviews$/);
    await page.context().close();
  });

  test('a reviewer who is not an admin does not reach /admin', async ({ browser }) => {
    const page = await signedInPage(browser, desktop, english, 'evaluation-reviewer');
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.context().close();
  });
});

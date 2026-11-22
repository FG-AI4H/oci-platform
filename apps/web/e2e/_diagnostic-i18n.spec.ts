/**
 * UI/UX audit diagnostic for the French interface (#654) and the header
 * fix (#743): screenshots, axe-core counts and a header-overlap check for
 * the pages translated in this slice, in English and in French, across
 * viewport × colour scheme. Scaffolding, not regression coverage.
 *
 *   PW_BASE_URL=… AUDIT_LABEL=after pnpm --filter @oci/web exec \
 *     playwright test e2e/_diagnostic-i18n.spec.ts
 *
 * Writes `test-results/audit-i18n/<label>/…` and a `summary.json`.
 * Signed in as host + admin, so the header carries every link it can.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const SCHEMES = ['light', 'dark'] as const;
const LANGUAGES = [
  { name: 'en', locale: 'en-GB' },
  { name: 'fr', locale: 'fr-FR' },
] as const;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// The dataset and model are the ones the radiology-workshop seed creates.
const PUBLIC_PAGES = [
  '/',
  '/signin',
  '/catalog',
  '/catalog/nih-chestxray14-workshop',
  '/models',
  '/models/workshop-cxr-model-a',
];
const SIGNED_IN_PAGES = ['/dashboard', '/settings', '/catalog/new'];

interface HeaderCheck {
  overlaps: string[];
  pageScrollsSideways: boolean;
  headerHeight: number;
}

/** Pairs of header items whose boxes intersect, and sideways scroll. */
async function checkHeader(page: Page): Promise<HeaderCheck> {
  return page.evaluate(() => {
    const header = document.querySelector('body > div > header');
    const items = header
      ? [...header.querySelectorAll('a, button, summary, [role="group"], .inline-flex')].filter(
          (el) => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return (
              r.width > 0 &&
              r.height > 0 &&
              style.visibility !== 'hidden' &&
              !el.closest('details:not([open]) > div')
            );
          },
        )
      : [];
    const overlaps: string[] = [];
    items.forEach((a, i) => {
      for (const b of items.slice(i + 1)) {
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const overlap =
          ra.left < rb.right - 1 &&
          rb.left < ra.right - 1 &&
          ra.top < rb.bottom - 1 &&
          rb.top < ra.bottom - 1;
        if (overlap) {
          overlaps.push(
            `${(a.textContent ?? '').trim().slice(0, 24)} × ${(b.textContent ?? '').trim().slice(0, 24)}`,
          );
        }
      }
    });
    return {
      overlaps,
      pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
      headerHeight: header?.getBoundingClientRect().height ?? 0,
    };
  });
}

async function signIn(page: Page) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.locator('#signin-user').fill('audit-admin');
  await page.locator('#signin-roles').fill('host,admin');
  await page.locator('form button[type="submit"]').last().click();
  await page.waitForURL(/\/dashboard/);
}

async function audit(browser: Browser, label: string, signedIn: boolean, paths: string[]) {
  // Playwright empties test-results on each run: set AUDIT_DIR elsewhere to
  // keep a before and an after side by side.
  const out = join(process.env.AUDIT_DIR ?? join('test-results', 'audit-i18n'), label);
  mkdirSync(out, { recursive: true });
  const rows: unknown[] = [];
  for (const lang of LANGUAGES) {
    for (const vp of VIEWPORTS) {
      for (const scheme of SCHEMES) {
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          colorScheme: scheme,
          locale: lang.locale,
        });
        const page = await ctx.newPage();
        if (signedIn) await signIn(page);
        for (const path of paths) {
          await page.goto(path);
          await page.waitForLoadState('networkidle');
          const slug = path === '/' ? 'home' : path.replace(/^\//, '').replace(/\//g, '-');
          const base = `${slug}-${lang.name}-${vp.name}-${scheme}`;
          await page.screenshot({ path: join(out, `${base}.png`), fullPage: true });
          await page
            .locator('body > div > header')
            .first()
            .screenshot({ path: join(out, `${base}.header.png`) });
          const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
          const header = await checkHeader(page);
          rows.push({
            path,
            lang: lang.name,
            htmlLang: await page.locator('html').getAttribute('lang'),
            viewport: vp.name,
            scheme,
            signedIn,
            axe: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
            header,
          });
        }
        await ctx.close();
      }
    }
  }
  writeFileSync(
    join(out, `summary-${signedIn ? 'signed-in' : 'public'}.json`),
    JSON.stringify(rows, null, 2),
  );
}

test.describe('i18n audit (#654, #743)', () => {
  test.setTimeout(15 * 60_000);
  const label = process.env.AUDIT_LABEL ?? 'run';

  test('public pages', async ({ browser }) => {
    await audit(browser, label, false, PUBLIC_PAGES);
  });

  test('signed-in pages', async ({ browser }) => {
    await audit(browser, label, true, SIGNED_IN_PAGES);
  });
});

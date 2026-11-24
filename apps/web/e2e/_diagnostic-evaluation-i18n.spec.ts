/**
 * UI/UX audit diagnostic for the French evaluation and access-request
 * pages (#654): screenshots, axe-core counts and a layout check (sideways
 * scroll, buttons, badges and table cells running past their box) in
 * English and French, at 375, 1024 and 1280 px, light and dark.
 * Scaffolding, not regression coverage.
 *
 *   PW_NO_RESET=1 PW_NO_SERVER=1 PW_BASE_URL=… NEXT_PUBLIC_API_BASE_URL=… \
 *   AUDIT_LABEL=after pnpm --filter @oci/web exec \
 *     playwright test e2e/_diagnostic-evaluation-i18n.spec.ts
 *
 * Creates its own `e2e-eval-audit-*` task with two scored results through
 * the API (local sign-in tokens), and writes
 * `test-results/audit-evaluation-i18n/<label>/…` with a `summary.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 740 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const SCHEMES = ['light', 'dark'] as const;
const LANGUAGES = [
  { name: 'en', locale: 'en-GB', user: 'User', roles: 'Roles', button: /sign in.*local dev/i },
  {
    name: 'fr',
    locale: 'fr-FR',
    user: 'Utilisateur',
    roles: 'Rôles',
    button: /se connecter.*développement local/i,
  },
] as const;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const LABEL = process.env.AUDIT_LABEL ?? 'after';
const OUT = join('test-results', 'audit-evaluation-i18n', LABEL);

interface LayoutCheck {
  pageScrollsSideways: boolean;
  /** Buttons, badges, links styled as buttons and table cells that run past their box. */
  overflowing: string[];
  /** Badges taller than one line: a pill that wrapped. */
  wrappedBadges: string[];
  /** Focusable table regions whose content is wider than they are. */
  scrollingRegions: string[];
}

async function checkLayout(page: Page): Promise<LayoutCheck> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overflowing: string[] = [];
    const wrappedBadges: string[] = [];
    const label = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const candidates = document.querySelectorAll(
      'main button, main a[class*="rounded-md"], main span[class*="rounded-full"], main th, main td, main summary',
    );
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Text cut inside its own box (nowrap content wider than the element).
      if ((el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1) {
        const style = getComputedStyle(el);
        if (style.overflowX !== 'visible' || style.whiteSpace === 'nowrap') {
          overflowing.push(`clipped: ${label(el)}`);
        }
      }
      // Past the card or section that holds it (tables are allowed to
      // scroll inside their own focusable region).
      if (el.closest('[role="region"]')) continue;
      const box = el.parentElement?.closest(
        'section, [class*="rounded-xl"], [class*="rounded-lg"], form',
      );
      if (box) {
        const b = box.getBoundingClientRect();
        if (r.right > b.right + 1 || r.left < b.left - 1)
          overflowing.push(`past box: ${label(el)}`);
      }
      if (r.right > doc.clientWidth + 1) overflowing.push(`past viewport: ${label(el)}`);
      if (el.matches('span[class*="rounded-full"]')) {
        const line = parseFloat(getComputedStyle(el).lineHeight) || 16;
        if (r.height > line * 1.8 + 8) wrappedBadges.push(label(el));
      }
    }
    // Table regions that scroll sideways: allowed (they take focus), but a
    // region that scrolls only in French is a layout cost of the language.
    const scrollingRegions = [...document.querySelectorAll('main [role="region"]')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.getAttribute('aria-label') ?? '?');
    return {
      pageScrollsSideways: doc.scrollWidth > doc.clientWidth + 1,
      overflowing: [...new Set(overflowing)],
      wrappedBadges: [...new Set(wrappedBadges)],
      scrollingRegions,
    };
  });
}

async function api(request: APIRequestContext, path: string, data: unknown, auth: string) {
  const res = await request.post(`${API}${path}`, { headers: { Authorization: auth }, data });
  expect(res.ok(), `${path}: ${res.status()}`).toBe(true);
  return (await res.json()) as { id: string };
}

interface Row {
  page: string;
  language: string;
  viewport: string;
  scheme: string;
  axe: Record<string, number>;
  axeTotal: number;
  layout: LayoutCheck;
  lang: string | null;
}

async function capture(
  browser: Browser,
  pages: { name: string; path: string }[],
  signIn: { user: string; roles: string } | null,
  rows: Row[],
) {
  for (const language of LANGUAGES) {
    for (const scheme of SCHEMES) {
      const context = await browser.newContext({ locale: language.locale, colorScheme: scheme });
      const page = await context.newPage();
      if (signIn) {
        await page.goto('/signin?callbackUrl=%2Fdashboard');
        await page.getByLabel(language.user).fill(`${signIn.user}-${language.name}`);
        await page.getByLabel(language.roles).fill(signIn.roles);
        await page.getByRole('button', { name: language.button }).click();
        await page.waitForURL(/\/dashboard/);
      }
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        for (const target of pages) {
          await page.goto(target.path);
          await page.waitForLoadState('networkidle');
          const dir = join(OUT, target.name);
          mkdirSync(dir, { recursive: true });
          await page.screenshot({
            path: join(dir, `${language.name}-${viewport.name}-${scheme}.png`),
            fullPage: true,
          });
          const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
          const counts: Record<string, number> = {};
          for (const v of axe.violations) counts[v.id] = v.nodes.length;
          rows.push({
            page: target.name,
            language: language.name,
            viewport: viewport.name,
            scheme,
            axe: counts,
            axeTotal: axe.violations.reduce((n, v) => n + v.nodes.length, 0),
            layout: await checkLayout(page),
            lang: await page.locator('html').getAttribute('lang'),
          });
        }
      }
      await context.close();
    }
  }
}

test.describe('audit: evaluation and access-request pages, en and fr (#654)', () => {
  test.setTimeout(20 * 60_000);

  test('capture', async ({ browser, request }) => {
    const stamp = Date.now();
    const slug = `e2e-eval-audit-${stamp}`;
    const ids = Array.from({ length: 40 }, (_, i) => `img${String(i).padStart(2, '0')}`);
    await api(
      request,
      '/v2/evaluation/tasks',
      {
        slug,
        name: 'Pneumothorax on chest radiographs',
        datasetSlug: 'e2e-eval-dataset',
        taskKind: 'BINARY_DIAGNOSTIC',
        numClasses: 2,
        referableThreshold: 1,
        positiveClassName: 'Pneumothorax present',
        groundTruth: Object.fromEntries(ids.map((id, i) => [id, i % 2])),
        subgroups: {
          fields: [
            {
              key: 'sex',
              label: 'Sex',
              values: [
                { value: 'F', label: 'Female' },
                { value: 'M', label: 'Male' },
              ],
            },
          ],
          values: Object.fromEntries(ids.map((id, i) => [id, { sex: i < 20 ? 'F' : 'M' }])),
        },
      },
      'Bearer dev:e2e-eval-host:host',
    );
    const submit = async (methodName: string, wrong: number[]) =>
      (
        await api(
          request,
          `/v2/evaluation/tasks/${slug}/submissions`,
          {
            methodName,
            predictions: ids.map((id, i) => ({
              imageId: id,
              grade: wrong.includes(i) ? 1 - (i % 2) : i % 2,
              score: wrong.includes(i) ? 0.4 : i % 2 ? 0.9 : 0.1,
            })),
          },
          `Bearer dev:e2e-audit-participant-${stamp}:researcher`,
        )
      ).id;
    const a = await submit('Reader A', [1, 4, 25]);
    const b = await submit('Reader B', [3, 21, 22, 30, 33]);
    const routes = (await (await request.get(`${API}/v2/evaluation/routes`)).json()) as {
      slug: string;
    }[];

    const rows: Row[] = [];
    await capture(
      browser,
      [
        { name: 'evaluation', path: '/evaluation' },
        { name: 'task', path: `/evaluation/${slug}` },
        { name: 'submit', path: `/evaluation/${slug}/submit` },
        { name: 'submission', path: `/evaluation/${slug}/submissions/${a}` },
        { name: 'compare', path: `/evaluation/${slug}/compare?a=${a}&b=${b}` },
        { name: 'routes', path: '/evaluation/routes' },
        ...(routes[0] ? [{ name: 'route', path: `/evaluation/routes/${routes[0].slug}` }] : []),
      ],
      null,
      rows,
    );
    await capture(
      browser,
      [
        { name: 'reviews', path: '/evaluation/routes/reviews' },
        ...(routes[0]
          ? [{ name: 'route-reviewer', path: `/evaluation/routes/${routes[0].slug}` }]
          : []),
      ],
      { user: `audit-reviewer-${stamp}`, roles: 'evaluation-reviewer' },
      rows,
    );
    await capture(
      browser,
      [
        { name: 'request-access', path: '/catalog/oci-demo-chest-xr/request-access' },
        { name: 'my-requests', path: '/dashboard/access-requests' },
      ],
      { user: `audit-participant-${stamp}`, roles: 'participant' },
      rows,
    );

    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'summary.json'), JSON.stringify(rows, null, 2));
  });
});

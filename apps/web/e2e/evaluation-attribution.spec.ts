import { createServer, type Server } from 'node:http';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Task-page attribution (#486): a scored row shows the route version that
 * produced it and its review status, and only published results get a rank.
 *
 * The task page fetches the API server-side (`lib/api.ts` inside a Server
 * Component), so `page.route` cannot intercept it. Instead this spec runs a
 * stub API on `PW_API_STUB_PORT` (default 3999) that answers
 * `GET /v2/evaluation/tasks/attribution-fixture` with the three attribution
 * states the issue names — routed + APPROVED, routed + DECLARED, LEGACY —
 * plus a PENDING row, and 404s everything else.
 *
 * Opt-in: the spec is skipped unless `PW_API_STUB=1`, because the web server
 * must have been started with `NEXT_PUBLIC_API_BASE_URL` pointing at the
 * stub rather than at the real API on :3000. Run it on its own with
 *
 *   PW_API_STUB=1 PW_NO_RESET=1 \
 *   NEXT_PUBLIC_API_BASE_URL=http://localhost:3999 \
 *   pnpm --filter @oci/web exec playwright test e2e/evaluation-attribution.spec.ts
 *
 * (Playwright's `webServer` inherits that env when it spawns `pnpm dev`.)
 */

const STUB_ENABLED = process.env.PW_API_STUB === '1';
const STUB_PORT = Number(process.env.PW_API_STUB_PORT ?? '3999');
const TASK_SLUG = 'attribution-fixture';

const ITEM_IDS = Array.from({ length: 12 }, (_, i) => `IDRiD_${String(i + 1).padStart(3, '0')}`);

function grading(qwk: number) {
  return {
    kind: 'GRADING',
    metrics: {
      qwk,
      accuracy: 0.6,
      referableSensitivity: 0.7,
      referableSpecificity: 0.8,
      coverage: 1,
    },
  };
}

const FIXTURE = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: TASK_SLUG,
  name: 'Attribution fixture task',
  datasetSlug: 'idrid-fixture',
  taskKind: 'GRADING',
  numClasses: 5,
  referableThreshold: 2,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  itemCount: ITEM_IDS.length,
  itemIds: ITEM_IDS,
  submissions: [
    {
      id: '22222222-2222-4222-8222-222222222201',
      methodName: 'routed-published',
      status: 'SCORED',
      scores: grading(0.9),
      attribution: {
        kind: 'ROUTED',
        routeSlug: 'idrid-qwk',
        routeVersion: '1.0.0',
        reviewStatus: 'APPROVED',
        published: true,
        retractedAt: null,
      },
      createdAt: '2026-08-10T00:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222202',
      methodName: 'routed-provisional',
      status: 'SCORED',
      scores: grading(0.85),
      attribution: {
        kind: 'ROUTED',
        routeSlug: 'idrid-qwk',
        routeVersion: '1.1.0-rc.1',
        reviewStatus: 'DECLARED',
        published: false,
        retractedAt: null,
      },
      createdAt: '2026-08-11T00:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222203',
      methodName: 'demo-baseline-v1',
      status: 'SCORED',
      scores: grading(0.8),
      attribution: {
        kind: 'LEGACY',
        note: 'Scored before the evaluation-route registry existed (ADR-0018 / WP5). This result carries no route declaration and is excluded from published reporting.',
      },
      createdAt: '2026-08-12T00:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222204',
      methodName: 'still-pending',
      status: 'PENDING',
      scores: null,
      attribution: null,
      createdAt: '2026-08-13T00:00:00.000Z',
    },
  ],
};

let stub: Server | null = null;

test.describe('task page attribution (#486)', () => {
  test.skip(!STUB_ENABLED, 'set PW_API_STUB=1 and point NEXT_PUBLIC_API_BASE_URL at the stub');

  test.beforeAll(async () => {
    stub = createServer((req, res) => {
      if (req.method === 'GET' && req.url === `/v2/evaluation/tasks/${TASK_SLUG}`) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(FIXTURE));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 404, title: 'Not Found' }));
    });
    await new Promise<void>((resolve) => stub!.listen(STUB_PORT, resolve));
  });

  test.afterAll(async () => {
    if (stub) await new Promise<void>((resolve) => stub!.close(() => resolve()));
  });

  test('each scored row shows its attribution and only published rows rank', async ({ page }) => {
    await page.goto(`/evaluation/${TASK_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: FIXTURE.name })).toBeVisible();

    const rows = page.getByRole('list', { name: 'Submissions, best first' }).getByRole('listitem');
    await expect(rows).toHaveCount(4);

    // #1 goes to the APPROVED + published row, with its route@version linked.
    const published = rows.nth(0);
    await expect(published.getByRole('heading', { level: 3 })).toHaveText(
      /^#1\s*routed-published$/,
    );
    const routeLink = published.getByRole('link', { name: /idrid-qwk@1\.0\.0/ });
    await expect(routeLink).toHaveAttribute('href', '/evaluation/routes/idrid-qwk');
    await expect(published.getByText('published', { exact: true })).toBeVisible();
    await expect(published.getByText('scored', { exact: true })).toBeVisible();

    // DECLARED: provisional, no rank, route still shown, caveat spelled out.
    const provisional = rows.nth(1);
    await expect(provisional.getByRole('heading', { level: 3 })).toHaveText('routed-provisional');
    await expect(provisional.getByRole('heading', { level: 3 })).not.toContainText('#');
    await expect(provisional.getByRole('link', { name: /idrid-qwk@1\.1\.0-rc\.1/ })).toBeVisible();
    await expect(provisional.getByText('provisional', { exact: true })).toBeVisible();
    await expect(
      provisional.getByText('has not yet passed review', { exact: false }),
    ).toBeVisible();
    // Metrics are kept.
    await expect(provisional.getByText('QWK', { exact: true })).toBeVisible();
    await expect(provisional.getByText('0.850', { exact: true })).toBeVisible();

    // LEGACY: badge + note, no rank, no route link.
    const legacy = rows.nth(2);
    await expect(legacy.getByRole('heading', { level: 3 })).toHaveText('demo-baseline-v1');
    await expect(legacy.getByText('legacy', { exact: true })).toBeVisible();
    await expect(legacy.getByText('carries no route declaration', { exact: false })).toBeVisible();
    await expect(legacy.locator('a[href^="/evaluation/routes/"]')).toHaveCount(0);
    await expect(legacy.getByText('0.800', { exact: true })).toBeVisible();

    // PENDING: unchanged behaviour — status badge, no attribution.
    const pending = rows.nth(3);
    await expect(pending.getByText('pending', { exact: true })).toBeVisible();
    await expect(pending.locator('a[href^="/evaluation/routes/"]')).toHaveCount(0);

    // Footer counts scored and published separately.
    await expect(
      page.getByText('3 of 4 submissions scored · 1 published', { exact: false }),
    ).toBeVisible();

    // Results card description carries the provisional caveat.
    await expect(
      page.getByText(
        'Results are provisional until the evaluation method that produced them is approved.',
        { exact: false },
      ),
    ).toBeVisible();
  });

  for (const viewport of [
    { name: 'mobile', width: 375, height: 667 },
    { name: 'desktop', width: 1280, height: 800 },
  ] as const) {
    for (const colorScheme of ['light', 'dark'] as const) {
      test(`axe clean and no horizontal overflow — ${viewport.name} ${colorScheme}`, async ({
        browser,
      }) => {
        const ctx = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme,
        });
        const page = await ctx.newPage();
        await page.goto(`/evaluation/${TASK_SLUG}`);
        await expect(page.getByRole('heading', { level: 1, name: FIXTURE.name })).toBeVisible();

        // The badge and route text must wrap under the method name, never
        // push the page wider than the viewport.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, 'horizontal overflow in px').toBe(0);
        await page.screenshot({
          path: `test-results/attribution-${viewport.name}-${colorScheme}.png`,
          fullPage: true,
        });

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const summary = results.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`);
        expect(summary, 'axe violations').toEqual([]);

        await ctx.close();
      });
    }
  }
});

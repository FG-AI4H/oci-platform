import { createServer, type Server } from 'node:http';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ROUTES_FIXTURE } from './fixtures/evaluation-routes';

/**
 * Evaluation-method pages (#487): the list renders one card per route with
 * its latest version and review status; the detail page renders every
 * version's three declarations, latest first.
 *
 * Both pages fetch the API server-side (`lib/api.ts` inside a Server
 * Component), so `page.route` cannot intercept them. As in
 * `evaluation-attribution.spec.ts`, this spec runs a stub API on
 * `PW_API_STUB_PORT` (default 3999) that answers `GET /v2/evaluation/routes`
 * and `GET /v2/evaluation/routes/:slug` from the fixture and 404s everything
 * else.
 *
 * Opt-in: skipped unless `PW_API_STUB=1`, because the web server must have
 * been started with `NEXT_PUBLIC_API_BASE_URL` pointing at the stub:
 *
 *   PW_API_STUB=1 PW_NO_RESET=1 \
 *   NEXT_PUBLIC_API_BASE_URL=http://localhost:3999 \
 *   pnpm --filter @oci/web exec playwright test e2e/evaluation-routes.spec.ts
 */

const STUB_ENABLED = process.env.PW_API_STUB === '1';
const STUB_PORT = Number(process.env.PW_API_STUB_PORT ?? '3999');

const PREDICTIONS = ROUTES_FIXTURE.find((r) => r.slug === 'oci-predictions-scoring')!;
const CONTAINER = ROUTES_FIXTURE.find((r) => r.slug === 'oci-sealed-execution')!;
const ENCRYPTED = ROUTES_FIXTURE.find((r) => r.slug === 'acme-encrypted-inference')!;

let stub: Server | null = null;

test.describe('evaluation-method pages (#487)', () => {
  test.skip(!STUB_ENABLED, 'set PW_API_STUB=1 and point NEXT_PUBLIC_API_BASE_URL at the stub');

  test.beforeAll(async () => {
    stub = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/v2/evaluation/routes') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(ROUTES_FIXTURE));
        return;
      }
      const match = /^\/v2\/evaluation\/routes\/([^/?]+)$/.exec(req.url ?? '');
      if (req.method === 'GET' && match) {
        const route = ROUTES_FIXTURE.find((r) => r.slug === decodeURIComponent(match[1]!));
        if (route) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(route));
          return;
        }
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 404, title: 'Not Found' }));
    });
    await new Promise<void>((resolve) => stub!.listen(STUB_PORT, resolve));
  });

  test.afterAll(async () => {
    if (stub) await new Promise<void>((resolve) => stub!.close(() => resolve()));
  });

  test('index page links to the methods page', async ({ page }) => {
    await page.goto('/evaluation');
    const link = page.getByRole('link', { name: 'Browse evaluation methods' });
    await expect(link).toHaveAttribute('href', '/evaluation/routes');
  });

  test('list shows one card per method with mode, provider, latest version and status', async ({
    page,
  }) => {
    await page.goto('/evaluation/routes');
    await expect(page.getByRole('heading', { level: 1, name: 'Evaluation methods' })).toBeVisible();
    await expect(page.getByText('3 methods', { exact: false })).toBeVisible();
    // The specification's word is introduced once.
    await expect(page.getByText('calls these methods', { exact: false })).toBeVisible();

    const cards = page.getByRole('list').filter({ has: page.getByRole('heading', { level: 2 }) });
    await expect(cards.getByRole('listitem')).toHaveCount(3);

    const predictions = cards.getByRole('listitem').filter({ hasText: PREDICTIONS.name });
    await expect(predictions.getByRole('heading', { level: 2 })).toHaveText(PREDICTIONS.name);
    await expect(
      predictions.getByText('Predictions file scored on the platform', { exact: false }),
    ).toBeVisible();
    await expect(predictions.getByText('Reference implementation', { exact: true })).toBeVisible();
    await expect(predictions.getByText('1.0.0', { exact: true })).toBeVisible();
    await expect(predictions.getByText('provisional', { exact: true })).toBeVisible();
    await expect(predictions.getByRole('link', { name: PREDICTIONS.name })).toHaveAttribute(
      'href',
      `/evaluation/routes/${PREDICTIONS.slug}`,
    );

    const container = cards.getByRole('listitem').filter({ hasText: CONTAINER.name });
    await expect(
      container.getByText('Sealed container run next to the data', { exact: false }),
    ).toBeVisible();

    // Provider route: named provider, ENCRYPTED label, latest (1.1.0, not
    // the API-first 1.0.0) and its APPROVED status reading as "published".
    const encrypted = cards.getByRole('listitem').filter({ hasText: ENCRYPTED.name });
    await expect(
      encrypted.getByText('Computation on encrypted values', { exact: false }),
    ).toBeVisible();
    await expect(encrypted.getByText('Acme Privacy Labs', { exact: true })).toBeVisible();
    await expect(encrypted.getByText('1.1.0', { exact: true })).toBeVisible();
    await expect(encrypted.getByText('1.0.0', { exact: true })).toHaveCount(0);
    await expect(encrypted.getByText('published', { exact: true })).toBeVisible();
    await expect(encrypted.getByText('2 versions', { exact: true })).toBeVisible();
  });

  test('detail renders the three declarations of a reference method', async ({ page }) => {
    await page.goto(`/evaluation/routes/${CONTAINER.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: CONTAINER.name })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Evaluation methods', exact: true }),
    ).toHaveAttribute('href', '/evaluation/routes');
    // Acronym expanded on first use.
    await expect(page.getByText('Open Code Infrastructure (OCI)', { exact: false })).toBeVisible();

    // Frozen-declarations rule, stated once.
    await expect(
      page.getByRole('heading', { level: 2, name: 'Declarations are frozen once review begins' }),
    ).toHaveCount(1);

    // One version block: h2 with the version, then three h3 declarations.
    const version = page.getByRole('region', { name: /Version 1\.0\.0/ });
    await expect(version.getByRole('heading', { level: 2 })).toHaveText(/Version\s*1\.0\.0/);
    await expect(version.getByText('provisional', { exact: true })).toBeVisible();
    await expect(version.getByText('not yet reviewed', { exact: false })).toBeVisible();
    await expect(version.getByRole('heading', { level: 3 })).toHaveText([
      'Threat model',
      'Disclosure profile',
      'Operational envelope',
    ]);

    // Threat model: adversaries table in plain words, defended yes/no.
    const table = version.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText(['Party', 'Capability', 'Defended']);
    const rows = table.getByRole('row');
    await expect(rows).toHaveCount(1 + CONTAINER.versions[0]!.threatModel.adversaries.length);
    const developer = rows.filter({ hasText: 'model developer' });
    await expect(developer.getByText('yes', { exact: true })).toBeVisible();
    const operator = rows.filter({ hasText: 'platform operator' });
    await expect(operator.getByText('no', { exact: true })).toBeVisible();
    // No raw API tokens leak through.
    await expect(page.getByText('MODEL_DEVELOPER')).toHaveCount(0);
    await expect(page.getByText('PLATFORM_OPERATOR')).toHaveCount(0);
    await expect(page.getByText('CONTRACTUAL')).toHaveCount(0);

    // Out of scope is prominent and carries the sentence.
    await expect(version.getByRole('heading', { level: 4, name: 'Out of scope' })).toBeVisible();
    await expect(
      version.getByText(
        'A threat model with nothing out of scope is rejected on entry; naming the boundaries is the point.',
        { exact: true },
      ),
    ).toBeVisible();
    for (const item of CONTAINER.versions[0]!.threatModel.outOfScope) {
      await expect(version.getByText(item, { exact: true })).toBeVisible();
    }

    // Disclosure profile.
    await expect(version.getByText('a contract', { exact: false })).toBeVisible();
    await expect(
      version.getByRole('heading', { level: 4, name: 'Who observes what' }),
    ).toBeVisible();
    await expect(version.getByText('method provider', { exact: true })).toBeVisible();
    await expect(version.getByText('Yes.', { exact: true })).toBeVisible();

    // Operational envelope: units rendered as h/min and GiB, gap not measured.
    await expect(version.getByText('1 h', { exact: true })).toBeVisible();
    await expect(version.getByText('(3,600 seconds)', { exact: true })).toBeVisible();
    await expect(version.getByText('16 GiB', { exact: true })).toBeVisible();
    await expect(version.getByText('(16,384 MiB)', { exact: true })).toBeVisible();
    await expect(version.getByText('mebibytes (MiB)', { exact: false })).toBeVisible();
    await expect(version.getByText('Not yet measured.', { exact: true })).toBeVisible();
  });

  test('detail orders versions latest first and shows review notes and a fidelity gap', async ({
    page,
  }) => {
    await page.goto(`/evaluation/routes/${ENCRYPTED.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: ENCRYPTED.name })).toBeVisible();
    // Named provider in the hero badge and again in the About list.
    await expect(page.getByText('Acme Privacy Labs', { exact: true })).toHaveCount(2);

    const versionHeadings = page.getByRole('heading', { level: 2, name: /^Version/ });
    await expect(versionHeadings).toHaveText([/Version\s*1\.1\.0/, /Version\s*1\.0\.0/]);

    const latest = page.getByRole('region', { name: /Version 1\.1\.0/ });
    await expect(latest.getByText('published', { exact: true })).toBeVisible();
    await expect(latest.getByText('reviewed', { exact: false }).first()).toBeVisible();
    await expect(latest.getByRole('heading', { level: 3, name: 'Review notes' })).toBeVisible();
    await expect(
      latest.getByText('within the published tolerance', { exact: false }),
    ).toBeVisible();
    await expect(latest.getByText('a cryptographic assumption', { exact: false })).toBeVisible();
    await expect(latest.getByText('QWK:', { exact: false })).toBeVisible();
    await expect(latest.getByText('-0.012', { exact: true })).toBeVisible();
    await expect(
      latest.getByText('IDRiD reference slice, 2026-08-28', { exact: false }),
    ).toBeVisible();
    await expect(latest.getByText('2 h', { exact: true })).toBeVisible();
    await expect(latest.getByText('2 GiB', { exact: true })).toBeVisible();

    const withdrawn = page.getByRole('region', { name: /Version 1\.0\.0/ });
    await expect(withdrawn.getByText('withdrawn', { exact: true })).toBeVisible();
    await expect(withdrawn.getByText('No.', { exact: true })).toBeVisible();
    await expect(withdrawn.getByText('1 h 30 min', { exact: true })).toBeVisible();
    await expect(withdrawn.getByText('1.5 GiB', { exact: true })).toBeVisible();
  });

  test('unknown slug is a 404', async ({ page }) => {
    const response = await page.goto('/evaluation/routes/does-not-exist');
    expect(response?.status()).toBe(404);
  });

  for (const path of [
    { name: 'list', url: '/evaluation/routes', heading: 'Evaluation methods' },
    { name: 'detail', url: `/evaluation/routes/${ENCRYPTED.slug}`, heading: ENCRYPTED.name },
  ] as const) {
    for (const viewport of [
      { name: 'mobile', width: 375, height: 667 },
      { name: 'desktop', width: 1280, height: 800 },
    ] as const) {
      for (const colorScheme of ['light', 'dark'] as const) {
        test(`axe clean and no horizontal overflow — ${path.name} ${viewport.name} ${colorScheme}`, async ({
          browser,
        }) => {
          const ctx = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            colorScheme,
          });
          const page = await ctx.newPage();
          await page.goto(path.url);
          await expect(page.getByRole('heading', { level: 1, name: path.heading })).toBeVisible();

          // Tables scroll inside their own container; the page never does.
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, 'horizontal overflow in px').toBe(0);
          await page.screenshot({
            path: `test-results/routes-${path.name}-${viewport.name}-${colorScheme}.png`,
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
  }
});

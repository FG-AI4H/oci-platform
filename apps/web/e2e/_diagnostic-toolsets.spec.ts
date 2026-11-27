/**
 * UI/UX audit diagnostic for the toolset pages (#830): screenshots and
 * axe-core counts for the list, one toolset and the declare form, in English
 * and French, at 375/768/1280 px, light and dark. Scaffolding, not regression
 * coverage. Needs the demo seed and a local stack (`OCI_ENV=local`).
 *
 *   PW_NO_RESET=1 AUDIT_LABEL=after pnpm --filter @oci/web exec \
 *     playwright test e2e/_diagnostic-toolsets.spec.ts
 *
 * Writes `test-results/audit-toolsets/<label>/…` and a `summary.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const SCHEMES = ['light', 'dark'] as const;
const LANGUAGES = [
  { name: 'en', locale: 'en-GB' },
  { name: 'fr', locale: 'fr-FR' },
] as const;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const OUT = join('test-results', 'audit-toolsets', process.env.AUDIT_LABEL ?? 'run');
const SLUG = `e2e-toolset-audit-${Date.now()}`;

test.describe.configure({ timeout: 600_000 });

test('toolset pages across the matrix', async ({ browser, request }) => {
  mkdirSync(OUT, { recursive: true });

  // One published toolset to look at, through the API's local stand-in tokens.
  const asOwner = { Authorization: 'Bearer dev:ux-audit-830:participant' };
  const created = await request.post(`${API}/v2/toolsets`, {
    headers: asOwner,
    data: {
      slug: SLUG,
      name: 'Diabetic retinopathy grading baseline',
      kind: 'NOTEBOOK',
      summary:
        'Trains and scores a small baseline on the grading task, end to end, in one notebook. Reads the dataset from its Croissant description and writes a predictions file the platform accepts.',
      url: 'https://github.com/example/dr-grading-baseline',
      licence: 'Apache-2.0',
      version: '1.2.0',
      maintainer: 'Example Imaging Lab',
      contact: 'baseline@imaging-lab.example',
      datasetSlugs: ['idrid-grading-demo', 'rsna-pneumonia-2018'],
      modelCardSlugs: ['demo-retina-dr-grader'],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const published = await request.post(`${API}/v2/toolsets/${SLUG}/status`, {
    headers: { Authorization: 'Bearer dev:ux-audit-830-op:admin' },
    data: { status: 'PUBLISHED' },
  });
  expect(published.status()).toBe(201);

  const rows: Array<Record<string, unknown>> = [];
  for (const lang of LANGUAGES) {
    for (const scheme of SCHEMES) {
      for (const vp of VIEWPORTS) {
        const context = await browser.newContext({
          locale: lang.locale,
          colorScheme: scheme,
          viewport: { width: vp.width, height: vp.height },
        });
        const page = await context.newPage();
        const scan = async (name: string) => {
          await page.screenshot({
            path: join(OUT, `${name}-${lang.name}-${vp.name}-${scheme}.png`),
            fullPage: true,
          });
          const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
          const sideways = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          );
          rows.push({
            page: name,
            lang: lang.name,
            viewport: vp.name,
            scheme,
            sideways,
            violations: axe.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              targets: v.nodes.map((n) => n.target.join(' ')),
            })),
          });
        };
        await page.goto('/toolsets');
        await scan('list');
        await page.goto(`/toolsets/${SLUG}`);
        await scan('detail');
        await page.goto('/signin?callbackUrl=%2Fdashboard');
        await page.locator('#signin-user').fill('ux-audit-830');
        await page.locator('#signin-roles').fill('participant');
        await page.locator('#signin-roles').press('Enter');
        await page.waitForURL(/\/dashboard/);
        await page.goto('/toolsets/new');
        await scan('form');
        await context.close();
      }
    }
  }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(rows, null, 2));
  const violations = rows.flatMap((r) =>
    (r.violations as Array<{ id: string }>).map((v) => `${String(r.page)} | ${v.id}`),
  );
  console.log(`\n${rows.length} scans, written to ${OUT}`);
  console.log(
    `violations: ${violations.length === 0 ? 'none' : [...new Set(violations)].join(', ')}`,
  );
  console.log(`sideways scroll: ${rows.filter((r) => r.sideways).length}`);
});

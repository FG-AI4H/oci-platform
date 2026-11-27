/**
 * UI/UX audit diagnostic for `/admin/reports` (#828): screenshots and
 * axe-core counts for the current month's report, in English and French, at
 * 375/768/1280 px, light and dark. Scaffolding, not regression coverage.
 *
 *   PW_NO_RESET=1 AUDIT_LABEL=after pnpm --filter @oci/web exec \
 *     playwright test e2e/_diagnostic-activity-report.spec.ts
 *
 * Writes `test-results/audit-activity-report/<label>/…` and a `summary.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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
const OUT = join('test-results', 'audit-activity-report', process.env.AUDIT_LABEL ?? 'run');

test.describe.configure({ timeout: 600_000 });

test('/admin/reports across the matrix', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
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
        await page.goto('/signin?callbackUrl=%2Fdashboard');
        await page.locator('#signin-user').fill('ux-audit-828');
        await page.locator('#signin-roles').fill('admin');
        await page.locator('#signin-roles').press('Enter');
        await page.waitForURL(/\/dashboard/);
        await page.goto(`/admin/reports?month=${month}`);
        await page.locator('#report-audit').waitFor();
        await page.screenshot({
          path: join(OUT, `report-${lang.name}-${vp.name}-${scheme}.png`),
          fullPage: true,
        });
        const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        const sideways = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        );
        rows.push({
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
        await context.close();
      }
    }
  }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(rows, null, 2));
  const violations = rows.flatMap((r) => (r.violations as Array<{ id: string }>).map((v) => v.id));
  console.log(`\n${rows.length} scans, written to ${OUT}`);
  console.log(
    `violations: ${violations.length === 0 ? 'none' : [...new Set(violations)].join(', ')}`,
  );
  console.log(`sideways scroll: ${rows.filter((r) => r.sideways).length}`);
});

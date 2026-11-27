/**
 * UI/UX audit diagnostic for `/use-case` (#829): screenshots and axe-core
 * counts for the empty page, a result page and a refused answer, in English
 * and French, at 375/768/1280 px, light and dark. Scaffolding, not regression
 * coverage. Needs the demo seed.
 *
 *   PW_NO_RESET=1 AUDIT_LABEL=after pnpm --filter @oci/web exec \
 *     playwright test e2e/_diagnostic-use-case.spec.ts
 *
 * Writes `test-results/audit-use-case/<label>/…` and a `summary.json`.
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
const PAGES = [
  ['empty', '/use-case'],
  ['results', '/use-case?intendedUse=COMMERCIAL_RESEARCH&country=EU&q=retina'],
  ['results-all', '/use-case?intendedUse=NON_COMMERCIAL_RESEARCH'],
  ['refused', '/use-case?q=x&intendedUse=NON_COMMERCIAL_RESEARCH'],
] as const;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const OUT = join('test-results', 'audit-use-case', process.env.AUDIT_LABEL ?? 'run');

test.describe.configure({ timeout: 600_000 });

test('/use-case across the matrix', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
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
        for (const [name, path] of PAGES) {
          await page.goto(path);
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
        }
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

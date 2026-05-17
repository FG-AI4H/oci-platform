/**
 * UI/UX audit diagnostic — screenshots + axe-core sweep for the
 * #215 slice-2 web surfaces (manager Tasks card + annotator queue).
 *
 * Scaffolding only. Run with:
 *   PW_NO_SERVER=1 PW_BASE_URL=http://localhost:3001 \
 *   pnpm --filter @oci/web exec playwright test \
 *     e2e/_diagnostic-annotation-slice2.spec.ts --reporter=list
 *
 * Output:
 *   apps/web/test-results/audit/annotation-slice2-{manager,annotator}/
 *     {mobile,tablet,desktop}-{light,dark}.png
 *     {…}.axe.json
 *     summary.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const SCHEMES = ['light', 'dark'] as const;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SLUG = 'demo-rsna-segmentation';

interface Run {
  viewport: string;
  scheme: string;
  url: string;
  violations: { critical: number; serious: number; moderate: number; minor: number; total: number };
  topRules: Array<{ id: string; impact: string | null; nodes: number; help: string }>;
}

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await page.waitForURL(/\/(dashboard)?$/);
}

async function runMatrix(
  browser: Browser,
  label: string,
  setup: (page: Page) => Promise<string>,
): Promise<Run[]> {
  const outDir = join('test-results', 'audit', label);
  mkdirSync(outDir, { recursive: true });
  const runs: Run[] = [];
  for (const vp of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
      });
      const page = await ctx.newPage();
      const finalUrl = await setup(page);
      await page.screenshot({ path: join(outDir, `${vp.name}-${scheme}.png`), fullPage: true });
      const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      writeFileSync(join(outDir, `${vp.name}-${scheme}.axe.json`), JSON.stringify(axe, null, 2));
      const counts = {
        critical: 0,
        serious: 0,
        moderate: 0,
        minor: 0,
        total: axe.violations.length,
      };
      for (const v of axe.violations) {
        if (v.impact === 'critical') counts.critical++;
        else if (v.impact === 'serious') counts.serious++;
        else if (v.impact === 'moderate') counts.moderate++;
        else if (v.impact === 'minor') counts.minor++;
      }
      const topRules = axe.violations
        .sort((a, b) => (b.nodes?.length ?? 0) - (a.nodes?.length ?? 0))
        .slice(0, 8)
        .map((v) => ({
          id: v.id,
          impact: v.impact ?? null,
          nodes: v.nodes?.length ?? 0,
          help: v.help,
        }));
      runs.push({ viewport: vp.name, scheme, url: finalUrl, violations: counts, topRules });
      await ctx.close();
    }
  }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(runs, null, 2));
  return runs;
}

test.describe('ui/ux diagnostic — annotation slice 2', () => {
  test.describe.configure({ mode: 'serial' });

  test('campaign manager — tasks card', async ({ browser }) => {
    await runMatrix(browser, 'annotation-slice2-manager', async (page) => {
      await signInAs(page, 'cm', 'campaign-manager');
      await page.goto(`/annotation/campaigns/${SLUG}`);
      await page.waitForLoadState('networkidle');
      return page.url();
    });
  });

  test('annotator — queue page', async ({ browser }) => {
    await runMatrix(browser, 'annotation-slice2-annotator', async (page) => {
      await signInAs(page, 'annie', 'annotator');
      await page.goto(`/annotation/campaigns/${SLUG}/annotate`);
      await page.waitForLoadState('networkidle');
      return page.url();
    });
  });
});

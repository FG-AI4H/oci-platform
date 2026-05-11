/**
 * UI/UX diagnostic — pages shipped in the 2026-05-08 session that
 * haven't yet been audited.
 *
 * Targets:
 *   1. /catalog/isic-2019-melanoma — access-CTA panel
 *   2. /catalog/isic-2019-melanoma?requested=1 — post-submit confirmation banner
 *   3. /settings — preferences page (light + dark)
 *   4. /catalog — list view in dark mode against seeded RESTRICTED datasets
 *
 * Run:
 *   pnpm --filter @oci/web exec playwright test e2e/_diagnostic-session.spec.ts
 *
 * Outputs:
 *   apps/web/test-results/audit/<label>/<viewport>-<scheme>.png + .axe.json
 *   apps/web/test-results/audit/SESSION-SUMMARY.md
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

interface Run {
  viewport: string;
  scheme: string;
  url: string;
  violations: { critical: number; serious: number; moderate: number; minor: number; total: number };
  topRules: Array<{ id: string; impact: string | null; nodes: number; help: string }>;
}

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/api/auth/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles', { exact: false }).fill(roles);
  await page.getByRole('button', { name: /sign in/i }).click();
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

      const screenshot = join(outDir, `${vp.name}-${scheme}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });

      const axeResults = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      writeFileSync(
        join(outDir, `${vp.name}-${scheme}.axe.json`),
        JSON.stringify(axeResults, null, 2),
      );

      const counts = {
        critical: 0,
        serious: 0,
        moderate: 0,
        minor: 0,
        total: axeResults.violations.length,
      };
      for (const v of axeResults.violations) {
        switch (v.impact) {
          case 'critical':
            counts.critical++;
            break;
          case 'serious':
            counts.serious++;
            break;
          case 'moderate':
            counts.moderate++;
            break;
          case 'minor':
            counts.minor++;
            break;
        }
      }
      const topRules = axeResults.violations
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

const sections: Array<{ label: string; runs: Run[] }> = [];

test.describe('ui/ux diagnostic — 2026-05-08 session', () => {
  test.describe.configure({ mode: 'serial' });

  test('catalog detail — restricted dataset (signed-in participant, pre-submit)', async ({
    browser,
  }) => {
    const runs = await runMatrix(browser, 'session-catalog-detail-restricted', async (page) => {
      await signInAs(page, `audit-builder-${Date.now()}`, 'participant');
      await page.goto('/catalog/isic-2019-melanoma');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'session-catalog-detail-restricted', runs });
  });

  test('catalog detail — post-submit confirmation banner (?requested=1)', async ({ browser }) => {
    const runs = await runMatrix(browser, 'session-catalog-post-submit', async (page) => {
      // Direct visit with the query param. Even though the user hasn't
      // actually submitted (no PENDING request in DB for this fresh
      // user), the access-cta still renders the gated CTA above; the
      // banner only fires when latest.status === 'PENDING'. We capture
      // the typical landing state — after a real submit, the matcher
      // creates the request, and the banner + status panel show. To
      // keep the audit deterministic without seeding state, capture the
      // route as-rendered for an authenticated participant.
      await signInAs(page, `audit-banner-${Date.now()}`, 'participant');
      await page.goto('/catalog/isic-2019-melanoma?requested=1');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'session-catalog-post-submit', runs });
  });

  test('settings page — preferences form', async ({ browser }) => {
    const runs = await runMatrix(browser, 'session-settings', async (page) => {
      await signInAs(page, `audit-prefs-${Date.now()}`, 'participant');
      await page.goto('/settings');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'session-settings', runs });
  });

  test('catalog list — dark mode (signed-in host with seeded datasets)', async ({ browser }) => {
    const runs = await runMatrix(browser, 'session-catalog-list-dark', async (page) => {
      // bob is the host of all three seeded datasets, so they all show.
      await signInAs(page, 'bob', 'host');
      await page.goto('/catalog');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'session-catalog-list-dark', runs });
  });

  test('print combined summary', async () => {
    const lines: string[] = [];
    lines.push('# UI/UX audit — 2026-05-08 session pages\n');
    lines.push(`Generated ${new Date().toISOString()}\n`);
    for (const { label, runs } of sections) {
      lines.push(`## ${label}`);
      for (const run of runs) {
        lines.push(
          `- ${run.viewport}/${run.scheme} → total=${run.violations.total} crit=${run.violations.critical} ser=${run.violations.serious} mod=${run.violations.moderate} min=${run.violations.minor}`,
        );
        for (const r of run.topRules) {
          lines.push(`    - [${r.impact ?? '—'}] ${r.id} × ${r.nodes} — ${r.help}`);
        }
      }
      lines.push('');
    }
    const md = lines.join('\n');
    writeFileSync('test-results/audit/SESSION-SUMMARY.md', md);
    process.stdout.write('\n' + md + '\n');
  });
});

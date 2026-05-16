/**
 * UI/UX audit diagnostic spec — captures screenshots + axe-core results
 * for the host workflow surfaces across the viewport × color-scheme matrix.
 *
 * This is scaffolding, not regression coverage. Skip in normal runs (the
 * leading underscore on the filename is a soft convention; we also
 * `test.describe.skip` in CI by checking PW_SKIP_DIAGNOSTIC).
 *
 * Run with:
 *   pnpm --filter @oci/web exec playwright test e2e/_diagnostic.spec.ts
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

// Skipped by default — this is audit scaffolding, not regression
// coverage. Flip to `test.describe(...)` to re-run a UI/UX audit; the
// captured artefacts land in apps/web/test-results/audit/.
test.describe('ui/ux diagnostic', () => {
  test.describe.configure({ mode: 'serial' });

  test('homepage (anonymous)', async ({ browser }) => {
    const runs = await runMatrix(browser, 'home-anon', async (page) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'home-anon', runs });
  });

  test('homepage (signed in)', async ({ browser }) => {
    const runs = await runMatrix(browser, 'home-auth', async (page) => {
      await signInAs(page, 'bob', 'host');
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'home-auth', runs });
  });

  test('catalog list (anonymous)', async ({ browser }) => {
    const runs = await runMatrix(browser, 'catalog-list', async (page) => {
      await page.goto('/catalog');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'catalog-list', runs });
  });

  test('catalog detail (anonymous)', async ({ browser }) => {
    const runs = await runMatrix(browser, 'catalog-detail', async (page) => {
      await page.goto('/catalog');
      const firstLink = page.locator('a[href^="/catalog/"]').first();
      await firstLink.click();
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'catalog-detail', runs });
  });

  test('dashboard (signed in)', async ({ browser }) => {
    const runs = await runMatrix(browser, 'dashboard', async (page) => {
      await signInAs(page, 'bob', 'host');
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'dashboard', runs });
  });

  test('catalog new dataset (host)', async ({ browser }) => {
    const runs = await runMatrix(browser, 'catalog-new', async (page) => {
      await signInAs(page, 'bob', 'host');
      await page.goto('/catalog/new');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'catalog-new', runs });
  });

  test('publish version page (host) — initial', async ({ browser }) => {
    const runs = await runMatrix(browser, 'catalog-publish-empty', async (page) => {
      await signInAs(page, 'bob', 'host');
      // Create a fresh draft, then land on publish page.
      const slug = `audit-${Date.now()}`;
      await page.goto('/catalog/new');
      await page.getByLabel('Slug').fill(slug);
      await page.getByLabel('Name').fill(`Audit ${slug}`);
      await page.getByRole('radio', { name: 'PRIVATE' }).check();
      await page.getByRole('button', { name: /create draft/i }).click();
      await page.waitForURL(new RegExp(`/catalog/${slug}/publish$`));
      return page.url();
    });
    sections.push({ label: 'catalog-publish-empty', runs });
  });

  test('publish version page — validation error state', async ({ browser }) => {
    const runs = await runMatrix(browser, 'catalog-publish-invalid', async (page) => {
      await signInAs(page, 'bob', 'host');
      const slug = `audit-err-${Date.now()}`;
      await page.goto('/catalog/new');
      await page.getByLabel('Slug').fill(slug);
      await page.getByLabel('Name').fill(`Audit Err ${slug}`);
      await page.getByRole('radio', { name: 'PRIVATE' }).check();
      await page.getByRole('button', { name: /create draft/i }).click();
      await page.waitForURL(new RegExp(`/catalog/${slug}/publish$`));
      // Switch to the paste form (PR K wizard is the default). The
      // mode toggle is a tablist (`<button role="tab">`); ARIA role
      // lookup uses the explicit `tab` role, not the tag name.
      await page.getByRole('tab', { name: 'I already have a manifest' }).click();
      // Trigger the structured-validation panel
      await page.getByLabel('Croissant manifest').fill('{"@type":"sc:Dataset","name":"x"}');
      await page.getByRole('button', { name: /validate.*publish/i }).click();
      await page.getByRole('heading', { name: /manifest validation failed/i }).waitFor();
      return page.url();
    });
    sections.push({ label: 'catalog-publish-invalid', runs });
  });

  test('annotation campaigns list (signed in)', async ({ browser }) => {
    const runs = await runMatrix(browser, 'annotation-campaigns-list', async (page) => {
      await signInAs(page, 'cm', 'campaign-manager');
      await page.goto('/annotation/campaigns');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'annotation-campaigns-list', runs });
  });

  test('annotation campaign — new (campaign-manager)', async ({ browser }) => {
    const runs = await runMatrix(browser, 'annotation-campaigns-new', async (page) => {
      await signInAs(page, 'cm', 'campaign-manager');
      await page.goto('/annotation/campaigns/new');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'annotation-campaigns-new', runs });
  });

  test('admin index (admin)', async ({ browser }) => {
    const runs = await runMatrix(browser, 'admin-index', async (page) => {
      await signInAs(page, 'alice', 'admin');
      await page.goto('/admin');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'admin-index', runs });
  });

  test('admin users list (admin)', async ({ browser }) => {
    const runs = await runMatrix(browser, 'admin-users-list', async (page) => {
      await signInAs(page, 'alice', 'admin');
      await page.goto('/admin/users');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'admin-users-list', runs });
  });

  test('admin user detail (admin)', async ({ browser }) => {
    const runs = await runMatrix(browser, 'admin-user-detail', async (page) => {
      await signInAs(page, 'alice', 'admin');
      await page.goto('/admin/users/bob');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'admin-user-detail', runs });
  });

  test('admin settings (admin)', async ({ browser }) => {
    const runs = await runMatrix(browser, 'admin-settings', async (page) => {
      await signInAs(page, 'alice', 'admin');
      await page.goto('/admin/settings');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
    sections.push({ label: 'admin-settings', runs });
  });

  test('print combined summary', async () => {
    const lines: string[] = [];
    lines.push('# UI/UX audit summary\n');
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
    writeFileSync('test-results/audit/SUMMARY.md', md);
    process.stdout.write('\n' + md + '\n');
  });
});

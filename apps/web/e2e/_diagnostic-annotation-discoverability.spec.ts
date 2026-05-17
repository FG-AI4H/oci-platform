import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [{ name: 'desktop', width: 1280, height: 800 }] as const;
const SCHEMES = ['light'] as const;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await page.waitForURL(/\/(dashboard)?$/);
}

async function runMatrix(browser: Browser, label: string, setup: (page: Page) => Promise<string>) {
  const outDir = join('test-results', 'audit', label);
  mkdirSync(outDir, { recursive: true });
  for (const vp of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
      });
      const page = await ctx.newPage();
      await setup(page);
      await page.screenshot({ path: join(outDir, `${vp.name}-${scheme}.png`), fullPage: true });
      const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      writeFileSync(join(outDir, `${vp.name}-${scheme}.axe.json`), JSON.stringify(axe, null, 2));
      await ctx.close();
    }
  }
}

test.describe('ui/ux diagnostic — discoverability', () => {
  test.describe.configure({ mode: 'serial' });

  test('annotator — dashboard tile', async ({ browser }) => {
    await runMatrix(browser, 'discoverability-dashboard-annotator', async (page) => {
      await signInAs(page, 'annie', 'annotator');
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
  });

  test('annotator — campaign list inline button', async ({ browser }) => {
    await runMatrix(browser, 'discoverability-list-annotator', async (page) => {
      await signInAs(page, 'annie', 'annotator');
      await page.goto('/annotation/campaigns');
      await page.waitForLoadState('networkidle');
      return page.url();
    });
  });
});

/**
 * UI/UX audit diagnostic for the dataset publish wizard
 * (/catalog/[slug]/publish). Scaffolding, not regression coverage.
 *
 * Run with the local stack up:
 *   PW_NO_SERVER=1 PW_NO_RESET=1 pnpm --filter @oci/web exec playwright test e2e/_diagnostic-publish-wizard.spec.ts
 *
 * Captures the wizard on the steps that matter for layout (identification,
 * creators with four rows, distributions, review) across the viewport ×
 * colour-scheme matrix, and runs axe-core on each capture. Artefacts land
 * in apps/web/test-results/audit/publish-wizard-<tag>/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const TAG = process.env.AUDIT_TAG ?? 'before';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'wide', width: 1536, height: 900 },
] as const;
const SCHEMES = ['light', 'dark'] as const;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

interface Run {
  step: string;
  viewport: string;
  scheme: string;
  nameInputWidth: number | null;
  formColumnWidth: number | null;
  violations: { critical: number; serious: number; moderate: number; minor: number; total: number };
  topRules: Array<{ id: string; impact: string | null; nodes: number; help: string; html: string }>;
}

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles', { exact: false }).fill(roles);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

async function ensureDataset(page: Page, slug: string) {
  await page.goto(`/catalog/${slug}/publish`);
  if (await page.getByRole('heading', { name: /Publish a new version/ }).count()) return;
  await page.goto('/catalog/new');
  await page.getByLabel('Slug').fill(slug);
  await page.getByLabel('Name').fill('Audit: Radio Resource Management for 6G in-X Subnetworks');
  await page
    .getByLabel('Description')
    .fill('Simulated channel state information for in-factory subnetworks (audit fixture).');
  await page.getByRole('button', { name: /create/i }).click();
  await page.waitForURL(new RegExp(`/catalog/${slug}/publish$`));
}

async function fillCreators(page: Page) {
  await page.getByLabel('Dataset name').fill('Radio Resource Management for 6G in-X Subnetworks');
  await page.getByLabel('Description').fill('Simulated channel state information.');
  await page.getByLabel('Homepage').fill('https://zenodo.org/records/10908382');
  await page.getByRole('button', { name: /^Next: Creators/ }).click();
  const names = ['Saeed Hakimi', 'Gilberto Berardinelli', 'Ramoni Adeogun'];
  await page
    .getByLabel('Name')
    .first()
    .fill(names.at(0) ?? '');
  for (let i = 1; i < names.length; i++) {
    await page.getByRole('button', { name: 'Add creator' }).click();
    await page
      .getByLabel('Name')
      .nth(i)
      .fill(names.at(i) ?? '');
  }
  await page.getByRole('button', { name: 'Add creator' }).click();
  await page.getByLabel('Name').nth(3).fill('x');
  await page.getByLabel('Name').nth(3).fill('');
}

async function goToStep(page: Page, label: string) {
  // Walk forward with Next until the heading matches; the stepper may or
  // may not be clickable depending on the build under audit.
  for (let i = 0; i < 8; i++) {
    if (await page.getByRole('heading', { name: label, exact: false }).count()) return;
    // The data-use step gates "Next" on a DUO term for non-public datasets.
    const duo = page.getByLabel(/General research use/i);
    if ((await duo.count()) && !(await duo.isChecked())) await duo.check();
    const next = page.getByRole('button', { name: /^Next:/ });
    if ((await next.count()) === 0 || (await next.isDisabled())) return;
    await next.click();
  }
}

async function measure(page: Page): Promise<{ name: number | null; form: number | null }> {
  const nameField = page.getByLabel('Name').first();
  const name =
    (await nameField.count()) > 0
      ? await nameField.boundingBox().then((b) => (b ? Math.round(b.width) : null))
      : null;
  const column = page.locator('fieldset, [aria-label="Generated manifest"]').first();
  const form =
    (await column.count()) > 0
      ? await column.boundingBox().then((b) => (b ? Math.round(b.width) : null))
      : null;
  return { name, form };
}

async function capture(
  browser: Browser,
  step: string,
  prepare: (page: Page) => Promise<void>,
): Promise<Run[]> {
  const outDir = join('test-results', 'audit', `publish-wizard-${TAG}`);
  mkdirSync(outDir, { recursive: true });
  const runs: Run[] = [];
  for (const vp of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
      });
      const page = await ctx.newPage();
      await signInAs(page, 'audit-host', 'host');
      await ensureDataset(page, 'ux-publish-wizard-audit');
      await prepare(page);
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: join(outDir, `${step}-${vp.name}-${scheme}.png`),
        fullPage: true,
      });
      const m = await measure(page);
      const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
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
      runs.push({
        step,
        viewport: vp.name,
        scheme,
        nameInputWidth: m.name,
        formColumnWidth: m.form,
        violations: counts,
        topRules: axe.violations.slice(0, 6).map((v) => ({
          id: v.id,
          impact: v.impact ?? null,
          nodes: v.nodes?.length ?? 0,
          help: v.help,
          html: v.nodes.at(0)?.html ?? '',
        })),
      });
      await ctx.close();
    }
  }
  const summaryPath = join(outDir, `${step}.summary.json`);
  writeFileSync(summaryPath, JSON.stringify(runs, null, 2));
  return runs;
}

test.describe('publish wizard diagnostic', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);

  test('identification step', async ({ browser }) => {
    await capture(browser, 'identification', async () => {});
  });

  test('creators step with four rows', async ({ browser }) => {
    await capture(browser, 'creators', async (page) => {
      await fillCreators(page);
    });
  });

  test('distributions step', async ({ browser }) => {
    await capture(browser, 'distributions', async (page) => {
      await fillCreators(page);
      await page.getByLabel('Name').nth(3).fill('Aalborg University');
      await goToStep(page, 'Distributions');
      await page.getByRole('button', { name: 'Add distribution' }).click();
    });
  });

  test('review step', async ({ browser }) => {
    await capture(browser, 'review', async (page) => {
      await fillCreators(page);
      await page.getByLabel('Name').nth(3).fill('Aalborg University');
      await goToStep(page, 'Review');
    });
  });
});

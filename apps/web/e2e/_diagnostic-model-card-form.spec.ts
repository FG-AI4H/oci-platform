/**
 * UI/UX audit diagnostic for the model-card form (#651): screenshots and
 * axe-core counts for /models/new (every step, and the error state), the
 * edit page, the card page with its status panel, and "My models" on the
 * dashboard, in English and French, at 375/1024/1280 px, light and dark.
 * Scaffolding, not regression coverage.
 *
 *   PW_NO_RESET=1 PW_NO_SERVER=1 PW_BASE_URL=… NEXT_PUBLIC_API_BASE_URL=… \
 *     AUDIT_LABEL=after pnpm --filter @oci/web exec \
 *     playwright test e2e/_diagnostic-model-card-form.spec.ts
 *
 * Writes `test-results/audit-model-card/<label>/…` and a `summary.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 740 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const SCHEMES = ['light', 'dark'] as const;
const LANGUAGES = [
  { name: 'en', locale: 'en-GB' },
  { name: 'fr', locale: 'fr-FR' },
] as const;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const USER = 'ux-audit-651';
const SLUG = `ux-audit-651-${Date.now()}`;
const OUT = join('test-results', 'audit-model-card', process.env.AUDIT_LABEL ?? 'run');

test.describe.configure({ timeout: 900_000 });

interface Row {
  page: string;
  lang: string;
  viewport: string;
  scheme: string;
  violations: Array<{ id: string; impact: string | null | undefined; nodes: number }>;
  sideways: boolean;
}

async function scan(page: Page, name: string, ctx: Omit<Row, 'page' | 'violations' | 'sideways'>) {
  const file = `${name}-${ctx.lang}-${ctx.viewport}-${ctx.scheme}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  return {
    page: name,
    ...ctx,
    sideways,
    violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
  } satisfies Row;
}

const nextStep = (page: Page) =>
  page
    .locator('form > div > button[type="button"]')
    .filter({ hasText: /:/, visible: true })
    .click();

test('model-card pages across the matrix', async ({ browser, request }) => {
  mkdirSync(OUT, { recursive: true });

  // A draft owned by the audit user, created through the API's dev headers.
  const created = await request.post(`${API}/v2/prediction/model-cards`, {
    headers: { 'X-Dev-User': USER, 'X-Dev-Roles': 'participant' },
    data: {
      slug: SLUG,
      intendedUse: {
        v: 1,
        medicalPurpose: 'screening',
        intendedClinicalPathway: 'screening-before-specialist',
        operatingEnvironment: ['primary-care'],
        intendedUserRole: ['radiologist'],
        foreseeableMisuse: 'Used on paediatric films.',
        contraindications: '',
        riskTier: 'II',
      },
      modelClass: 'classical',
      architectureSummary: 'Convolutional network over chest radiographs.',
      versionMajorMinorPatch: '1.0.0',
      modelDeveloper: 'Example Imaging Lab',
      developerContact: 'models@example.org',
      clinicalSummary: 'Flags chest radiographs for specialist reading.',
    },
  });
  expect(created.status()).toBe(201);

  const rows: Row[] = [];
  for (const lang of LANGUAGES) {
    for (const scheme of SCHEMES) {
      for (const vp of VIEWPORTS) {
        const context = await browser.newContext({
          locale: lang.locale,
          colorScheme: scheme,
          viewport: { width: vp.width, height: vp.height },
        });
        const page = await context.newPage();
        const meta = { lang: lang.name, viewport: vp.name, scheme };
        await page.goto('/signin?callbackUrl=%2Fdashboard');
        await page.locator('#signin-user').fill(USER);
        await page.locator('#signin-roles').fill('participant');
        await page.locator('#signin-roles').press('Enter');
        await page.waitForURL(/\/dashboard/);
        rows.push(await scan(page, 'dashboard', meta));

        await page.goto(`/models/${SLUG}`);
        rows.push(await scan(page, 'card-draft', meta));

        await page.goto('/models/new');
        rows.push(await scan(page, 'new-1-model', meta));
        await page.locator('#mc-slug').fill(`${SLUG}-x`);
        await page.locator('#mc-modelClass').selectOption('foundation');
        await page.locator('#mc-modelDeveloper').fill('Example Imaging Lab');
        await page.locator('#mc-developerContact').fill('models@example.org');
        await page.locator('#mc-architectureSummary').fill('Vision transformer.');
        await nextStep(page);
        await page.locator('#mc-medicalPurpose').selectOption('triage');
        await page.locator('input[name="operatingEnvironment"][value="emergency"]').check();
        await page.locator('#mc-foreseeableMisuse').fill('Used outside the emergency department.');
        rows.push(await scan(page, 'new-2-intended-use', meta));
        await nextStep(page);
        rows.push(await scan(page, 'new-3-risk-tier', meta));
        await nextStep(page);
        rows.push(await scan(page, 'new-4-evidence', meta));
        await nextStep(page);
        rows.push(await scan(page, 'new-5-review', meta));

        // Error state: the existing slug, refused by the API.
        await page.locator('main nav ol button').first().click();
        await page.locator('#mc-slug').fill(SLUG);
        await page.locator('main nav ol button').last().click();
        await page
          .locator('main form button[type="submit"]')
          .filter({ visible: true })
          .last()
          .click();
        await page.locator('#mc-slug-err').waitFor();
        rows.push(await scan(page, 'new-error', meta));

        await page.goto(`/models/${SLUG}/edit`);
        rows.push(await scan(page, 'edit', meta));
        await context.close();
      }
    }
  }

  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(rows, null, 2));
  const total = rows.reduce((n, r) => n + r.violations.reduce((m, v) => m + v.nodes, 0), 0);
  console.log(`axe violation nodes across ${rows.length} captures: ${total}`);
  for (const r of rows.filter((x) => x.violations.length > 0 || x.sideways)) {
    console.log(JSON.stringify(r));
  }
});

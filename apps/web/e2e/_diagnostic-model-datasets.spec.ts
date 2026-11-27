/**
 * UI/UX audit diagnostic for the datasets of a model card (#820): screenshots
 * and axe-core counts for the model page's "Data" section, the dataset page's
 * "Models that use this dataset" card, and the dataset rows of the model card
 * form (filled, and refused), in English and French, at 375/768/1280 px, light
 * and dark. Scaffolding, not regression coverage.
 *
 *   PW_NO_RESET=1 AUDIT_LABEL=after pnpm --filter @oci/web exec \
 *     playwright test e2e/_diagnostic-model-datasets.spec.ts
 *
 * `AUDIT_PUBLIC_ONLY=1` scans the two public pages only, so the same run can
 * be pointed at a deployed environment for a baseline (`PW_BASE_URL=…`).
 *
 * Needs the demo seed. Writes `test-results/audit-model-datasets/<label>/…`
 * and a `summary.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
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
const OUT = join('test-results', 'audit-model-datasets', process.env.AUDIT_LABEL ?? 'run');
const PUBLIC_ONLY = Boolean(process.env.AUDIT_PUBLIC_ONLY);

test.describe.configure({ timeout: 900_000 });

interface Row {
  page: string;
  lang: string;
  viewport: string;
  scheme: string;
  sideways: boolean;
  violations: Array<{ id: string; impact: string | null | undefined; targets: string[] }>;
}

async function scan(page: Page, name: string, ctx: Pick<Row, 'lang' | 'viewport' | 'scheme'>) {
  await page.screenshot({
    path: join(OUT, `${name}-${ctx.lang}-${ctx.viewport}-${ctx.scheme}.png`),
    fullPage: true,
  });
  const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  return {
    page: name,
    ...ctx,
    sideways,
    violations: axe.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.map((n) => n.target.join(' ')),
    })),
  } satisfies Row;
}

test('datasets of a model card across the matrix', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
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

        await page.goto('/models/demo-retina-dr-grader');
        rows.push(await scan(page, 'model-page', meta));
        await page.goto('/catalog/rsna-pneumonia-2018');
        rows.push(await scan(page, 'dataset-page', meta));

        if (!PUBLIC_ONLY) {
          await page.goto('/signin?callbackUrl=%2Fdashboard');
          await page.locator('#signin-user').fill('ux-audit-820');
          await page.locator('#signin-roles').fill('participant');
          await page.locator('#signin-roles').press('Enter');
          await page.waitForURL(/\/dashboard/);

          await page.goto('/models/new');
          await page.locator('#mc-slug').fill(`ux-audit-820-${Date.now()}`);
          await page.locator('#mc-modelClass').selectOption('classical');
          await page.locator('#mc-modelDeveloper').fill('Example Imaging Lab');
          await page.locator('#mc-developerContact').fill('models@example.org');
          await page.locator('#mc-architectureSummary').fill('Convolutional network.');
          const next = () =>
            page
              .locator('form > div > button[type="button"]')
              .filter({ hasText: /:/, visible: true })
              .click();
          await next();
          await page.locator('#mc-medicalPurpose').selectOption('triage');
          await page.locator('input[name="intendedUserRole"][value="radiologist"]').check();
          await page.locator('#mc-foreseeableMisuse').fill('Used on paediatric films.');
          await next();
          await next();
          const add = page.locator('fieldset[data-step="evidence"] button', {
            hasText: /dataset|jeu de données/i,
          });
          await add.last().click();
          await page.locator('#mc-datasetRef-0-target').fill('rsna-pneumonia-2018');
          await page.locator('#mc-datasetRef-0-note').fill('Training split');
          await add.last().click();
          await page.locator('#mc-datasetRef-1-role').selectOption('EVALUATION');
          await page.locator('#mc-datasetRef-1-target').fill('https://doi.org/10.5555/ux-audit');
          await page.locator('#mc-datasetRef-1-name').fill('External test set');
          await add.last().click();
          await page.locator('#mc-datasetRef-2-target').fill('ux-no-such-dataset');
          rows.push(await scan(page, 'form-rows', meta));

          await next();
          rows.push(await scan(page, 'form-review', meta));
          // The model card form's own submit button; the header has other forms.
          await page
            .locator('form:has(fieldset[data-step="evidence"]) button[type="submit"]')
            .click();
          await page.locator('#mc-datasetRef-2-err').waitFor();
          rows.push(await scan(page, 'form-refused', meta));
        }
        await context.close();
      }
    }
  }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(rows, null, 2));

  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const v of row.violations) {
      const key = `${row.page} | ${v.id} (${v.impact})`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  console.log(`\n${rows.length} scans, written to ${OUT}`);
  console.log(
    `sideways scroll: ${
      rows
        .filter((r) => r.sideways)
        .map((r) => `${r.page}/${r.viewport}`)
        .join(', ') || 'none'
    }`,
  );
  for (const [key, n] of [...counts].sort()) console.log(`${String(n).padStart(3)} × ${key}`);
});

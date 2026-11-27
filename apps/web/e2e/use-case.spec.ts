import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * From a use case to suggestions (#829): `/use-case` asks what the visitor
 * wants to do and lists the datasets, the evaluation tasks and the models
 * that fit, each dataset with what the access check says for that kind of
 * use; a request for access started from there carries the answers.
 *
 * Pre-conditions: docker compose + API on :3000 + web on :3001, and the demo
 * seed (`rsna-pneumonia-2018`, a non-commercial dataset; `idrid-grading-demo`
 * with its task; the demonstration retina grader).
 */

test.describe.configure({ timeout: 120_000 });
test.use({ locale: 'en-GB' });

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FIXTURE = resolvePath(process.cwd(), '../api/scripts/fixtures/idrid.croissant.json');
const HOST = '00000000-0000-4f00-8000-000000000f21';

const datasets = (page: Page) => page.locator('section[aria-labelledby="uc-datasets"]');
const tasks = (page: Page) => page.locator('section[aria-labelledby="uc-tasks"]');
const models = (page: Page) => page.locator('section[aria-labelledby="uc-models"]');
const show = (page: Page) => page.getByRole('button', { name: 'Show suggestions' }).click();

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

test('the same dataset is compatible for research and in conflict for a commercial use', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Start from a use case' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Start from a use case' }),
  ).toBeVisible();
  // Before any answer: how it works, no result.
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await expect(datasets(page)).toHaveCount(0);

  await page.getByLabel('Condition or body site').fill('pneumonia');
  await show(page);
  await expect(page).toHaveURL(/\/use-case\?.*q=pneumonia/);
  const rsna = datasets(page).locator('li', {
    has: page.locator('a[href="/catalog/rsna-pneumonia-2018"]'),
  });
  await expect(rsna).toContainText('Compatible with this use');
  await expect(rsna.getByRole('link', { name: /^Open the dataset/ })).toBeVisible();
  // The answers are kept in the form and in the address.
  await expect(page.getByLabel('Condition or body site')).toHaveValue('pneumonia');
  await expect(page.getByRole('link', { name: 'Link to this use case' })).toHaveAttribute(
    'href',
    '/use-case?q=pneumonia&intendedUse=NON_COMMERCIAL_RESEARCH',
  );

  await page.getByLabel('Kind of use').selectOption('COMMERCIAL_RESEARCH');
  await show(page);
  await expect(rsna).toContainText('Conflicts with the terms');
  await expect(rsna).not.toContainText('Compatible with this use');

  expect((await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()).violations).toEqual([]);
});

test('tasks on a suggested dataset, and models by words and country', async ({ page }) => {
  await page.goto('/use-case?q=IDRiD&intendedUse=NON_COMMERCIAL_RESEARCH');
  await expect(
    datasets(page).locator('a[href="/catalog/idrid-grading-demo"]').first(),
  ).toBeVisible();
  const task = tasks(page).locator('li', {
    has: page.locator('a[href="/evaluation/idrid-dr-grading"]'),
  });
  await expect(task).toContainText('on a suggested dataset');
  await expect(models(page)).toContainText('No published model matches.');

  await page.goto('/use-case?q=retina&country=EU&intendedUse=NON_COMMERCIAL_RESEARCH');
  await expect(models(page).locator('a[href="/models/demo-retina-dr-grader"]')).toBeVisible();

  // Without words or a country there is nothing to match a model on.
  await page.goto('/use-case?modality=CT&intendedUse=NON_COMMERCIAL_RESEARCH');
  await expect(models(page)).toContainText('Give a condition or a country to find models.');
});

test('an answer that cannot be read is said so, and nothing is suggested', async ({ page }) => {
  await page.goto('/use-case?q=x&intendedUse=NON_COMMERCIAL_RESEARCH');

  await expect(page.getByText('Check the use case')).toBeVisible();
  await expect(page.getByText(/^Condition or body site:/)).toBeVisible();
  await expect(datasets(page)).toHaveCount(0);
  await expect(page.getByLabel('Condition or body site')).toHaveValue('x');
});

test('a request for access started from a use case carries the kind of use and the ethics approval', async ({
  browser,
}) => {
  const stamp = Date.now();
  const token = `ucase${stamp.toString(36)}`;
  const slug = `restricted-${stamp}`;

  const hostCtx = await browser.newContext({ locale: 'en-GB' });
  const host = await hostCtx.newPage();
  await signInAs(host, HOST, 'host');
  await host.goto('/catalog/new');
  await host.getByLabel('Slug').fill(slug);
  await host.getByLabel('Name').fill(`Restricted ${token}`);
  await host.getByRole('radio', { name: 'Restricted' }).check();
  await host.getByRole('button', { name: /create draft/i }).click();
  await expect(host).toHaveURL(new RegExp(`/catalog/${slug}/publish$`));
  const manifest = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  manifest.name = `Restricted ${token}`;
  manifest.consentCode = ['DUO_0000042', 'DUO_0000021'].map((id) => ({
    '@type': 'sc:DefinedTerm',
    '@id': `http://purl.obolibrary.org/obo/${id}`,
    termCode: id,
  }));
  await host.getByRole('tab', { name: 'I already have a manifest' }).click();
  await host.getByLabel('Croissant manifest').fill(JSON.stringify(manifest));
  await host.getByRole('button', { name: /validate.*publish/i }).click();
  await expect(host).toHaveURL(new RegExp(`/catalog/${slug}$`));
  await hostCtx.close();

  const ctx = await browser.newContext({ locale: 'en-GB' });
  const page = await ctx.newPage();
  await signInAs(page, 'e2e-use-case', 'participant');
  await page.goto('/use-case');
  await page.getByLabel('Condition or body site').fill(token);
  await page.getByLabel('Kind of use').selectOption('CLINICAL_CARE');
  await show(page);

  // Requires an ethics approval the use case has not declared.
  const row = datasets(page).locator('li', { has: page.locator(`a[href="/catalog/${slug}"]`) });
  await expect(row).toContainText('Conflicts with the terms');
  await expect(row).toContainText('Access on request');

  await page.getByLabel('An ethics committee has approved the project').check();
  await show(page);
  await expect(row).not.toContainText('Conflicts with the terms');

  await row.getByRole('link', { name: /^Request access/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/catalog/${slug}/request-access\\?intendedUse=CLINICAL_CARE&irbApproved=true$`),
  );
  await expect(
    page.locator('input[name="intendedUseCategory"][value="CLINICAL_CARE"]'),
  ).toBeChecked();
  await expect(page.locator('input[name="irbApproved"]')).toBeChecked();
  await ctx.close();
});

test('the page reads in French', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'fr-FR' });
  const page = await ctx.newPage();
  await page.goto('/use-case?q=pneumonia&intendedUse=COMMERCIAL_RESEARCH');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Partir d’un cas d’usage' }),
  ).toBeVisible();
  await expect(datasets(page)).toContainText('Contraire aux conditions');
  expect((await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()).violations).toEqual([]);
  await ctx.close();
});

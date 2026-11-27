import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Toolsets, a fourth catalogue listed by reference (#830, ADR-0031): declared
 * by anyone signed in, published by an operator, found by everyone, withdrawn
 * by their declarer.
 *
 * Pre-conditions: docker compose + API on :3000 + web on :3001, and the demo
 * seed (the public dataset `rsna-pneumonia-2018` and the published model card
 * `demo-retina-dr-grader`). `global-setup` removes `e2e-toolset-*` rows.
 */

test.describe.configure({ timeout: 120_000 });
test.use({ locale: 'en-GB' });

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const DATASET = 'rsna-pneumonia-2018';
const MODEL = 'demo-retina-dr-grader';
const ADDRESS = 'https://github.com/example/e2e-baseline';

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.locator('#signin-user').fill(user);
  await page.locator('#signin-roles').fill(roles);
  await page.locator('#signin-roles').press('Enter');
  await page.waitForURL(/\/dashboard/);
}

test('declared, published by an operator, found by anyone, withdrawn by its declarer', async ({
  browser,
}) => {
  const stamp = Date.now();
  const slug = `e2e-toolset-${stamp}`;
  const name = `E2E baseline notebook ${stamp.toString(36)}`;

  // -- A participant declares it.
  const ownerCtx = await browser.newContext({ locale: 'en-GB' });
  const owner = await ownerCtx.newPage();
  await signInAs(owner, 'e2e-toolset-owner', 'participant');
  await owner.goto('/toolsets');
  await owner.getByRole('link', { name: 'Declare a toolset' }).click();
  await expect(owner).toHaveURL(/\/toolsets\/new$/);

  await owner.locator('#ts-slug').fill(slug);
  await owner.locator('#ts-name').fill(name);
  await owner.locator('#ts-kind').selectOption('NOTEBOOK');
  await owner
    .locator('#ts-summary')
    .fill('Trains and scores a small baseline on the task, end to end, in one notebook.');
  await owner.locator('#ts-url').fill(ADDRESS);
  await owner.locator('#ts-licence').fill('Apache-2.0');
  await owner.locator('#ts-maintainer').fill('Example Imaging Lab');
  await owner.locator('#ts-datasetSlugs').fill(`${DATASET}, e2e-no-such-dataset`);
  await owner.locator('#ts-modelCardSlugs').fill(MODEL);
  await owner.getByRole('button', { name: 'Save as draft' }).click();

  // A dataset the catalogue does not show this person: said on its field, values kept.
  await expect(owner.getByText('The toolset was not saved')).toBeVisible();
  await expect(owner.locator('#ts-datasetSlugs-err')).toContainText('e2e-no-such-dataset');
  await expect(owner.locator('#ts-datasetSlugs-err')).not.toContainText(DATASET);
  await expect(owner.locator('#ts-name')).toHaveValue(name);
  await expect(owner.locator('#ts-licence')).toHaveValue('Apache-2.0');

  await owner.locator('#ts-datasetSlugs').fill(DATASET);
  await owner.getByRole('button', { name: 'Save as draft' }).click();
  await owner.waitForURL(new RegExp(`/toolsets/${slug}$`));

  // Its page: a draft, with what it works with, and no way for its declarer to publish.
  await expect(owner.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(owner.getByText('Draft', { exact: true })).toBeVisible();
  await expect(owner.locator(`a[href="/catalog/${DATASET}"]`)).toBeVisible();
  await expect(owner.locator(`a[href="/models/${MODEL}"]`)).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Publish' })).toHaveCount(0);

  // Edit the draft.
  await owner.getByRole('link', { name: 'Edit', exact: true }).click();
  await owner.waitForURL(new RegExp(`/toolsets/${slug}/edit$`));
  await expect(owner.locator('#ts-slug')).toHaveValue(slug);
  await expect(owner.locator('#ts-slug')).toHaveAttribute('readonly', '');
  await expect(owner.locator('#ts-datasetSlugs')).toHaveValue(DATASET);
  await owner.locator('#ts-version').fill('1.1.0');
  await owner.getByRole('button', { name: 'Save changes' }).click();
  await owner.waitForURL(new RegExp(`/toolsets/${slug}$`));
  await expect(owner.getByText('v1.1.0')).toBeVisible();

  // Listed under "Your toolsets", not in the public list.
  await owner.goto('/toolsets');
  const mine = owner.locator('section[aria-labelledby="toolsets-mine"]');
  await expect(mine.locator(`a[href="/toolsets/${slug}"]`)).toBeVisible();
  await expect(mine).toContainText('Draft');

  // -- A draft does not exist for anyone else.
  const anonCtx = await browser.newContext({ locale: 'en-GB' });
  const anon = await anonCtx.newPage();
  expect((await anon.goto(`/toolsets/${slug}`))?.status()).toBe(404);
  await anon.goto('/toolsets');
  await expect(anon.locator(`a[href="/toolsets/${slug}"]`)).toHaveCount(0);

  // -- An operator publishes it.
  const operatorCtx = await browser.newContext({ locale: 'en-GB' });
  const operator = await operatorCtx.newPage();
  await signInAs(operator, 'e2e-toolset-operator', 'admin');
  await operator.goto(`/toolsets/${slug}`);
  await expect(operator.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);
  await operator.getByRole('button', { name: 'Publish' }).click();
  await expect(operator.getByText('Published', { exact: true })).toBeVisible();
  await operatorCtx.close();

  // -- Anyone finds it and is led to where it lives.
  await anon.goto(`/toolsets?q=${stamp.toString(36)}&kind=NOTEBOOK`);
  await expect(anon.getByText('1 toolset matches')).toBeVisible();
  await anon.getByRole('link', { name }).click();
  await anon.waitForURL(new RegExp(`/toolsets/${slug}$`));
  const out = anon.getByRole('link', { name: /Open the toolset/ });
  await expect(out).toHaveAttribute('href', ADDRESS);
  await expect(out).toHaveAttribute('rel', 'noreferrer');
  await expect(anon.getByText('Listed by reference.')).toBeVisible();
  await expect(anon.getByText('Apache-2.0')).toBeVisible();
  // No status panel for a reader of a published toolset.
  await expect(anon.locator('#toolset-status')).toHaveCount(0);
  const jsonLd = await anon.locator('script[type="application/ld+json"]').first().textContent();
  expect(JSON.parse(jsonLd ?? '{}')).toMatchObject({
    '@type': 'SoftwareSourceCode',
    name,
    codeRepository: ADDRESS,
    license: 'Apache-2.0',
  });
  expect((await new AxeBuilder({ page: anon }).withTags(AXE_TAGS).analyze()).violations).toEqual(
    [],
  );
  await anon.goto('/toolsets?kind=SIMULATOR');
  await expect(anon.locator(`a[href="/toolsets/${slug}"]`)).toHaveCount(0);

  // -- Its declarer withdraws it: asked once, then gone from the public side.
  await owner.goto(`/toolsets/${slug}`);
  owner.once('dialog', (dialog) => void dialog.accept());
  await owner.getByRole('button', { name: 'Withdraw' }).click();
  await expect(owner.getByText('Withdrawn', { exact: true })).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
  expect((await anon.goto(`/toolsets/${slug}`))?.status()).toBe(404);

  await ownerCtx.close();
  await anonCtx.close();
});

test('the list and the form pass the accessibility checks, and read in French', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ locale: 'en-GB' });
  const page = await ctx.newPage();
  await page.goto('/models');
  await page.getByRole('link', { name: 'Toolsets' }).first().click();
  await expect(page).toHaveURL(/\/toolsets$/);
  expect((await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()).violations).toEqual([]);

  await signInAs(page, 'e2e-toolset-owner', 'participant');
  await page.goto('/toolsets/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Declare a toolset' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()).violations).toEqual([]);
  await ctx.close();

  const frCtx = await browser.newContext({ locale: 'fr-FR' });
  const fr = await frCtx.newPage();
  await fr.goto('/toolsets');
  await expect(fr.getByRole('heading', { level: 1, name: 'Outils' })).toBeVisible();
  await frCtx.close();
});

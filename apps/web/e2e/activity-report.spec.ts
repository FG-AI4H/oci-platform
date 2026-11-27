import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The activity report (#828): one calendar month of the deployment, for the
 * people who run or oversee it, on screen, on paper and as a JSON file.
 *
 * Pre-conditions: docker compose + API on :3000 + web on :3001. Needs no
 * seed: the report of an empty month is a report too.
 */

test.describe.configure({ timeout: 120_000 });
test.use({ locale: 'en-GB' });

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

/** `2026-11`, in UTC, for the month `back` months before now. */
function month(back: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

test('an operator reads a month, changes it, and downloads it', async ({ page }) => {
  await signInAs(page, 'e2e-report-admin', 'admin');
  await page.goto('/admin');
  await page.getByRole('link', { name: /Activity report/ }).click();
  await expect(page).toHaveURL(/\/admin\/reports$/);

  // Without a month: the last complete one, with its six sections.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Activity report,');
  await expect(page.locator('#report-month')).toHaveValue(month(1));
  for (const heading of [
    'Datasets',
    'Access requests',
    'Evaluation',
    'Models',
    'Annotation',
    'Audit trail',
  ]) {
    await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByText('This month is not over')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()).violations).toEqual([]);

  // The current month is offered, and said to be in progress.
  await page.locator('#report-month').selectOption(month(0));
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/reports\\?month=${month(0)}$`));
  await expect(page.getByText('This month is not over')).toBeVisible();
  await expect(page.getByText('Hash chain over the period')).toBeVisible();

  // The same report as a file.
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download as JSON' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`oci-activity-report-${month(0)}.json`);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const report = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  expect(report).toMatchObject({ v: 1, month: month(0), partial: true });
  expect(Object.keys(report)).toEqual(
    expect.arrayContaining([
      'datasets',
      'accessRequests',
      'evaluation',
      'models',
      'annotation',
      'audit',
    ]),
  );
});

test('on paper, only the report prints', async ({ page }) => {
  await signInAs(page, 'e2e-report-admin', 'admin');
  await page.goto(`/admin/reports?month=${month(1)}`);
  await page.emulateMedia({ media: 'print' });

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Audit trail' })).toBeVisible();
  // The month picker, the download link and the site's own header stay on the screen.
  await expect(page.locator('#report-month')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Download as JSON' })).toBeHidden();
  await expect(page.getByRole('banner')).toBeHidden();
});

test('a regulator may read it; a participant may not', async ({ browser }) => {
  const regulatorCtx = await browser.newContext({ locale: 'en-GB' });
  const regulator = await regulatorCtx.newPage();
  await signInAs(regulator, 'e2e-report-regulator', 'regulator');
  await regulator.goto('/admin/reports');
  await expect(regulator.getByRole('heading', { level: 2, name: 'Datasets' })).toBeVisible();
  await regulatorCtx.close();

  const participantCtx = await browser.newContext({ locale: 'en-GB' });
  const participant = await participantCtx.newPage();
  await signInAs(participant, 'e2e-report-participant', 'participant');
  await participant.goto('/admin/reports');
  await expect(participant).toHaveURL(/\/dashboard$/);
  const refused = await participant.request.get(`/admin/reports/export?month=${month(1)}`);
  expect(refused.status()).toBe(403);
  await participantCtx.close();
});

test('the report reads in French', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'fr-FR' });
  const page = await ctx.newPage();
  // The sign-in form is in French here: fill it by its field ids.
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.locator('#signin-user').fill('e2e-report-admin');
  await page.locator('#signin-roles').fill('admin');
  await page.locator('#signin-roles').press('Enter');
  await page.waitForURL(/\/dashboard/);
  await page.goto(`/admin/reports?month=${month(1)}`);

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Rapport d’activité,');
  await expect(page.getByRole('heading', { level: 2, name: 'Journal d’audit' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()).violations).toEqual([]);
  await ctx.close();
});

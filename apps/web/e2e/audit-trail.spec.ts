import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for the audit trail reader (#653): `/admin/audit` against the real
 * API and a real Postgres.
 *
 * An export is itself an audit event, so the spec makes its own events
 * by exporting; it needs nothing seeded.
 *
 * Pre-conditions: API with OCI_ENV=local, web with OCI_ENV=local,
 * migrated Postgres. Run with PW_NO_RESET=1.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

async function exportJson(page: Page): Promise<void> {
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download JSON' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^audit-events-\d{8}T\d{6}Z\.json$/);
}

test.describe('audit trail reader', () => {
  test('anonymous visitors and other roles are sent away', async ({ page }) => {
    await page.goto('/admin/audit');
    await expect(page).toHaveURL(/\/$/);
    await signInAs(page, 'bob', 'host');
    await page.goto('/admin/audit');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('admin: an export appears in the list, the chain verifies, the object has a timeline', async ({
    page,
  }) => {
    await signInAs(page, 'audit-admin', 'admin');
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit trail', level: 1 })).toBeVisible();

    await exportJson(page);
    await page.reload();

    const events = page.getByTestId('audit-event');
    await expect(events.first()).toContainText('audit.events.exported');
    // An admin sees the actor's user id, not a pseudonym.
    await expect(events.first()).not.toContainText('Pseudonym');

    await page.getByRole('button', { name: 'Verify chain' }).click();
    await expect(page.getByText(/^Intact: \d+ events? checked/)).toBeVisible();

    // Filter by event name.
    await page.getByRole('textbox', { name: 'Event', exact: true }).fill('audit.events.exported');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/action=audit.events.exported/);
    await expect(events.first()).toContainText('audit.events.exported');

    // Follow one object: its timeline.
    await events
      .first()
      .getByRole('link', { name: /^Timeline of audit-export / })
      .click();
    await expect(page.getByRole('heading', { name: /^Timeline of audit-export / })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Audit timeline' }).getByRole('listitem'),
    ).toHaveCount(1);

    const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });

  test('regulator: sees pseudonyms, can filter by one, and can verify', async ({ page }) => {
    await signInAs(page, 'audit-regulator', 'regulator');
    await page.goto('/admin/audit');
    await exportJson(page);
    await page.reload();

    const first = page.getByTestId('audit-event').first();
    await expect(first).toContainText('audit.events.exported');
    await expect(first).toContainText(/Pseudonym ps-[0-9a-f]{24}/);

    const text = (await first.textContent()) ?? '';
    const pseudonym = /ps-[0-9a-f]{24}/.exec(text)?.[0] ?? '';
    await page.getByRole('textbox', { name: 'Actor', exact: true }).fill(pseudonym);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    const shown = page.getByTestId('audit-event');
    await expect(shown.first()).toContainText(pseudonym);
    for (const row of await shown.all()) await expect(row).toContainText(pseudonym);

    // A real user id is refused as a filter for a regulator.
    await page
      .getByRole('textbox', { name: 'Actor', exact: true })
      .fill('6f1f7b0e-4a53-4c1e-9a8e-2b8f2b1f0c11');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByText('These filters cannot be used')).toBeVisible();

    await page.getByRole('button', { name: 'Verify chain' }).click();
    await expect(page.getByText(/^Intact: \d+ events? checked/)).toBeVisible();

    const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });
});

import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the Phase A admin user-management surface (#241).
 *
 * What this exercises end-to-end against the running local stack:
 *   - Auth gating: anonymous + non-admin are redirected away from
 *     `/admin/users`.
 *   - Admin sees the in-memory stub user list (alice, bob, cm, eve)
 *     surfaced by the API dev stub.
 *   - Admin can grant + revoke a group; the audit log surfaces the
 *     change on the detail page.
 *   - Admin cannot revoke their own `admin` group (server-side guard
 *     surfaces the error).
 *
 * Pre-conditions:
 *   - docker compose -f infra/local/docker-compose.yml up -d
 *   - pnpm --filter @oci/database db:migrate:deploy
 *   - pnpm --filter @oci/api dev       (API on :3000)
 *   - pnpm --filter @oci/web dev       (web on :3001)
 */

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

test.describe('admin user-management workflow', () => {
  test('anonymous visitor cannot reach /admin/users', async ({ page }) => {
    await page.goto('/admin/users');
    // requireAdmin redirects unauthenticated callers to `/`.
    await expect(page).toHaveURL(/\/$/);
  });

  test('host (non-admin) is redirected away from /admin/users', async ({ page }) => {
    await signInAs(page, 'bob', 'host');
    await page.goto('/admin/users');
    // requireAdmin redirects authenticated non-admins to /dashboard.
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('admin sees the user list and can search', async ({ page }) => {
    await signInAs(page, 'alice', 'admin');

    // Header admin link visible.
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'Admin', exact: true })).toBeVisible();

    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();

    // Stub-seeded users show up.
    await expect(page.getByRole('link', { name: 'alice' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'bob' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'cm' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'eve' })).toBeVisible();

    // Filter by prefix.
    await page.getByLabel('Search users').fill('bo');
    await page.getByLabel('Search users').press('Enter');
    await expect(page.getByRole('link', { name: 'bob' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'eve' })).toHaveCount(0);
  });

  test('admin can grant a group and the audit trail records it', async ({ page }) => {
    await signInAs(page, 'alice', 'admin');
    await page.goto('/admin/users/eve');
    await expect(page.getByRole('heading', { name: 'eve' })).toBeVisible();

    // Toggle the "campaign-manager" checkbox and apply.
    const row = page.locator('form', { hasText: 'campaign-manager' });
    const checkbox = row.getByRole('checkbox', { name: 'Toggle campaign-manager' });
    await checkbox.check();
    await row.getByRole('button', { name: /apply/i }).click();

    // Success alert appears.
    await expect(page.getByText(/granted campaign-manager/i)).toBeVisible();

    // Audit trail shows the grant. The audit list is rendered as a
    // `<li>` per event; assert at the `li` level — the locator-on-
    // heading approach traps you inside the CardHeader, not the
    // CardContent.
    const auditRow = page
      .locator('li')
      .filter({ hasText: 'campaign-manager' })
      .filter({ hasText: 'grant' });
    await expect(auditRow.first()).toBeVisible();

    // Cleanup — revoke so subsequent runs start from the same state.
    await checkbox.uncheck();
    await row.getByRole('button', { name: /apply/i }).click();
    await expect(page.getByText(/revoked campaign-manager/i)).toBeVisible();
  });

  test('admin cannot revoke their own admin group', async ({ page }) => {
    await signInAs(page, 'alice', 'admin');
    await page.goto('/admin/users/alice');

    const row = page.locator('form', { hasText: 'admin', has: page.getByRole('checkbox') }).first();
    const checkbox = row.getByRole('checkbox', { name: 'Toggle admin' });
    // Checkbox should be disabled (UI-level guard).
    await expect(checkbox).toBeDisabled();
    // Hint text spelling out why.
    await expect(page.getByText(/cannot revoke your own admin group/i).first()).toBeVisible();
  });
});

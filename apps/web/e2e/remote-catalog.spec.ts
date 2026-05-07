import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the admin-only remote-catalog management module
 * shipped in PR E.1. Walks the full lifecycle (sign in as admin →
 * register a peer → see it on the list → open detail → deregister)
 * against the running stack.
 *
 * Pre-conditions match host-workflow.spec.ts: docker compose + API +
 * web on :3000 / :3001. The slug uses Date.now() so re-runs don't
 * trip over the unique-slug constraint.
 */

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/api/auth/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles', { exact: false }).fill(roles);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

test.describe('remote catalog admin', () => {
  test('host sees no "Remotes" header link', async ({ page }) => {
    await signInAs(page, 'bob', 'host');
    await expect(page.getByRole('link', { name: 'Remotes' })).toHaveCount(0);
  });

  test('host hitting /catalog/remotes is redirected away', async ({ page }) => {
    await signInAs(page, 'bob', 'host');
    await page.goto('/catalog/remotes');
    // requireAdmin redirects host → /dashboard.
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('admin: register + list + detail + deregister', async ({ page }) => {
    const slug = `peer-${Date.now()}`;
    await signInAs(page, 'admin', 'admin');

    // Header shows the admin nav
    const remotesLink = page.getByRole('link', { name: 'Remotes' });
    await expect(remotesLink).toBeVisible();
    await remotesLink.click();
    await expect(page).toHaveURL(/\/catalog\/remotes$/);

    // -- Empty state for a fresh dev DB OR existing list with our slug
    //    not present yet. Click through to the form.
    await page.getByRole('link', { name: 'Register peer' }).first().click();
    await expect(page).toHaveURL(/\/catalog\/remotes\/new$/);

    // -- Fill + submit
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill(`Peer ${slug}`);
    await page.getByLabel('Endpoint URL').fill(`https://${slug}.example.org/v2/catalog`);
    await page
      .getByLabel('Description')
      .fill('E2E peer registration. Auto-deregistered at end of test.');
    await page.getByRole('button', { name: /register peer/i }).click();
    await expect(page).toHaveURL(/\/catalog\/remotes\/[0-9a-f-]{36}$/);

    // -- Detail page reflects what we submitted
    await expect(page.getByRole('heading', { name: `Peer ${slug}` })).toBeVisible();
    await expect(page.getByText(slug, { exact: true })).toBeVisible();
    await expect(page.getByText(/idle/i).first()).toBeVisible();
    await expect(page.getByText('Never').first()).toBeVisible();

    // -- List shows it
    await page.goto('/catalog/remotes');
    await expect(page.getByRole('link', { name: `Peer ${slug}` })).toBeVisible();

    // -- Deregister via the detail page
    await page.getByRole('link', { name: `Peer ${slug}` }).click();
    await page.getByRole('button', { name: /deregister peer/i }).click();
    await expect(page).toHaveURL(/\/catalog\/remotes$/);
    await expect(page.getByRole('link', { name: `Peer ${slug}` })).toHaveCount(0);
  });

  test('admin: slug conflict surfaces inline', async ({ page }) => {
    const slug = `peer-conflict-${Date.now()}`;
    await signInAs(page, 'admin', 'admin');

    await page.goto('/catalog/remotes/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill('First');
    await page.getByLabel('Endpoint URL').fill(`https://${slug}.example.org/v2/catalog`);
    await page.getByRole('button', { name: /register peer/i }).click();
    await expect(page).toHaveURL(/\/catalog\/remotes\/[0-9a-f-]{36}$/);

    await page.goto('/catalog/remotes/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill('Duplicate');
    await page.getByLabel('Endpoint URL').fill(`https://${slug}-dup.example.org/v2/catalog`);
    await page.getByRole('button', { name: /register peer/i }).click();
    await expect(page.getByText(/already taken/i)).toBeVisible();
  });
});

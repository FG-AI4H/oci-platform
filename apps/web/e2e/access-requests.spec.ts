import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the access-request lifecycle shipped in PR F (#75).
 *
 * Covers requester + host halves end-to-end against the running stack:
 *   1. Host signs in, creates a RESTRICTED dataset, publishes IDRiD.
 *   2. Requester signs in, hits the dataset detail, clicks the
 *      "Request access" CTA, fills the form, submits.
 *   3. Requester sees the request on /dashboard/access-requests as
 *      PENDING.
 *   4. Host signs back in, opens /dashboard/host/access-requests,
 *      sees the row, approves it with a note.
 *   5. Requester reloads /dashboard/access-requests, sees the row
 *      flipped to APPROVED with the host's note visible.
 *
 * Pre-conditions: docker compose + API on :3000 + web on :3001 (same
 * as the rest of the suite).
 */

const FIXTURE = resolvePath(process.cwd(), '../api/scripts/fixtures/idrid.croissant.json');

// UUID-shaped subs short-circuit the UUIDv5 derivation, so requester
// vs host identities are clean and stable across this spec's actions.
const HOST = '00000000-0000-4f00-8000-000000000f01';
const REQUESTER = '00000000-0000-4f00-8000-000000000f02';

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

async function signOut(page: Page) {
  // The header's sign-out button is a small server-action form with
  // a "Sign out" label.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe('access requests lifecycle', () => {
  // Shared dataset slug across the whole flow — requester references
  // it by URL, host approves the same row from the inbox.
  const stamp = Date.now();
  const datasetSlug = `restricted-${stamp}`;

  test('requester submits, host approves; requester sees APPROVED', async ({ page }) => {
    // -- Host creates a RESTRICTED dataset with an IDRiD manifest.
    await signInAs(page, HOST, 'host');
    await page.goto('/catalog/new');
    await page.getByLabel('Slug').fill(datasetSlug);
    await page.getByLabel('Name').fill(`Restricted ${stamp}`);
    await page.getByRole('radio', { name: 'Restricted' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${datasetSlug}/publish$`));
    await page.getByLabel('Croissant manifest').fill(readFileSync(FIXTURE, 'utf8'));
    await page.getByRole('button', { name: /validate.*publish/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${datasetSlug}$`));
    await signOut(page);

    // -- Requester signs in and submits.
    await signInAs(page, REQUESTER, 'participant');
    await page.goto(`/catalog/${datasetSlug}`);
    await page.getByRole('link', { name: 'Request access' }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${datasetSlug}/request-access$`));

    await page
      .getByLabel('Why do you need access?')
      .fill(
        'Replicating an analysis published in 10.1234/example for thesis work — comparing diabetic-retinopathy detection models on the IDRiD set against our own data.',
      );
    // The IRB checkbox is a checkbox without an explicit `getByLabel`-friendly
    // wrapping; click it via its accessible label.
    await page.locator('input[name="irbApproved"]').check();
    await page.getByLabel('IRB approval reference').fill('IRB-2026-042');
    await page.getByRole('button', { name: /submit request/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/access-requests$/);

    // -- Requester sees their PENDING row.
    await expect(page.getByText(`Restricted ${stamp}`)).toBeVisible();
    const pendingRow = page.getByText('pending').first();
    await expect(pendingRow).toBeVisible();
    await signOut(page);

    // -- Host reviews + approves.
    await signInAs(page, HOST, 'host');
    await page.goto('/dashboard/host/access-requests');
    // The row's visible markers: requester id (UUID-shaped) + the
    // dataset name. Use the dataset name as the disambiguating
    // anchor since the requester id appears in many rows in dev.
    const inboxRow = page.locator('article, li').filter({ hasText: `Restricted ${stamp}` });
    await expect(inboxRow.first()).toBeVisible();

    // Decision form: write a note and click Approve.
    await inboxRow
      .first()
      .getByLabel('Decision note')
      .fill('Approved for thesis comparison; standard data-use rules apply.');
    await inboxRow.first().getByRole('button', { name: 'Approve' }).click();

    // After revalidatePath the row should re-render with status=APPROVED.
    await expect(inboxRow.first().getByText('approved').first()).toBeVisible();
    await signOut(page);

    // -- Requester sees APPROVED + the host's note.
    await signInAs(page, REQUESTER, 'participant');
    await page.goto('/dashboard/access-requests');
    await expect(page.getByText('approved').first()).toBeVisible();
    await expect(page.getByText('Approved for thesis comparison')).toBeVisible();
  });
});

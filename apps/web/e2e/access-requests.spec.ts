import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the access-request lifecycle:
 *   - PR F (#75): create + approve + visibility flip in the requester
 *     dashboard.
 *   - PR J.1 (#93): structured intended-use form, DUO permission terms
 *     on the dataset, auto-match badge in the host inbox, fail-closed
 *     publish for non-PUBLIC manifests without consentCode.
 *
 * What this spec asserts end-to-end:
 *   1. Host creates a RESTRICTED dataset and publishes IDRiD with
 *      `consentCode` injected (GRU + IRB). Without consentCode the
 *      publish would 400 (J.1 fail-closed).
 *   2. Requester signs in, opens the request-access page, sees the
 *      dataset's DUO terms inline.
 *   3. Requester fills the structured form (project title +
 *      description + institution + intended-use category + DUO terms
 *      + IRB ref + retention + redistribution + output type) and
 *      submits. Lands on the dashboard with the request as PENDING.
 *   4. Host opens the inbox, sees the row with the auto-match badge
 *      (MATCHED for non-commercial + IRB-approved against GRU+IRB).
 *   5. Host approves with a note. Requester sees APPROVED + the note.
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
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Reads the IDRiD fixture and injects DUO consent codes — the
 * publish-time fail-closed rejects non-PUBLIC manifests without
 * consentCode (J.1 decision #2).
 */
function manifestWithConsent(duoIds: string[]): string {
  const manifest = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  manifest.consentCode = duoIds.map((id) => ({
    '@type': 'sc:DefinedTerm',
    '@id': `http://purl.obolibrary.org/obo/${id}`,
    termCode: id,
  }));
  return JSON.stringify(manifest);
}

test.describe('access requests lifecycle (PR F + PR J.1)', () => {
  const stamp = Date.now();
  const datasetSlug = `restricted-${stamp}`;

  test('matched: requester submits structured form, auto-match flags MATCHED, host approves', async ({
    page,
  }) => {
    // -- Host creates a RESTRICTED dataset with IDRiD + GRU + IRB.
    await signInAs(page, HOST, 'host');
    await page.goto('/catalog/new');
    await page.getByLabel('Slug').fill(datasetSlug);
    await page.getByLabel('Name').fill(`Restricted ${stamp}`);
    await page.getByRole('radio', { name: 'Restricted' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${datasetSlug}/publish$`));
    // Switch to the paste form (PR K wizard is the default).
    await page.getByRole('tab', { name: 'I already have a manifest' }).click();
    await page
      .getByLabel('Croissant manifest')
      .fill(manifestWithConsent(['DUO_0000042', 'DUO_0000021']));
    await page.getByRole('button', { name: /validate.*publish/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${datasetSlug}$`));

    // The detail page should now render the DUO permission terms
    // under "Permitted use (DUO)".
    await expect(page.getByText('General research use', { exact: false })).toBeVisible();
    await expect(page.getByText('Ethics approval required', { exact: false })).toBeVisible();
    await signOut(page);

    // -- Requester signs in and submits the structured form.
    await signInAs(page, REQUESTER, 'participant');
    await page.goto(`/catalog/${datasetSlug}`);
    await page.getByRole('link', { name: 'Request access' }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${datasetSlug}/request-access$`));

    // Form sees the dataset's DUO terms inline above the fields.
    await expect(page.getByText("This dataset's permitted uses")).toBeVisible();

    await page.getByLabel('Project title').fill(`Replication study ${stamp}`);
    await page
      .getByLabel('Project description')
      .fill(
        'Replicating the published IDRiD diabetic-retinopathy detection benchmark, comparing models on the segmentation sub-set, in a non-commercial setting.',
      );
    await page.locator('#field-institution').fill('University of Geneva');
    await page.getByRole('radio', { name: /^Non-commercial research/i }).check();
    // GRU = DUO_0000042; selected via the requester's DUO multi-select.
    await page.getByLabel(/General research use/i).check();
    await page.locator('input[name="irbApproved"]').check();
    await page.getByLabel('IRB approval reference').fill('IRB-2026-042');
    await page.getByLabel('Data retention (days)').fill('365');
    await page.getByLabel('Redistribution intent').selectOption('NONE');
    await page.getByLabel('Output type').selectOption('PUBLICATION');
    await page.getByRole('button', { name: /submit request/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/access-requests$/);

    // Requester sees PENDING row.
    await expect(page.getByText(`Restricted ${stamp}`)).toBeVisible();
    await expect(page.getByText('pending').first()).toBeVisible();
    await signOut(page);

    // -- Host reviews. Inbox shows the auto-match badge.
    await signInAs(page, HOST, 'host');
    await page.goto('/dashboard/host/access-requests');
    const inboxRow = page.locator('article, li').filter({ hasText: `Replication study ${stamp}` });
    await expect(inboxRow.first()).toBeVisible();
    // Auto-match badge — MATCHED because non-commercial + IRB-approved
    // against a GRU + IRB-required dataset.
    await expect(inboxRow.first().getByText(/auto-match: matched/i)).toBeVisible();
    // Structured fields visible inline.
    await expect(inboxRow.first().getByText('Non-commercial research')).toBeVisible();
    await expect(inboxRow.first().getByText('University of Geneva')).toBeVisible();

    // Approve with a note.
    await inboxRow
      .first()
      .getByLabel('Decision note')
      .fill('Approved for thesis comparison; standard data-use rules apply.');
    await inboxRow.first().getByRole('button', { name: 'Approve' }).click();
    await expect(inboxRow.first().getByText('approved').first()).toBeVisible();
    await signOut(page);

    // -- Requester sees APPROVED.
    await signInAs(page, REQUESTER, 'participant');
    await page.goto('/dashboard/access-requests');
    await expect(page.getByText('approved').first()).toBeVisible();
    await expect(page.getByText('Approved for thesis comparison')).toBeVisible();
  });

  test('publish-time fail-closed: RESTRICTED without consentCode is rejected', async ({ page }) => {
    const slug = `restricted-noduo-${Date.now()}`;
    await signInAs(page, HOST, 'host');
    await page.goto('/catalog/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill(`Restricted no-DUO ${slug}`);
    await page.getByRole('radio', { name: 'Restricted' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}/publish$`));

    // Switch to the paste form (PR K wizard is the default).
    await page.getByRole('tab', { name: 'I already have a manifest' }).click();
    // IDRiD without consentCode — should be rejected at publish.
    await page.getByLabel('Croissant manifest').fill(readFileSync(FIXTURE, 'utf8'));
    await page.getByRole('button', { name: /validate.*publish/i }).click();
    // Stays on the publish page with the validation error surfaced.
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}/publish$`));
    await expect(page.getByText(/DUO consent code/i).first()).toBeVisible();
  });

  test('conflict: commercial intent on a NCU dataset → CONFLICT badge', async ({ page }) => {
    const slug = `restricted-ncu-${Date.now()}`;
    await signInAs(page, HOST, 'host');
    await page.goto('/catalog/new');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name').fill(`Restricted NCU ${slug}`);
    await page.getByRole('radio', { name: 'Restricted' }).check();
    await page.getByRole('button', { name: /create draft/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}/publish$`));
    // Switch to the paste form (PR K wizard is the default).
    await page.getByRole('tab', { name: 'I already have a manifest' }).click();
    await page
      .getByLabel('Croissant manifest')
      // GRU + NCU = research use, no commercial.
      .fill(manifestWithConsent(['DUO_0000042', 'DUO_0000046']));
    await page.getByRole('button', { name: /validate.*publish/i }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${slug}$`));
    await signOut(page);

    await signInAs(page, REQUESTER, 'participant');
    await page.goto(`/catalog/${slug}/request-access`);
    await page.getByLabel('Project title').fill(`Commercial pilot ${slug}`);
    await page
      .getByLabel('Project description')
      .fill(
        'Pilot to evaluate IDRiD as a candidate training set for our commercial diabetic-retinopathy screening product. Output: model weights for productisation.',
      );
    await page.locator('#field-institution').fill('Acme Health Inc.');
    await page.getByRole('radio', { name: /^Commercial research/i }).check();
    await page.getByLabel(/General research use/i).check();
    await page.locator('input[name="irbApproved"]').check();
    await page.getByLabel('Data retention (days)').fill('730');
    await page.getByLabel('Redistribution intent').selectOption('DERIVATIVES_ONLY');
    await page.getByLabel('Output type').selectOption('MODEL_WEIGHTS');
    await page.getByRole('button', { name: /submit request/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/access-requests$/);
    await signOut(page);

    // Host inbox: this row shows CONFLICT.
    await signInAs(page, HOST, 'host');
    await page.goto('/dashboard/host/access-requests');
    const inboxRow = page.locator('article, li').filter({ hasText: `Commercial pilot ${slug}` });
    await expect(inboxRow.first()).toBeVisible();
    await expect(inboxRow.first().getByText(/auto-match: conflict/i)).toBeVisible();
    await expect(inboxRow.first().getByText(/commercial use prohibited/i)).toBeVisible();
  });
});

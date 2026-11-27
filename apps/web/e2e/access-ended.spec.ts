import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * An approval ends on its end date (#819): the dataset page and the
 * requester's list say that access has ended and how to ask again, and the
 * API refuses the files, with no scheduled job involved.
 *
 * The end date is a year after approval, so the spec moves it into the past
 * directly in the database. `PW_PG_DATABASE` and `PW_PG_USER` name the
 * database of the stack under test; they default to the local compose stack.
 *
 * Pre-conditions: docker compose + API on :3000 + web on :3001.
 */

test.describe.configure({ timeout: 120_000 });
test.use({ locale: 'en-GB' });

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FIXTURE = resolvePath(process.cwd(), '../api/scripts/fixtures/idrid.croissant.json');
const HOST = '00000000-0000-4f00-8000-000000000f11';
const REQUESTER = '00000000-0000-4f00-8000-000000000f12';

/** `slug` is a run-local literal (`restricted-<timestamp>`), not user input. */
function endAccessYesterday(slug: string): void {
  if (!/^restricted-\d+$/.test(slug)) throw new Error(`unexpected slug ${slug}`);
  const sql = `
    UPDATE catalog.access_requests SET expires_at = now() - interval '1 day'
    WHERE status = 'APPROVED'
      AND dataset_id = (SELECT id FROM catalog.datasets WHERE slug = '${slug}');`;
  execFileSync(
    'docker',
    [
      'exec',
      'oci-postgres',
      'psql',
      '-U',
      process.env.PW_PG_USER ?? 'oci',
      '-d',
      process.env.PW_PG_DATABASE ?? 'oci_dev',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

function manifestWithConsent(): string {
  const manifest = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  manifest.consentCode = ['DUO_0000042', 'DUO_0000021'].map((id) => ({
    '@type': 'sc:DefinedTerm',
    '@id': `http://purl.obolibrary.org/obo/${id}`,
    termCode: id,
  }));
  return JSON.stringify(manifest);
}

test('an approval past its end date reads as ended, and the files are refused', async ({
  browser,
  request,
}) => {
  const stamp = Date.now();
  const slug = `restricted-${stamp}`;

  const hostCtx = await browser.newContext({ locale: 'en-GB' });
  const host = await hostCtx.newPage();
  await signInAs(host, HOST, 'host');
  await host.goto('/catalog/new');
  await host.getByLabel('Slug').fill(slug);
  await host.getByLabel('Name').fill(`Restricted ${stamp}`);
  await host.getByRole('radio', { name: 'Restricted' }).check();
  await host.getByRole('button', { name: /create draft/i }).click();
  await expect(host).toHaveURL(new RegExp(`/catalog/${slug}/publish$`));
  await host.getByRole('tab', { name: 'I already have a manifest' }).click();
  await host.getByLabel('Croissant manifest').fill(manifestWithConsent());
  await host.getByRole('button', { name: /validate.*publish/i }).click();
  await expect(host).toHaveURL(new RegExp(`/catalog/${slug}$`));

  const requesterCtx = await browser.newContext({ locale: 'en-GB' });
  const requester = await requesterCtx.newPage();
  await signInAs(requester, REQUESTER, 'participant');
  await requester.goto(`/catalog/${slug}/request-access`);
  await requester.getByLabel('Project title').fill(`Study ${stamp}`);
  await requester
    .getByLabel('Project description')
    .fill('Replicating a published grading benchmark in a non-commercial research setting.');
  await requester.locator('#field-institution').fill('University of Geneva');
  await requester.getByRole('radio', { name: /^Non-commercial research/i }).check();
  await requester.getByLabel(/General research use/i).check();
  await requester.locator('input[name="irbApproved"]').check();
  await requester.getByLabel('IRB approval reference').fill('IRB-2026-819');
  await requester.getByLabel('Data retention (days)').fill('365');
  await requester.getByLabel('Redistribution intent').selectOption('NONE');
  await requester.getByLabel('Output type').selectOption('PUBLICATION');
  await requester.getByRole('button', { name: /submit request/i }).click();
  await expect(requester).toHaveURL(new RegExp(`/catalog/${slug}\\?requested=1$`));

  await host.goto('/dashboard/host/access-requests');
  const inboxRow = host
    .locator('article, li')
    .filter({ hasText: `Study ${stamp}` })
    .first();
  await inboxRow.getByRole('button', { name: 'Approve' }).click();
  await expect(inboxRow.getByText('approved').first()).toBeVisible();
  await hostCtx.close();

  // Approved: the page says until when, and the API lets the request through
  // the access check (it may then find nothing to archive, which is not a 403).
  // The local stack's stand-in for a token: the same person as in the browser.
  const asRequester = { Authorization: `Bearer dev:${REQUESTER}:participant` };
  const bulk = `${API}/v2/catalog/datasets/${slug}/download`;
  await requester.goto(`/catalog/${slug}`);
  await expect(requester.getByText('approved', { exact: true })).toBeVisible();
  await expect(requester.getByText(/Your access ends on \d{1,2} \w+ \d{4}/)).toBeVisible();
  expect((await request.get(bulk, { headers: asRequester })).status()).not.toBe(403);

  endAccessYesterday(slug);

  // Ended: no job has run, the status in the database is still APPROVED.
  await requester.goto(`/catalog/${slug}`);
  await expect(requester.getByText('ended', { exact: true })).toBeVisible();
  await expect(requester.getByText('approved', { exact: true })).toHaveCount(0);
  await expect(requester.getByText(/Your access ended on \d{1,2} \w+ \d{4}/)).toBeVisible();
  await expect(requester.getByRole('link', { name: 'File a new request' })).toHaveAttribute(
    'href',
    `/catalog/${slug}/request-access`,
  );

  expect(
    (await new AxeBuilder({ page: requester }).withTags(AXE_TAGS).analyze()).violations,
  ).toEqual([]);

  const refused = await request.get(bulk, { headers: asRequester });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toMatchObject({ reason: 'ACCESS_ENDED' });

  await requester.goto('/dashboard/access-requests');
  const mine = requester.locator('li').filter({ hasText: `Restricted ${stamp}` });
  await expect(mine.getByText('ended', { exact: true })).toBeVisible();
  await expect(mine.getByText(/Access ended on/)).toBeVisible();
  expect(
    (await new AxeBuilder({ page: requester }).withTags(AXE_TAGS).analyze()).violations,
  ).toEqual([]);
  await requesterCtx.close();
});

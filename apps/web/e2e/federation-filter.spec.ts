import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the federation filter shipped in PR E.2.
 *
 * Walks the read-path against the running stack: an admin registers a
 * peer and seeds a RemoteDataset row by hitting the catalog API
 * directly (no UI for that — PR E.3's worker is the canonical writer);
 * the catalog list then surfaces the row under `?source=federated`
 * and `?source=all`, hides it under the default `?source=local`, and
 * the federated card opens its `originUrl` in a new tab.
 *
 * The federated row is inserted via a small SQL POST helper because
 * RemoteDataset has no public write endpoint. We use the dev-mode
 * admin sentinel for any auth that's needed.
 *
 * Pre-conditions: docker compose + API on :3000 + web on :3001 (same
 * as the host-workflow + remote-catalog suites).
 */

const ADMIN_TOKEN = 'dev:00000000-0000-0000-0000-0000000000a1:admin';

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/api/auth/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles', { exact: false }).fill(roles);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

interface RegisteredPeer {
  id: string;
  slug: string;
}

async function registerPeer(slug: string): Promise<RegisteredPeer> {
  const res = await fetch('http://localhost:3000/v2/catalog/remotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({
      slug,
      name: `Peer ${slug}`,
      endpointUrl: `https://${slug}.example.org/v2/catalog`,
    }),
  });
  if (res.status !== 201) throw new Error(`peer register failed: ${res.status}`);
  const body = (await res.json()) as { id: string; slug: string };
  return body;
}

async function deregisterPeer(id: string): Promise<void> {
  await fetch(`http://localhost:3000/v2/catalog/remotes/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
}

/**
 * RemoteDataset has no public POST endpoint; we exec a one-shot SQL
 * insert via docker so the test reads against a real row. The DELETE
 * cascades from the parent peer's deregister, so we don't need to
 * clean these up ourselves.
 */
async function seedFederatedRow(args: {
  peerId: string;
  slug: string;
  name: string;
  description: string;
  originUrl: string;
}): Promise<void> {
  const id = randomUUID();
  // Quote-escape paranoia: we only call this with test-controlled args.
  const sql = `INSERT INTO catalog.remote_datasets (id, source_catalog_id, origin_url, slug, name, description, conformance_version, version, croissant, harvested_at, created_at, updated_at) VALUES ('${id}', '${args.peerId}', '${args.originUrl}', '${args.slug}', '${args.name.replace(/'/g, "''")}', '${args.description.replace(/'/g, "''")}', '1.1', '1.0.0', '{"@type":"sc:Dataset"}'::jsonb, NOW(), NOW(), NOW());`;
  const proc = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    proc.execFile(
      'docker',
      ['exec', 'oci-postgres', 'psql', '-U', 'oci', '-d', 'oci_dev', '-c', sql],
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

test.describe('catalog federation filter', () => {
  let peer: RegisteredPeer | null = null;
  const stamp = Date.now();
  const peerSlug = `fedtest-${stamp}`;
  const fedSlug = `fed-row-${stamp}`;
  const fedName = `Federated row ${stamp}`;
  const originUrl = `https://${peerSlug}.example.org/datasets/${fedSlug}`;

  test.beforeAll(async () => {
    peer = await registerPeer(peerSlug);
    await seedFederatedRow({
      peerId: peer.id,
      slug: fedSlug,
      name: fedName,
      description: 'Inserted by Playwright to test the federation filter.',
      originUrl,
    });
  });

  test.afterAll(async () => {
    if (peer) await deregisterPeer(peer.id);
  });

  test('default local view hides federated rows', async ({ page }) => {
    await signInAs(page, 'browser', 'participant');
    await page.goto('/catalog');
    // The row's name is unique-by-stamp, so a global text search is
    // a reliable absence assertion regardless of how many local rows
    // are present.
    await expect(page.getByText(fedName, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Local', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('Federated chip surfaces the row with peer attribution', async ({ page }) => {
    await signInAs(page, 'browser', 'participant');
    await page.goto('/catalog?source=federated');
    await expect(page.getByRole('link', { name: 'Federated', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // The card link's accessible name is the full aria-label
    // ("<name> — opens upstream on <peer> in a new tab"); finding it
    // by visible text + walking to the enclosing anchor is more
    // robust than matching the synthesised name with a regex.
    const titleNode = page.getByText(fedName, { exact: true }).first();
    await expect(titleNode).toBeVisible();
    const card = page.locator('a', { has: titleNode });
    await expect(card).toHaveAttribute('target', '_blank');
    await expect(card).toHaveAttribute('href', originUrl);

    // Peer attribution badge + federation tag
    await expect(page.getByText(`from Peer ${peerSlug}`).first()).toBeVisible();
    await expect(page.getByText('federated', { exact: true }).first()).toBeVisible();
  });

  test('All chip merges local + federated', async ({ page }) => {
    await signInAs(page, 'browser', 'participant');
    await page.goto('/catalog?source=all');
    await expect(page.getByRole('link', { name: 'All', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByText(fedName, { exact: true })).toBeVisible();
  });
});

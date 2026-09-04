import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for the OCI-curated demo dataset as the access-governance demo
 * (#492). The seed publishes `oci-demo-chest-xr` as RESTRICTED at the
 * REGISTERED identity tier, non-commercial only, with DUO terms
 * DUO_0000007 (disease specific research) + DUO_0000046
 * (non-commercial use only), so that on dev:
 *
 *   anonymous viewer → /catalog/oci-demo-chest-xr → not found
 *     (RESTRICTED rows are only listed for authenticated callers)
 *   signed-in participant → detail page shows the "restricted" badge,
 *     the tier badge, the two DUO terms and the "Request access" CTA
 *     → /catalog/oci-demo-chest-xr/request-access renders the
 *     structured intended-use form
 *
 * The anonymous hosted-download path that used to live in this file
 * now runs against `idrid-grading-demo` — see
 * `idrid-hosted-download.spec.ts`.
 *
 * Pre-conditions (same as the rest of the suite):
 *   - docker compose -f infra/local/docker-compose.yml up -d
 *   - pnpm --filter @oci/database db:migrate:deploy
 *   - pnpm --filter @oci/database db:seed:demo
 *   - pnpm --filter @oci/api dev    (API on :3000)
 *   - pnpm --filter @oci/web dev    (web on :3001)
 *
 * The spec only reads; it files no access request, so it leaves no
 * rows behind and stays repeatable against a shared dev database.
 */

const SLUG = 'oci-demo-chest-xr';

// UUID-shaped sub short-circuits the UUIDv5 derivation; distinct from
// the seed's host id so the CTA is not hidden as "own dataset".
const PARTICIPANT = '00000000-0000-4f00-8000-000000000492';

async function signInAs(page: Page, user: string, roles: string) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(user);
  await page.getByLabel('Roles').fill(roles);
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

test.describe('OCI demo dataset — gated for the access-governance demo', () => {
  test('anonymous: the RESTRICTED dataset is not served', async ({ page }) => {
    const res = await page.goto(`/catalog/${SLUG}`);
    expect(res?.status()).toBe(404);
  });

  test('participant: detail page shows the gate and the DUO terms', async ({ page }) => {
    await signInAs(page, PARTICIPANT, 'participant');
    await page.goto(`/catalog/${SLUG}`);
    await expect(
      page.getByRole('heading', { name: /OCI Demo: Synthetic Chest XR/i }),
    ).toBeVisible();

    // Visibility + identity-tier badges in the hero.
    await expect(page.getByText('restricted', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Registered', { exact: true }).first()).toBeVisible();

    // The denormalised duo_terms drive the "Permitted use (DUO)" block.
    await expect(page.getByText(/Disease specific research/i).first()).toBeVisible();
    await expect(page.getByText(/Non-commercial use only/i).first()).toBeVisible();

    // Gated → the primary CTA is "Request access", linking to the form.
    const cta = page.getByRole('link', { name: 'Request access' });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', `/catalog/${SLUG}/request-access`);
  });

  test('participant: the request-access page renders the intended-use form', async ({ page }) => {
    await signInAs(page, PARTICIPANT, 'participant');
    await page.goto(`/catalog/${SLUG}/request-access`);
    await expect(page.getByRole('heading', { name: 'Request access' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Request details' })).toBeVisible();
  });
});

import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Public model catalogue (#591, Y.3176 Discover), end-to-end against the
 * real API.
 *
 * Setup inserts one PUBLISHED and one DRAFT card straight into Postgres
 * (`docker exec`, like `global-setup`), because the submit endpoint can't
 * currently write its audit row locally. Every read under test goes through
 * the real API and web. Both cards carry a per-run token in their clinical
 * summary so searches only ever hit this run's rows. Then, signed out:
 *
 *   1. /models lists and searches the published card; the draft never shows.
 *   2. The model-class and jurisdiction facets narrow the list.
 *   3. Opening the card shows its fields, the Model Facts label and JSON-LD.
 *   4. The draft's slug 404s.
 *   5. axe-core on both pages: no violations.
 *
 * Pre-conditions: docker compose + API on :3000 + web on :3001.
 * `global-setup` removes `e2e-model-*` rows between runs.
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const stamp = Date.now();
const token = `zx${stamp.toString(36)}`;
const publishedSlug = `e2e-model-pub-${stamp}`;
const draftSlug = `e2e-model-draft-${stamp}`;

const IUS = JSON.stringify({
  v: 1,
  medicalPurpose: 'triage',
  bodySystemOrSite: 'Chest',
  intendedUserRole: ['radiologist'],
  foreseeableMisuse: 'Treating the triage flag as a diagnosis.',
  contraindications: 'Not validated on paediatric films.',
  riskTier: 'II',
});

/** Values are run-local literals (slug, token, fixed JSON) — no user input. */
function insertCard(slug: string, status: 'PUBLISHED' | 'DRAFT', summary: string): void {
  const sql = `
    INSERT INTO prediction.model_cards
      (id, slug, intended_use, model_class, architecture_summary, version_major_minor_patch,
       training_data_jurisdictions, status, model_developer, developer_contact,
       clinical_summary, updated_at)
    VALUES
      (gen_random_uuid(), '${slug}', '${IUS}'::jsonb, 'agent',
       'Tool-using agent over a chest X-ray classifier.', '1.0.0', ARRAY['NZ'], '${status}',
       'E2E Models Ltd', 'e2e@models.example', '${summary}', now());`;
  execFileSync(
    'docker',
    [
      'exec',
      'oci-postgres',
      'psql',
      '-U',
      'oci',
      '-d',
      'oci_dev',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
}

test.describe('public model catalogue (#591)', () => {
  test.beforeAll(() => {
    insertCard(publishedSlug, 'PUBLISHED', `Published triage agent ${token}.`);
    insertCard(draftSlug, 'DRAFT', `Draft triage agent ${token}.`);
  });

  test('anonymous list and search show the published card, never the draft', async ({ page }) => {
    await page.goto('/models');
    await expect(page.getByRole('heading', { level: 1, name: 'Models' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Models' }),
    ).toBeVisible();

    await page.getByLabel('Search models').fill(token);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(new RegExp(`/models\\?q=${token}`));
    await expect(page.getByRole('link', { name: new RegExp(publishedSlug) })).toBeVisible();
    await expect(page.getByText(draftSlug)).toHaveCount(0);
    await expect(page.getByText('1 published model')).toBeVisible();

    // Facets narrow the result and surface a removable chip.
    await page
      .getByRole('link', { name: /^Agent/ })
      .first()
      .click();
    await expect(page).toHaveURL(/modelClass=agent/);
    await expect(page.getByText('Class: Agent')).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(publishedSlug) })).toBeVisible();

    await page.goto(`/models?q=${token}&modelClass=classical`);
    await expect(page.getByRole('heading', { name: 'No matching models' })).toBeVisible();

    // Jurisdiction matches case-insensitively, from a hand-typed URL too.
    await page.goto(`/models?q=${token}&jurisdiction=nz`);
    await expect(page.getByRole('link', { name: new RegExp(publishedSlug) })).toBeVisible();
    await page.goto(`/models?q=${token}&jurisdiction=US`);
    await expect(page.getByRole('heading', { name: 'No matching models' })).toBeVisible();
  });

  test('opening a card shows its fields, the Model Facts label and JSON-LD', async ({ page }) => {
    await page.goto(`/models?q=${token}`);
    await page.getByRole('link', { name: new RegExp(publishedSlug) }).click();
    await expect(page).toHaveURL(new RegExp(`/models/${publishedSlug}$`));

    await expect(page.getByRole('heading', { level: 1, name: publishedSlug })).toBeVisible();
    await expect(page.getByText('E2E Models Ltd').first()).toBeVisible();

    const facts = page.getByRole('region', { name: 'Model Facts' });
    await expect(facts).toBeVisible();
    for (const section of [
      'Summary',
      'Mechanism',
      'Validation and performance',
      'Uses and directions',
      'Warnings',
      'Generalisability',
      'When to discontinue use',
      'Known gaps in this label',
    ]) {
      await expect(facts.getByRole('heading', { name: section })).toBeVisible();
    }
    await expect(facts.getByText('Treating the triage flag as a diagnosis.')).toBeVisible();

    const ld = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}',
    ) as Record<string, unknown>;
    expect(ld['@type']).toBe('SoftwareApplication');
    expect(ld.identifier).toBe(publishedSlug);
    expect(JSON.stringify(ld)).not.toContain('e2e@models.example');
  });

  test('a draft card 404s anonymously, on the page and the API', async ({ page, request }) => {
    const res = await page.goto(`/models/${draftSlug}`);
    expect(res?.status()).toBe(404);

    for (const path of ['', '/model-facts', '/model-facts.md']) {
      const api = await request.get(`${API}/v2/prediction/model-cards/${draftSlug}${path}`);
      expect(api.status(), path).toBe(404);
    }
    const list = await request.get(`${API}/v2/prediction/model-cards?q=${token}`);
    const body = (await list.json()) as { items: Array<{ slug: string }> };
    expect(body.items.map((i) => i.slug)).toEqual([publishedSlug]);
    expect(JSON.stringify(body)).not.toContain('submitterUserId');
  });

  test('axe-core: no violations on the list or the detail page', async ({ page }) => {
    for (const url of [`/models?q=${token}`, `/models/${publishedSlug}`]) {
      await page.goto(url);
      const results = await new AxeBuilder({ page }).include('main').withTags(AXE_TAGS).analyze();
      const summary = results.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`);
      expect(summary, `axe violations on ${url}`).toEqual([]);
    }
  });
});

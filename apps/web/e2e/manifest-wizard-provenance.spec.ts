import { createServer, type Server } from 'node:http';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Provenance step of the publish wizard + dataset-page provenance card
 * (bio-prov v0.1, #496, first slice).
 *
 * The publish page and the dataset page fetch the API server-side, so
 * `page.route` cannot intercept them. This spec runs a stub API on
 * `PW_API_STUB_PORT` (default 3999) that serves two datasets:
 *
 *   - `prov-sensitive-draft`  a SENSITIVE draft with no version yet — the
 *                             wizard target;
 *   - `prov-published`        a published dataset whose manifest carries a
 *                             full bio-prov block — the card target;
 *
 * and answers the publish POST with a 400 carrying a `provenance.*` issue,
 * so the submit-time panel's requirement-id wording is covered too.
 *
 * Sign-in uses the local Credentials provider (`OCI_ENV=local`), which
 * needs no API. Opt-in like the other stub specs:
 *
 *   PW_API_STUB=1 PW_NO_RESET=1 PW_NO_SERVER=1 \
 *   pnpm --filter @oci/web exec playwright test e2e/manifest-wizard-provenance.spec.ts
 *
 * with the web server started as
 *   OCI_ENV=local NEXT_PUBLIC_OCI_ENV=local NEXT_PUBLIC_API_BASE_URL=http://localhost:3999 …
 */

const STUB_ENABLED = process.env.PW_API_STUB === '1';
const STUB_PORT = Number(process.env.PW_API_STUB_PORT ?? '3999');
const HOST = '00000000-0000-4f00-8000-000000000f01';
const DRAFT_SLUG = 'prov-sensitive-draft';
const PUBLISHED_SLUG = 'prov-published';

function dataset(slug: string, extra: Record<string, unknown>) {
  return {
    id: '33333333-3333-4333-8333-333333333301',
    slug,
    name: `Provenance fixture ${slug}`,
    description: 'Fixture for the provenance step.',
    visibility: 'RESTRICTED',
    status: 'DRAFT',
    conformanceVersion: null,
    latestVersion: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    sourceCatalog: null,
    originUrl: null,
    accessTier: 'SENSITIVE',
    commercialUseTerms: 'CASE_BY_CASE',
    modalities: [],
    croissant: null,
    versions: [],
    distributions: [],
    duoTerms: [],
    hostId: HOST,
    commercialClauses: null,
    ...extra,
  };
}

const PUBLISHED_MANIFEST = {
  '@context': { '@vocab': 'https://schema.org/', bio: 'x', prov: 'y', rai: 'z' },
  '@type': 'sc:Dataset',
  'dct:conformsTo': 'http://mlcommons.org/croissant/1.1',
  name: 'Provenance fixture',
  description: 'd',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  url: 'https://example.org/',
  creator: [{ '@type': 'sc:Person', name: 'p' }],
  datePublished: '2026-01-01',
  'cr:version': '1.0.0',
  'bio:anonymizationLevel': 'DEIDENTIFIED',
  'bio:provenanceProfile': 'bio-prov/0.1',
  'prov:wasAttributedTo': [
    { '@type': 'prov:Organization', '@id': 'https://ror.org/01462r250', name: 'Fixture Hospital' },
  ],
  'prov:wasGeneratedBy': {
    '@type': 'prov:Activity',
    '@id': '#collection',
    name: 'Prospective collection',
    'prov:startedAtTime': '2019-03-01',
    'prov:endedAtTime': '2021-11-30',
  },
  'prov:wasDerivedFrom': { '@type': 'prov:Entity', '@id': 'https://doi.org/10.1000/upstream' },
  'bio:sourceSite': [{ name: 'Fixture Ophthalmology', country: 'CH' }],
  'rai:dataCollectionTimeframe': 'March 2019 to November 2021',
  'bio:deviceClass': { '@type': 'sc:DefinedTerm', name: 'OP (ophthalmic photography)' },
  'bio:deidentification': {
    '@type': 'prov:Activity',
    method: 'SAFE_HARBOR',
    resultingLevel: 'DEIDENTIFIED',
  },
  'bio:irbApproval': {
    approvingBody: 'Fixture Ethics Committee',
    approvalNumber: 'BASEC 2019-00123',
  },
  'bio:labelProtocol': {
    version: 'ICDR grading protocol 2018',
    labelScale: 'ICDR 0–4',
    gradersPerItem: 2,
  },
};

const PUBLISH_400 = {
  message: 'Croissant manifest validation failed',
  conformance: 'croissant-1.1',
  issues: [
    {
      path: '/irbApproval',
      level: 'error',
      code: 'provenance.missing.H5',
      message:
        'H5 (Ethics / IRB approval) is a MUST at SENSITIVE: irbApproval must reference the covering approval',
    },
  ],
};

let stub: Server | null = null;
let publishBodies: unknown[] = [];

async function signInAsHost(page: Page) {
  await page.goto('/signin?callbackUrl=%2Fdashboard');
  await page.getByLabel('User').fill(HOST);
  await page.getByLabel('Roles').fill('host');
  await page.getByRole('button', { name: /sign in.*local dev/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

/** Walk the first three steps with the minimum that passes their schema. */
async function reachProvenanceStep(page: Page) {
  await page.goto(`/catalog/${DRAFT_SLUG}/publish`);
  await page.getByLabel('Dataset name').fill('Provenance fixture');
  await page
    .getByLabel('Description')
    .fill('A fixture dataset used to exercise the provenance step of the publish wizard.');
  await page.getByLabel('Homepage').fill('https://example.org/');
  await page.getByRole('button', { name: /^Next:.*Creators/ }).click();
  await page.locator('#wiz-creator-0-name').fill('Fixture Author');
  await page.getByRole('button', { name: /^Next:.*Biomedical context/ }).click();
  await page.getByLabel('Anonymisation level').selectOption('DEIDENTIFIED');
  await page.getByRole('button', { name: /^Next:.*Provenance/ }).click();
  await expect(page.getByRole('heading', { name: 'Where did the data come from?' })).toBeVisible();
}

test.describe('publish wizard: provenance step (#496)', () => {
  test.skip(!STUB_ENABLED, 'set PW_API_STUB=1 and point NEXT_PUBLIC_API_BASE_URL at the stub');

  test.beforeAll(async () => {
    stub = createServer((req, res) => {
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET' && req.url === `/v2/catalog/datasets/${DRAFT_SLUG}`) {
        return json(200, dataset(DRAFT_SLUG, {}));
      }
      if (req.method === 'GET' && req.url === `/v2/catalog/datasets/${PUBLISHED_SLUG}`) {
        return json(
          200,
          dataset(PUBLISHED_SLUG, {
            status: 'PUBLISHED',
            visibility: 'PUBLIC',
            accessTier: 'OPEN',
            latestVersion: '1.0.0',
            conformanceVersion: '1.1',
            croissant: PUBLISHED_MANIFEST,
          }),
        );
      }
      if (req.method === 'GET' && req.url === '/v2/me/access-requests') return json(200, []);
      if (req.method === 'POST' && req.url === `/v2/catalog/datasets/${DRAFT_SLUG}/versions`) {
        let raw = '';
        req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
        req.on('end', () => {
          publishBodies.push(JSON.parse(raw));
          json(400, PUBLISH_400);
        });
        return;
      }
      json(404, { status: 404, title: 'Not Found' });
    });
    await new Promise<void>((resolve) => stub!.listen(STUB_PORT, resolve));
  });

  test.afterAll(async () => {
    if (stub) await new Promise<void>((resolve) => stub!.close(() => resolve()));
  });

  test('markers follow the SENSITIVE tier and the inline check names what is missing', async ({
    page,
  }) => {
    await signInAsHost(page);
    await reachProvenanceStep(page);

    // The four questions, in order.
    for (const q of [
      'Where did the data come from?',
      'What was done to it?',
      'Under what authority?',
      'How was the ground truth produced?',
    ]) {
      await expect(page.getByRole('heading', { level: 3, name: q })).toBeVisible();
    }

    // Markers from the obligation table at SENSITIVE: every block is Required,
    // P3 with its footnote.
    await expect(page.getByText('H5·Required', { exact: true })).toBeVisible();
    await expect(page.getByText('P3·Required when derived', { exact: true })).toBeVisible();
    await expect(page.getByText('H3·Required', { exact: true })).toBeVisible();

    // Acronym expanded once; resulting level pre-filled read-only.
    await expect(
      page.getByRole('heading', { level: 4, name: 'Ethics approval (IRB)' }),
    ).toBeVisible();
    const level = page.getByLabel('Resulting level');
    await expect(level).toHaveValue('DEIDENTIFIED');
    await expect(level).toHaveAttribute('readonly', '');

    // The pre-flight ran against the empty block and names the missing items
    // with the requirement id and a human sentence.
    await expect(
      page.getByText(
        'H5 · Ethics approval (IRB, institutional review board) is required for a SENSITIVE dataset',
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('P1 · Source organisation is required for a SENSITIVE dataset'),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 3,
        name: /required items missing for a SENSITIVE dataset/,
      }),
    ).toBeVisible();

    // Filling the ethics block clears H5 and leaves the others.
    await page.getByLabel('Approving body').fill('Fixture Ethics Committee');
    await page.getByLabel('Approval number').fill('BASEC 2019-00123');
    await expect(
      page.getByText(
        'H5 · Ethics approval (IRB, institutional review board) is required for a SENSITIVE dataset',
      ),
    ).toBeHidden({ timeout: 15_000 });
    await expect(
      page.getByText('P1 · Source organisation is required for a SENSITIVE dataset'),
    ).toBeVisible();

    // The live preview carries the block the step wrote.
    await expect(page.getByText('"bio:irbApproval"').first()).toBeVisible();
    await expect(page.getByText('"bio-prov/0.1"').first()).toBeVisible();

    // Next is not gated on the pre-flight (only on the schema), as for the other layers.
    await expect(page.getByRole('button', { name: /^Next:.*Data use/ })).toBeEnabled();
  });

  test('schema errors on the step show inline and block Next until fixed', async ({ page }) => {
    await signInAsHost(page);
    await reachProvenanceStep(page);

    await page.getByRole('button', { name: 'Add site' }).click();
    await page.locator('#wiz-prov-site-0-name').fill('Fixture Ophthalmology');
    // The input upper-cases as you type, so a letter pair always passes; a
    // digit does not.
    await page.getByLabel('Country').fill('S1');
    await expect(page.getByText('expected an ISO 3166-1 alpha-2 country code')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Next:.*Data use/ })).toBeDisabled();
    await page.getByLabel('Country').fill('CH');
    await expect(page.getByRole('button', { name: /^Next:.*Data use/ })).toBeEnabled();
  });

  test('the publish 400 renders provenance.* issues in requirement-id form', async ({ page }) => {
    publishBodies = [];
    await signInAsHost(page);
    await reachProvenanceStep(page);
    await page.getByLabel('Organisation name').fill('Fixture Hospital');
    await page.getByRole('button', { name: /^Next:.*Data use/ }).click();
    await page.getByLabel(/General research use/i).check();
    await page.getByRole('button', { name: /^Next:.*Distributions/ }).click();
    await page.getByRole('button', { name: /^Next:.*Review/ }).click();

    await expect(page.getByRole('heading', { name: /Ready to publish\?/ })).toBeVisible();
    // The review restates the pre-flight verdict.
    await expect(page.getByText(/\d+ required missing/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Publish version' }).click();
    await expect(page.getByRole('heading', { name: 'Manifest validation failed' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(
        'H5 · Ethics approval (IRB, institutional review board) is required for a SENSITIVE dataset',
      ),
    ).toBeVisible();

    // What the wizard sent carried the profile marker and the P1 block.
    expect(publishBodies).toHaveLength(1);
    const sent = publishBodies[0] as { croissant: Record<string, unknown> };
    expect(sent.croissant['bio:provenanceProfile']).toBe('bio-prov/0.1');
    expect(sent.croissant['prov:wasAttributedTo']).toEqual([
      { '@type': 'prov:Organization', name: 'Fixture Hospital' },
    ]);
  });

  test('dataset page: the Summary tab shows a read-only Provenance card', async ({ page }) => {
    await page.goto(`/catalog/${PUBLISHED_SLUG}`);
    const card = page.locator('section[aria-labelledby="provenance-card-h"]');
    await expect(card.getByRole('heading', { level: 3, name: 'Provenance' })).toBeVisible();
    await expect(card.getByText('Fixture Hospital')).toBeVisible();
    await expect(card.getByText('Fixture Ophthalmology')).toBeVisible();
    await expect(card.getByText('CH', { exact: true })).toBeVisible();
    await expect(card.getByText('2019-03-01 → 2021-11-30')).toBeVisible();
    await expect(card.getByText('OP (ophthalmic photography)')).toBeVisible();
    await expect(card.getByText('Safe Harbor')).toBeVisible();
    await expect(card.getByText('DEIDENTIFIED')).toBeVisible();
    await expect(card.getByText('Fixture Ethics Committee')).toBeVisible();
    await expect(card.getByText('BASEC 2019-00123')).toBeVisible();
    await expect(card.getByText('ICDR grading protocol 2018')).toBeVisible();
    await expect(
      card.getByRole('link', { name: 'https://doi.org/10.1000/upstream' }),
    ).toBeVisible();

    // A manifest with no provenance shows no card: the draft has no manifest at all.
    await signInAsHost(page);
    await page.goto(`/catalog/${DRAFT_SLUG}`);
    await expect(page.locator('section[aria-labelledby="provenance-card-h"]')).toHaveCount(0);
  });

  for (const viewport of [
    { name: 'mobile', width: 375, height: 667 },
    { name: 'desktop', width: 1280, height: 800 },
  ]) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`axe: provenance step at ${viewport.name} ${scheme} has no serious or critical violations`, async ({
        browser,
      }) => {
        const ctx = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: scheme,
        });
        const page = await ctx.newPage();
        await signInAsHost(page);
        await reachProvenanceStep(page);
        await page
          .getByText('P1 · Source organisation is required for a SENSITIVE dataset')
          .waitFor({
            timeout: 15_000,
          });
        await page.screenshot({
          path: `test-results/provenance-step-${viewport.name}-${scheme}.png`,
          fullPage: true,
        });
        // No horizontal overflow at 375 px.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const severe = results.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        );
        console.log(
          `[axe] provenance step ${viewport.name}/${scheme}: ${results.violations.length} violations` +
            (results.violations.length
              ? ` (${results.violations.map((v) => `${v.id}:${v.impact}:${v.nodes.length}`).join(', ')})`
              : ''),
        );
        expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
        await ctx.close();
      });
    }
  }
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDuoTerms, validate } from '../src/index.js';

/**
 * Validates every Croissant manifest under `apps/api/scripts/fixtures/`
 * and the bundled demo-seed fixtures under
 * `packages/database/seed/fixtures/<slug>/manifest.json` against the
 * layered Croissant 1.1 + RAI + BIOCroissant schema. Keeps the seed
 * fixtures honest as the validator + BIOCroissant draft evolve — a
 * breaking BIOCroissant change should fail this test before the change
 * merges, not silently corrupt the seeded catalog.
 *
 * For every bundled fixture the compact payload embedded in
 * `packages/database/seed/demo.sql` must be `JSON.stringify` of the
 * fixture's `manifest.json`, byte for byte — the repo is the authority
 * for those manifests and the seed refreshes an already-deployed row
 * whenever the payload differs.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '../../../apps/api/scripts/fixtures');
const seedFixturesDir = path.resolve(here, '../../database/seed/fixtures');
const demoSql = readFileSync(path.resolve(seedFixturesDir, '..', 'demo.sql'), 'utf8');

function loadJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function loadSeedFixture(slug: string): Record<string, unknown> {
  return loadJson(path.join(seedFixturesDir, slug, 'manifest.json'));
}

/** The dollar-quoted payload line demo.sql embeds for a fixture manifest. */
function sqlPayload(manifest: Record<string, unknown>): string {
  return `$manifest$${JSON.stringify(manifest)}$manifest$::jsonb;`;
}

function expectValidCroissant11(manifest: Record<string, unknown>): void {
  const r = validate(manifest);
  expect(r.issues, JSON.stringify(r.issues, null, 2)).toEqual([]);
  expect(r.ok).toBe(true);
  expect(r.conformance).toBe('croissant-1.1');
  expect(r.hasRai).toBe(true);
  expect(r.hasBioCroissant).toBe(true);
}

describe('seed fixtures', () => {
  it('idrid.croissant.json validates as Croissant 1.1 + RAI + BIOCroissant', () => {
    const m = loadJson(path.join(fixturesDir, 'idrid.croissant.json'));
    const r = validate(m);
    if (!r.ok) {
      throw new Error(`IDRiD fixture invalid:\n${JSON.stringify(r.issues, null, 2)}`);
    }
    expect(r.conformance).toBe('croissant-1.1');
    expect(r.hasRai).toBe(true);
    expect(r.hasBioCroissant).toBe(true);
  });
});

describe('demo-seed fixture: idrid-grading-demo', () => {
  const manifest = loadSeedFixture('idrid-grading-demo');

  it('validates with zero issues (PROV-O + ODRL + DUO block included)', () => {
    expectValidCroissant11(manifest);
  });

  it('declares the prov / odrl namespaces it uses', () => {
    const ctx = manifest['@context'] as Record<string, string>;
    expect(ctx['prov']).toBe('http://www.w3.org/ns/prov#');
    expect(ctx['odrl']).toBe('http://www.w3.org/ns/odrl/2/');
  });

  it('carries a prov:Entity derivation, a prov:Activity and an odrl:Offer', () => {
    const derived = manifest['prov:wasDerivedFrom'] as Record<string, unknown>;
    expect(derived['@type']).toBe('prov:Entity');
    expect(derived['@id']).toBe('https://doi.org/10.3390/data3030025');

    const activity = manifest['prov:wasGeneratedBy'] as Record<string, unknown>;
    expect(activity['@type']).toBe('prov:Activity');
    expect(activity['prov:used']).toBe(derived['@id']);
    const agent = activity['prov:wasAssociatedWith'] as Record<string, unknown>;
    expect(agent['@type']).toBe('prov:SoftwareAgent');
    expect((agent['prov:actedOnBehalfOf'] as Record<string, unknown>)['@type']).toBe(
      'prov:Organization',
    );

    const offer = manifest['odrl:hasOffer'] as Record<string, unknown>;
    expect(offer['@type']).toBe('odrl:Offer');
    const permissions = offer['odrl:permission'] as Array<Record<string, unknown>>;
    expect(permissions).toHaveLength(1);
    expect(permissions[0]?.['odrl:action']).toContain('odrl:use');
    const duties = permissions[0]?.['odrl:duty'] as Array<Record<string, unknown>>;
    expect(duties[0]?.['odrl:action']).toBe('odrl:attribute');
  });

  it('extractDuoTerms reads DUO_0000004 (no restriction) from cr:consentCode', () => {
    expect(extractDuoTerms(manifest)).toEqual(['DUO_0000004']);
  });

  it('the seed SQL payloads carry the same manifest as manifest.json', () => {
    const generated = readFileSync(
      path.join(seedFixturesDir, 'idrid-grading-demo', 'seed.generated.sql'),
      'utf8',
    );
    const payload = sqlPayload(manifest);
    expect(generated).toContain(payload);
    expect(demoSql).toContain(payload);
  });

  it('reports a prov:Activity missing @type under a croissant11.* code', () => {
    const broken = structuredClone(manifest);
    const activity = broken['prov:wasGeneratedBy'] as Record<string, unknown>;
    delete activity['@type'];
    const r = validate(broken);
    expect(r.ok).toBe(false);
    const issues = r.issues.filter((i) => i.path.startsWith('/wasGeneratedBy'));
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.code.startsWith('croissant11.')).toBe(true);
      expect(issue.level).toBe('error');
    }
  });

  it('reports a prov:wasDerivedFrom object of the wrong shape under a croissant11.* code', () => {
    const broken = structuredClone(manifest);
    broken['prov:wasDerivedFrom'] = { '@type': 'prov:Entity', name: 42 };
    const r = validate(broken);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code.startsWith('croissant11.'))).toBe(true);
  });
});

describe('demo-seed fixture: oci-demo-chest-xr', () => {
  it('validates as Croissant 1.1', () => {
    const m = loadJson(path.join(seedFixturesDir, 'oci-demo-chest-xr', 'manifest.json'));
    const r = validate(m);
    expect(
      r.issues.filter((i) => i.level === 'error'),
      JSON.stringify(r.issues, null, 2),
    ).toEqual([]);
    expect(r.conformance).toBe('croissant-1.1');
  });
});

describe('demo-seed fixture: rsna-pneumonia-2018 (#491)', () => {
  const manifest = loadSeedFixture('rsna-pneumonia-2018');

  it('validates with zero issues', () => {
    expectValidCroissant11(manifest);
  });

  it('describes the upstream dataset without hosting any bytes', () => {
    expect(manifest['distribution']).toBeUndefined();
    expect(manifest['url']).toBe(
      'https://www.rsna.org/rsnai/ai-image-challenge/rsna-pneumonia-detection-challenge-2018',
    );
    expect(manifest['license']).toBe(
      'https://www.kaggle.com/competitions/rsna-pneumonia-detection-challenge/rules',
    );
  });

  it('carries one record set with the challenge label columns', () => {
    const recordSets = manifest['recordSet'] as Array<Record<string, unknown>>;
    expect(recordSets).toHaveLength(1);
    const fields = recordSets[0]?.['field'] as Array<Record<string, unknown>>;
    expect(fields.map((f) => f['name'])).toEqual([
      'patientId',
      'x',
      'y',
      'width',
      'height',
      'target',
    ]);
  });

  it('carries the namespaced health terms and a non-commercial DUO term', () => {
    const disease = manifest['bio:diseaseCondition'] as Array<Record<string, unknown>>;
    expect(disease[0]?.['termCode']).toBe('CA40');
    expect(manifest['bio:anonymizationLevel']).toBe('DEIDENTIFIED');
    expect(extractDuoTerms(manifest)).toEqual(['DUO_0000046']);
  });

  it('the seed SQL payload carries the same manifest as manifest.json', () => {
    expect(demoSql).toContain(sqlPayload(manifest));
  });
});

describe('demo-seed fixture: demo-clinical-notes-2024 (#491)', () => {
  const manifest = loadSeedFixture('demo-clinical-notes-2024');

  it('validates with zero issues', () => {
    expectValidCroissant11(manifest);
  });

  it('is a text-only placeholder with one record set and no files', () => {
    expect(manifest['distribution']).toBeUndefined();
    const modality = manifest['bio:dataModality'] as Array<Record<string, unknown>>;
    expect(modality[0]?.['name']).toBe('Text');
    const recordSets = manifest['recordSet'] as Array<Record<string, unknown>>;
    expect(recordSets).toHaveLength(1);
    const fields = recordSets[0]?.['field'] as Array<Record<string, unknown>>;
    expect(fields.map((f) => f['name'])).toEqual(['noteId', 'text', 'label']);
    expect(manifest['bio:anonymizationLevel']).toBe('ANONYMIZED');
    expect(extractDuoTerms(manifest)).toEqual(['DUO_0000004']);
  });

  it('the seed SQL payload carries the same manifest as manifest.json', () => {
    expect(demoSql).toContain(sqlPayload(manifest));
  });
});

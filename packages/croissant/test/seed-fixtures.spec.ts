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
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '../../../apps/api/scripts/fixtures');
const seedFixturesDir = path.resolve(here, '../../database/seed/fixtures');

function loadJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
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
  const manifestPath = path.join(seedFixturesDir, 'idrid-grading-demo', 'manifest.json');
  const manifest = loadJson(manifestPath);

  it('validates with zero issues (PROV-O + ODRL + DUO block included)', () => {
    const r = validate(manifest);
    expect(r.issues, JSON.stringify(r.issues, null, 2)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.conformance).toBe('croissant-1.1');
    expect(r.hasRai).toBe(true);
    expect(r.hasBioCroissant).toBe(true);
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
    const compact = JSON.stringify(manifest);
    const generated = readFileSync(
      path.join(seedFixturesDir, 'idrid-grading-demo', 'seed.generated.sql'),
      'utf8',
    );
    const demo = readFileSync(path.resolve(seedFixturesDir, '..', 'demo.sql'), 'utf8');
    const payload = `$manifest$${compact}$manifest$::jsonb;`;
    expect(generated).toContain(payload);
    expect(demo).toContain(payload);
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

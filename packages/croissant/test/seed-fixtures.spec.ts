import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFORMS_TO,
  DPV_AI_DATA_COLLECTION,
  DPV_AI_DATA_LABELLING,
  PROVENANCE_CONFORMANCE_TARGET,
  extractDuoTerms,
  extractProvenance,
  validate,
} from '../src/index.js';

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

  it('carries a prov:Entity derivation, two DPV-typed activities and an odrl:Offer', () => {
    const derived = manifest['prov:wasDerivedFrom'] as Record<string, unknown>;
    expect(derived['@type']).toBe('prov:Entity');
    expect(derived['@id']).toBe('https://doi.org/10.3390/data3030025');

    const activities = manifest['prov:wasGeneratedBy'] as Array<Record<string, unknown>>;
    expect(activities).toHaveLength(2);
    const activity = activities[0] as Record<string, unknown>;
    expect(activity['@type']).toEqual(['prov:Activity', DPV_AI_DATA_COLLECTION]);
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

  describe('bio-prov v0.2 (#519, spec section 10.1)', () => {
    it('declares the conformance target and no deprecated marker', () => {
      expect(manifest['dct:conformsTo']).toEqual([
        CONFORMS_TO.croissant11,
        PROVENANCE_CONFORMANCE_TARGET,
      ]);
      expect(manifest['bio:provenanceProfile']).toBeUndefined();
      // The base layer still resolves the Croissant version from the array.
      expect(validate(manifest).conformance).toBe('croissant-1.1');
    });

    it('dates the collection activity and gives the labelling activity a guideline and roles', () => {
      const [collection, labelling] = manifest['prov:wasGeneratedBy'] as Array<
        Record<string, unknown>
      >;
      expect(collection?.['@type']).toEqual(['prov:Activity', DPV_AI_DATA_COLLECTION]);
      expect(collection?.['prov:startedAtTime']).toBe('2026-07-30T00:00:00Z');
      expect(collection?.['prov:endedAtTime']).toBe('2026-07-30T00:00:00Z');
      expect(labelling?.['@type']).toEqual(['prov:Activity', DPV_AI_DATA_LABELLING]);
      expect(labelling?.['prov:used']).toEqual({
        '@type': 'prov:Entity',
        '@id': '#guideline-idrid-2018-disease-grading',
        name: 'IDRiD 2018 disease-grading protocol',
        version: '2018',
      });
      // Roles, not identities, and no invented count: the prose already says
      // two graders and one adjudicator (rai:dataAnnotationProtocol).
      expect(labelling?.['prov:wasAssociatedWith']).toEqual([
        { '@type': 'prov:Person', 'prov:hadRole': 'Annotator' },
        { '@type': 'prov:Person', 'prov:hadRole': 'Adjudicator' },
      ]);
      expect(labelling?.['prov:atTime']).toBeUndefined();
    });

    it('keeps H2 text and H6 without inventing an agreement value', () => {
      expect(manifest['rai:dataCollectionTimeframe']).toBe(
        'IDRiD source collection published 2018; OCI demo slice prepared 30 July 2026',
      );
      expect(manifest['bio:labelProtocol']).toEqual({
        version: 'IDRiD 2018 disease-grading protocol',
        labelScale: 'ICDR 0–4; referable ≥ 2',
        gradersPerItem: 2,
        graderQualification: 'ophthalmologist, >25 years experience',
        adjudication: 'third grader adjudicated disagreements',
        perRaterLabelsRetained: false,
      });
      expect(
        (manifest['bio:labelProtocol'] as Record<string, unknown>)['interRaterAgreement'],
      ).toBe(undefined);
    });

    it('validates with zero issues, errors and warnings, at OPEN in strict mode', () => {
      const r = validate(manifest, { accessTier: 'OPEN', strictProvenance: true });
      expect(r.hasProvenanceProfile).toBe(true);
      expect(r.issues, JSON.stringify(r.issues, null, 2)).toEqual([]);
      expect(r.ok).toBe(true);
    });

    it('at SENSITIVE in strict mode fails on exactly the MUSTs the slice does not declare: H1, H3, H4, H5', () => {
      // Section 3 at SENSITIVE: P1–P4, H2, H6 and H6b are met; A1–A3 do not
      // apply (no campaign write-back); H1, H3, H4, H5 are MUST and absent.
      const r = validate(manifest, { accessTier: 'SENSITIVE', strictProvenance: true });
      const prov = r.issues.filter((i) => i.code.startsWith('provenance.'));
      expect(prov.map((i) => i.code).sort()).toEqual([
        'provenance.missing.H1',
        'provenance.missing.H3',
        'provenance.missing.H4',
        'provenance.missing.H5',
      ]);
      for (const issue of prov) expect(issue.level).toBe('error');
      expect(r.issues.filter((i) => !i.code.startsWith('provenance.'))).toEqual([]);
      expect(r.ok).toBe(false);
    });

    it('extractProvenance returns the label protocol version, the slice timeframe and the RAI text', () => {
      const summary = extractProvenance(manifest);
      expect(summary.labelProtocolVersion).toBe('IDRiD 2018 disease-grading protocol');
      expect(summary.timeframe).toEqual({
        start: '2026-07-30T00:00:00Z',
        end: '2026-07-30T00:00:00Z',
      });
      expect(summary.collectionTimeframeText).toBe(
        'IDRiD source collection published 2018; OCI demo slice prepared 30 July 2026',
      );
    });
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
    const activity = (broken['prov:wasGeneratedBy'] as Array<Record<string, unknown>>)[0] as Record<
      string,
      unknown
    >;
    delete activity['@type'];
    const r = validate(broken);
    expect(r.ok).toBe(false);
    const issues = r.issues.filter((i) => i.path.startsWith('/wasGeneratedBy'));
    const base = issues.filter((i) => !i.code.startsWith('provenance.'));
    expect(base.length).toBeGreaterThan(0);
    for (const issue of base) {
      expect(issue.code.startsWith('croissant11.')).toBe(true);
      expect(issue.level).toBe('error');
    }
    // The manifest opts into bio-prov, so the provenance layer also notices:
    // with the derivation activity untyped, P2 falls through to the labelling
    // activity, which carries no time — malformed P2 (an error at every tier)
    // and a missing H2 (a SHOULD at OPEN).
    expect(
      issues.filter((i) => i.code.startsWith('provenance.')).map((i) => [i.code, i.level]),
    ).toEqual([
      ['provenance.invalid.P2.startedAtTime', 'error'],
      ['provenance.invalid.P2.endedAtTime', 'error'],
      ['provenance.missing.H2', 'warning'],
    ]);
  });

  it('reports a prov:wasDerivedFrom object of the wrong shape under a croissant11.* code', () => {
    const broken = structuredClone(manifest);
    broken['prov:wasDerivedFrom'] = { '@type': 'prov:Entity', name: 42 };
    const r = validate(broken);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code.startsWith('croissant11.'))).toBe(true);
  });
});

describe('demo-seed fixture: oci-demo-chest-xr (#492)', () => {
  const manifest = loadSeedFixture('oci-demo-chest-xr');

  it('validates with zero issues', () => {
    expectValidCroissant11(manifest);
  });

  it('declares the DUO terms the seed denormalises into duo_terms (DS + NCU)', () => {
    expect(extractDuoTerms(manifest)).toEqual(['DUO_0000007', 'DUO_0000046']);
  });

  it('still lists the five hosted PNGs', () => {
    const distribution = manifest['distribution'] as Array<Record<string, unknown>>;
    expect(distribution).toHaveLength(5);
    for (const d of distribution) expect(d['encodingFormat']).toBe('image/png');
  });

  it('the seed SQL payload carries the same manifest as manifest.json', () => {
    expect(demoSql).toContain(sqlPayload(manifest));
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

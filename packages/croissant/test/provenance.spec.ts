import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFORMS_TO,
  DPV_AI_DATA_COLLECTION,
  DPV_AI_DATA_LABELLING,
  PROVENANCE_CONFORMANCE_TARGET,
  PROVENANCE_REQUIREMENTS,
  ProvenanceProfileSchema,
  extractProvenance,
  obligationFor,
  validate,
  validateProvenance,
  validateProvenanceDetailed,
  type RequirementId,
} from '../src/index.js';
import { normalize } from '../src/validator/normalize.js';

/**
 * `bio-prov` v0.2 provenance layer (#495, #519, ADR-0022,
 * docs/standards/bio-prov-v0.2.md). Cases:
 *
 *   (a) the seeded IDRiD fixture, which declares the conformance target;
 *   (b) a synthetic SENSITIVE manifest missing H5;
 *   (c) an H4 resultingLevel / anonymizationLevel mismatch;
 *   (d) activity times: an instant, a period, a period that runs backwards;
 *   (e) a campaign write-back distribution missing bio:integrity;
 *   (f) extractProvenance on the IDRiD fixture;
 *   (g) manifests that opt into nothing are untouched;
 *   (h) v0.2 opt-in and the deprecated v0.1 mechanics;
 *   (i) ODRL on `usageInfo` and on `hasOffer`;
 *   (j) H6b, the annotation activity;
 *   (k) a manifest written in the Croissant RAI specification's own
 *       worked-example shapes.
 *
 * Strict is the default since #504; the permissive reading is exercised
 * with an explicit `strictProvenance: false`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const seedFixturesDir = path.resolve(here, '../../database/seed/fixtures');

type Json = Record<string, unknown>;

function loadJson(file: string): Json {
  return JSON.parse(readFileSync(file, 'utf8')) as Json;
}

function fixture(name: string): Json {
  return loadJson(path.join(here, 'fixtures', name));
}

/** The seeded IDRiD slice, as shipped: it declares the v0.2 conformance target. */
function idrid(): Json {
  return loadJson(path.join(seedFixturesDir, 'idrid-grading-demo', 'manifest.json'));
}

/** The slice's activities: [0] the dated derivation, [1] the labelling activity. */
function activitiesOf(m: Json): Json[] {
  return m['prov:wasGeneratedBy'] as Json[];
}

/** The seeded slice without its label protocol (H6: SHOULD at OPEN, MUST above). */
function idridWithoutH6(): Json {
  const m = idrid();
  delete m['bio:labelProtocol'];
  return m;
}

/**
 * The seeded slice with no time on its collection activity. H2 is then
 * missing — and so is P2's time, because for this dataset the collection
 * activity *is* the generating activity.
 */
function idridWithoutActivityTime(): Json {
  const m = idrid();
  const activity = activitiesOf(m)[0] as Json;
  delete activity['prov:startedAtTime'];
  delete activity['prov:endedAtTime'];
  return m;
}

function codes(issues: ReadonlyArray<{ code: string }>): string[] {
  return issues.map((i) => i.code).sort();
}

function provenanceIssues<T extends { code: string }>(issues: ReadonlyArray<T>): T[] {
  return issues.filter((i) => i.code.startsWith('provenance.'));
}

const WRITE_BACK_ID = 'campaign-7f3a-annotations.jsonl';

/** H6b — a labelling activity with its guideline and its agents' roles. */
function annotationActivity(): Json {
  return {
    '@type': ['prov:Activity', DPV_AI_DATA_LABELLING],
    '@id': '#labelling',
    name: 'Independent reading with adjudication',
    'prov:used': {
      '@type': 'prov:Entity',
      '@id': '#guideline-cxr-v3',
      name: 'CXR pneumonia reading guideline',
      version: '3',
    },
    'prov:wasAssociatedWith': [
      { '@type': 'prov:Person', 'prov:hadRole': 'Annotator' },
      { '@type': 'prov:Person', 'prov:hadRole': 'Adjudicator' },
    ],
  };
}

/** The first `prov:wasGeneratedBy` entry — the P2 / H2 activity. */
function collectionActivityOf(m: Json): Json {
  return (m['prov:wasGeneratedBy'] as Json[])[0] as Json;
}

/**
 * A synthetic clinical dataset that is conformant at SENSITIVE: every
 * MUST in spec section 3 is met, including the annotation-campaign edge
 * on one write-back distribution. Built on the BIOCroissant fixture,
 * which already carries P1, H2, H3 (manufacturer), H5 and
 * `anonymizationLevel: DEIDENTIFIED`.
 */
function sensitiveManifest(): Json {
  const m = fixture('valid-biocroissant-1.1.json');
  m['dct:conformsTo'] = [CONFORMS_TO.croissant11, PROVENANCE_CONFORMANCE_TARGET];
  m['prov:wasAttributedTo'] = [
    { '@type': 'prov:Organization', '@id': 'https://ror.org/00000000', name: 'Test Hospital' },
  ];
  m['prov:wasGeneratedBy'] = [
    {
      '@type': ['prov:Activity', DPV_AI_DATA_COLLECTION],
      '@id': '#collection-2024',
      name: 'Prospective collection of chest radiographs',
      'prov:startedAtTime': '2024-01-01',
      'prov:endedAtTime': '2024-12-31',
      'prov:wasAssociatedWith': { '@type': 'prov:Organization', name: 'Test Hospital' },
    },
    annotationActivity(),
  ];
  m['bio:sourceSite'] = [{ name: 'Test Hospital, main campus', country: 'US' }];
  m['bio:deidentification'] = {
    '@type': 'prov:Activity',
    method: 'SAFE_HARBOR',
    resultingLevel: 'DEIDENTIFIED',
    'prov:endedAtTime': '2025-01-15',
    'prov:wasAssociatedWith': { '@type': 'prov:SoftwareAgent', name: 'deid-tool@2.3.0' },
  };
  m['bio:labelProtocol'] = {
    version: 'CXR pneumonia protocol v3',
    labelScale: 'binary: pneumonia present / absent',
    gradersPerItem: 3,
    adjudication: 'senior radiologist adjudicates disagreements',
  };
  const distribution = m['distribution'] as Json[];
  distribution.push({
    '@type': 'cr:FileObject',
    '@id': WRITE_BACK_ID,
    name: WRITE_BACK_ID,
    contentUrl: 'https://example.org/campaigns/7f3a/annotations.jsonl',
    encodingFormat: 'application/jsonl',
    'prov:wasDerivedFrom': { '@type': 'prov:Entity', '@id': 'manifest.csv' },
    'prov:wasGeneratedBy': {
      '@type': ['prov:Activity', DPV_AI_DATA_LABELLING],
      '@id': 'urn:oci:campaign:7f3a',
      'prov:startedAtTime': '2026-06-01T08:00:00Z',
      'prov:endedAtTime': '2026-08-30T10:00:00Z',
      'prov:wasAssociatedWith': {
        '@type': 'prov:SoftwareAgent',
        name: 'oci-annotation',
        softwareVersion: '2.4.0',
        'prov:actedOnBehalfOf': { '@type': 'prov:Organization', name: 'Test Hospital' },
      },
    },
    'bio:integrity': {
      chain: 'sha256',
      root: 'a3f1c2d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      events: 1284,
      verifiedAt: '2026-08-30T10:12:00Z',
    },
    'bio:receipts': [
      { kind: 'ACCESS', ref: 'urn:oci:receipt:access:1', issuedAt: '2026-05-30T09:00:00Z' },
      {
        kind: 'ANNOTATOR_AGREEMENT',
        ref: 'urn:oci:receipt:agreement:12',
        issuedAt: '2026-05-31T09:00:00Z',
      },
    ],
  });
  return m;
}

function writeBackOf(m: Json): Json {
  const found = (m['distribution'] as Json[]).find((d) => d['@id'] === WRITE_BACK_ID);
  if (!found) throw new Error('write-back distribution not in manifest');
  return found;
}

describe('bio-prov obligation table (spec section 3)', () => {
  const table: Record<RequirementId, [string, string, string, string]> = {
    P1: ['SHOULD', 'MUST', 'MUST', 'MUST'],
    P2: ['SHOULD', 'MUST', 'MUST', 'MUST'],
    P3: ['MUST', 'MUST', 'MUST', 'MUST'],
    P4: ['MAY', 'SHOULD', 'MUST', 'MUST'],
    H1: ['MAY', 'SHOULD', 'MUST', 'MUST'],
    H2: ['SHOULD', 'MUST', 'MUST', 'MUST'],
    H3: ['MAY', 'SHOULD', 'SHOULD', 'MUST'],
    H4: ['MAY', 'SHOULD', 'MUST', 'MUST'],
    H5: ['MAY', 'SHOULD', 'MUST', 'MUST'],
    H6: ['SHOULD', 'MUST', 'MUST', 'MUST'],
    H6b: ['MAY', 'SHOULD', 'MUST', 'MUST'],
    A1: ['MUST', 'MUST', 'MUST', 'MUST'],
    A2: ['MUST', 'MUST', 'MUST', 'MUST'],
    A3: ['MAY', 'SHOULD', 'MUST', 'MUST'],
  };

  it('encodes the table as written, in order', () => {
    expect(PROVENANCE_REQUIREMENTS.map((r) => r.id)).toEqual(Object.keys(table));
    for (const r of PROVENANCE_REQUIREMENTS) {
      const [open, registered, controlled, sensitive] = table[r.id];
      expect(r.obligation, r.id).toEqual({
        OPEN: open,
        REGISTERED: registered,
        CONTROLLED: controlled,
        SENSITIVE: sensitive,
      });
    }
  });

  it('footnote 2: H4 at OPEN becomes a MUST when anonymizationLevel is not ANONYMIZED', () => {
    const h4 = PROVENANCE_REQUIREMENTS.find((r) => r.id === 'H4');
    if (!h4) throw new Error('H4 missing from table');
    expect(obligationFor(h4, 'OPEN', {})).toBe('MAY');
    expect(obligationFor(h4, 'OPEN', { anonymizationLevel: 'ANONYMIZED' })).toBe('MAY');
    expect(obligationFor(h4, 'OPEN', { anonymizationLevel: 'LIMITED' })).toBe('MUST');
    expect(obligationFor(h4, 'OPEN', { anonymizationLevel: 'IDENTIFIED' })).toBe('MUST');
    // Other tiers are unaffected by the footnote.
    expect(obligationFor(h4, 'REGISTERED', { anonymizationLevel: 'LIMITED' })).toBe('SHOULD');
  });
});

describe('(a) seeded IDRiD fixture (declares the target, spec section 10.1)', () => {
  it('declares the v0.2 conformance target, drops the marker, and keeps H2 / H6 / H6b', () => {
    const m = idrid();
    expect(m['dct:conformsTo']).toEqual([CONFORMS_TO.croissant11, PROVENANCE_CONFORMANCE_TARGET]);
    expect(m['bio:provenanceProfile']).toBeUndefined();
    expect(typeof m['rai:dataCollectionTimeframe']).toBe('string');
    expect((m['bio:labelProtocol'] as Json)['version']).toBe('IDRiD 2018 disease-grading protocol');
    const [collection, labelling] = activitiesOf(m) as [Json, Json];
    expect(collection['@type']).toEqual(['prov:Activity', DPV_AI_DATA_COLLECTION]);
    expect(collection['prov:startedAtTime']).toBe('2026-07-30T00:00:00Z');
    expect(labelling['@type']).toEqual(['prov:Activity', DPV_AI_DATA_LABELLING]);
    expect((labelling['prov:used'] as Json)['name']).toBe('IDRiD 2018 disease-grading protocol');
    expect(labelling['prov:wasAssociatedWith']).toEqual([
      { '@type': 'prov:Person', 'prov:hadRole': 'Annotator' },
      { '@type': 'prov:Person', 'prov:hadRole': 'Adjudicator' },
    ]);
  });

  it('the base layer still resolves Croissant 1.1 from the conformsTo array', () => {
    expect(validate(idrid()).conformance).toBe('croissant-1.1');
  });

  it('validates with zero issues (errors and warnings) at OPEN in strict mode', () => {
    const r = validate(idrid(), { accessTier: 'OPEN', strictProvenance: true });
    expect(r.hasProvenanceProfile).toBe(true);
    expect(r.issues, JSON.stringify(r.issues, null, 2)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('at OPEN strict, H6 is the SHOULD that surfaces as a warning when removed', () => {
    const r = validate(idridWithoutH6(), { accessTier: 'OPEN', strictProvenance: true });
    const prov = provenanceIssues(r.issues);
    expect(codes(prov)).toEqual(['provenance.missing.H6']);
    for (const issue of prov) expect(issue.level).toBe('warning');
    expect(r.ok).toBe(true);
    // H1 / H3 / H4 / H5 are MAY at OPEN, and so is H6b: never reported as
    // missing. H4 stays MAY because the level is ANONYMIZED (footnote 2).
    for (const id of ['H1', 'H3', 'H4', 'H5', 'H6b']) {
      expect(
        prov.some((i) => i.code.endsWith(`.${id}`)),
        id,
      ).toBe(false);
    }
  });

  it('at OPEN strict, an undated collection activity is a missing H2 (and P2 wants a time too)', () => {
    const r = validate(idridWithoutActivityTime(), { accessTier: 'OPEN', strictProvenance: true });
    const byCode = new Map(provenanceIssues(r.issues).map((i) => [i.code, i]));
    expect(byCode.get('provenance.missing.H2')?.level).toBe('warning');
    expect(byCode.get('provenance.missing.H2')?.path).toBe('/wasGeneratedBy/0');
    // The collection activity is this dataset's generating activity, so P2
    // reports the same absence as a malformed activity — an error at every tier.
    expect(byCode.get('provenance.invalid.P2.startedAtTime')?.level).toBe('error');
    expect(byCode.get('provenance.invalid.P2.startedAtTime')?.message).toContain('prov:atTime');
    expect(r.ok).toBe(false);
  });

  it('at REGISTERED strict, a missing H2 is an error', () => {
    const r = validate(idridWithoutActivityTime(), {
      accessTier: 'REGISTERED',
      strictProvenance: true,
    });
    expect(r.issues.find((i) => i.code === 'provenance.missing.H2')?.level).toBe('error');
  });

  it('at REGISTERED strict, H1 / H3 / H4 / H5 surface as SHOULD-level warnings; H2 / H6 / H6b are met', () => {
    const r = validate(idrid(), { accessTier: 'REGISTERED', strictProvenance: true });
    const prov = provenanceIssues(r.issues);
    expect(codes(prov)).toEqual([
      'provenance.missing.H1',
      'provenance.missing.H3',
      'provenance.missing.H4',
      'provenance.missing.H5',
    ]);
    for (const issue of prov) expect(issue.level).toBe('warning');
    expect(r.ok).toBe(true);
    // Without H6 the same tier turns it into an error (MUST at REGISTERED).
    const stripped = validate(idridWithoutH6(), {
      accessTier: 'REGISTERED',
      strictProvenance: true,
    });
    const byCode = new Map(provenanceIssues(stripped.issues).map((i) => [i.code, i.level]));
    expect(byCode.get('provenance.missing.H6')).toBe('error');
    expect(stripped.ok).toBe(false);
    // P1–P4 are met by the fixture (derived slice with a dated activity).
    for (const id of ['P1', 'P2', 'P3', 'P4']) {
      expect(
        prov.some((i) => i.code.includes(`.${id}`)),
        id,
      ).toBe(false);
    }
  });

  it('the default is strict at OPEN: identical to an explicit { OPEN, strict }', () => {
    for (const load of [idrid, idridWithoutH6]) {
      const byDefault = validate(load());
      const explicit = validate(load(), { accessTier: 'OPEN', strictProvenance: true });
      expect(byDefault.hasProvenanceProfile).toBe(true);
      expect(byDefault.issues).toEqual(explicit.issues);
      expect(byDefault.ok).toBe(explicit.ok);
    }
  });

  it('permissive mode (strictProvenance: false) reports a MUST one level down, as a warning', () => {
    // At REGISTERED, H6 is a MUST: an error strict, a warning permissive. The
    // SHOULDs (H1 / H3 / H4 / H5 / H6b) are not reported at all.
    const permissive = validate(idridWithoutH6(), {
      accessTier: 'REGISTERED',
      strictProvenance: false,
    });
    const prov = provenanceIssues(permissive.issues);
    expect(codes(prov)).toEqual(['provenance.missing.H6']);
    for (const issue of prov) expect(issue.level).toBe('warning');
    expect(permissive.ok).toBe(true);
  });

  it('the per-requirement report marks P3 applicable (derived) and A1–A3 not applicable', () => {
    const normalized = normalize(idrid()) as Json;
    const detailed = validateProvenanceDetailed(normalized, { accessTier: 'OPEN', strict: true });
    const status = new Map(detailed.report.map((e) => [e.id, e.status]));
    expect(status.get('P1')).toBe('satisfied');
    expect(status.get('P2')).toBe('satisfied');
    expect(status.get('P3')).toBe('satisfied');
    expect(status.get('P4')).toBe('satisfied');
    expect(status.get('H2')).toBe('satisfied');
    expect(status.get('H6')).toBe('satisfied');
    expect(status.get('H6b')).toBe('satisfied');
    expect(status.get('A1')).toBe('not_applicable');
    expect(status.get('A2')).toBe('not_applicable');
    expect(status.get('A3')).toBe('not_applicable');
  });

  it('parses against ProvenanceProfileSchema once normalized', () => {
    const r = ProvenanceProfileSchema.safeParse(normalize(idrid()));
    expect(r.success, JSON.stringify(r.error?.issues, null, 2)).toBe(true);
  });
});

describe('(b) synthetic SENSITIVE manifest', () => {
  it('is conformant at SENSITIVE in strict mode (zero issues, all layers)', () => {
    const r = validate(sensitiveManifest(), { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(r.issues, JSON.stringify(r.issues, null, 2)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.hasProvenanceProfile).toBe(true);
  });

  it('missing H5 is an error at SENSITIVE in strict mode', () => {
    const m = sensitiveManifest();
    delete m['bio:irbApproval'];
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    const h5 = r.issues.filter((i) => i.code === 'provenance.missing.H5');
    expect(h5).toHaveLength(1);
    expect(h5[0]?.level).toBe('error');
    expect(h5[0]?.path).toBe('/irbApproval');
    expect(r.ok).toBe(false);
  });

  it('missing H5 is an error at SENSITIVE by default (strict is the default)', () => {
    const m = sensitiveManifest();
    delete m['bio:irbApproval'];
    const r = validate(m, { accessTier: 'SENSITIVE' });
    const h5 = r.issues.filter((i) => i.code === 'provenance.missing.H5');
    expect(h5).toHaveLength(1);
    expect(h5[0]?.level).toBe('error');
    expect(r.ok).toBe(false);
  });

  it('missing H5 is a warning at SENSITIVE with strictProvenance: false', () => {
    const m = sensitiveManifest();
    delete m['bio:irbApproval'];
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: false });
    const h5 = r.issues.filter((i) => i.code === 'provenance.missing.H5');
    expect(h5).toHaveLength(1);
    expect(h5[0]?.level).toBe('warning');
    expect(r.ok).toBe(true);
  });

  it('missing H5 is never reported at OPEN (a MAY), even in strict mode', () => {
    const m = sensitiveManifest();
    delete m['bio:irbApproval'];
    const r = validate(m, { accessTier: 'OPEN', strictProvenance: true });
    expect(r.issues.some((i) => i.code === 'provenance.missing.H5')).toBe(false);
  });
});

describe('(c) H4 cross-checks', () => {
  it('resultingLevel not equal to anonymizationLevel → provenance.mismatch.H4.anonymizationLevel', () => {
    const m = sensitiveManifest();
    (m['bio:deidentification'] as Json)['resultingLevel'] = 'ANONYMIZED';
    // The BIOCroissant fixture declares DEIDENTIFIED.
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    const mismatch = r.issues.filter((i) => i.code === 'provenance.mismatch.H4.anonymizationLevel');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]?.level).toBe('error');
    expect(mismatch[0]?.path).toBe('/deidentification/resultingLevel');
  });

  it('the mismatch is an error at every tier in strict mode, a warning in permissive mode', () => {
    const m = sensitiveManifest();
    (m['bio:deidentification'] as Json)['resultingLevel'] = 'LIMITED';
    const strictOpen = validate(m, { accessTier: 'OPEN', strictProvenance: true });
    expect(
      strictOpen.issues.find((i) => i.code === 'provenance.mismatch.H4.anonymizationLevel')?.level,
    ).toBe('error');
    const permissive = validate(m, { accessTier: 'OPEN', strictProvenance: false });
    expect(
      permissive.issues.find((i) => i.code === 'provenance.mismatch.H4.anonymizationLevel')?.level,
    ).toBe('warning');
  });

  it('method NONE is only valid with resultingLevel IDENTIFIED', () => {
    const m = sensitiveManifest();
    (m['bio:deidentification'] as Json)['method'] = 'NONE';
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(codes(provenanceIssues(r.issues))).toEqual(['provenance.invalid.H4.method']);
  });

  it('an unknown resultingLevel → provenance.invalid.H4.resultingLevel', () => {
    const m = sensitiveManifest();
    (m['bio:deidentification'] as Json)['resultingLevel'] = 'OBFUSCATED';
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    const issue = r.issues.find((i) => i.code === 'provenance.invalid.H4.resultingLevel');
    expect(issue?.path).toBe('/deidentification/resultingLevel');
  });

  it('footnote 2: at OPEN a non-ANONYMIZED dataset without H4 fails in strict mode', () => {
    const m = sensitiveManifest();
    delete m['bio:deidentification'];
    const r = validate(m, { accessTier: 'OPEN', strictProvenance: true });
    const h4 = r.issues.find((i) => i.code === 'provenance.missing.H4');
    expect(h4?.level).toBe('error');
    expect(h4?.message).toContain('MUST');
  });
});

describe('(d) activity times (spec section 4, the time rule)', () => {
  it('an instant (prov:atTime) satisfies P2 and H2 — no bounds asked for', () => {
    const m = sensitiveManifest();
    const activity = collectionActivityOf(m);
    delete activity['prov:startedAtTime'];
    delete activity['prov:endedAtTime'];
    activity['prov:atTime'] = '2024-06-30T12:00:00Z';
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(r.issues, JSON.stringify(r.issues, null, 2)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(extractProvenance(m).timeframe).toEqual({
      start: '2024-06-30T12:00:00Z',
      end: '2024-06-30T12:00:00Z',
    });
  });

  it('a non-ISO prov:atTime → provenance.invalid.P2.atTime', () => {
    const m = sensitiveManifest();
    const activity = collectionActivityOf(m);
    delete activity['prov:startedAtTime'];
    delete activity['prov:endedAtTime'];
    activity['prov:atTime'] = 'June 2024';
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    const issue = r.issues.find((i) => i.code === 'provenance.invalid.P2.atTime');
    expect(issue?.level).toBe('error');
    expect(issue?.path).toBe('/wasGeneratedBy/0/atTime');
  });

  it('a period with only one bound is not a period → provenance.invalid.P2.endedAtTime', () => {
    const m = sensitiveManifest();
    delete collectionActivityOf(m)['prov:endedAtTime'];
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    const issue = r.issues.find((i) => i.code === 'provenance.invalid.P2.endedAtTime');
    expect(issue?.level).toBe('error');
    expect(issue?.path).toBe('/wasGeneratedBy/0/endedAtTime');
  });

  it('endedAtTime before startedAtTime → provenance.invalid.P2.endedAtTime', () => {
    const m = sensitiveManifest();
    const activity = collectionActivityOf(m);
    activity['prov:startedAtTime'] = '2024-12-31';
    activity['prov:endedAtTime'] = '2024-01-01';
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    const issue = r.issues.find((i) => i.code === 'provenance.invalid.P2.endedAtTime');
    expect(issue?.level).toBe('error');
    expect(issue?.path).toBe('/wasGeneratedBy/0/endedAtTime');
    expect(issue?.message).toContain('must not be before startedAtTime');
    expect(codes(provenanceIssues(r.issues))).toEqual(['provenance.invalid.P2.endedAtTime']);
  });

  it('a non-ISO date → provenance.invalid.P2.startedAtTime', () => {
    const m = sensitiveManifest();
    collectionActivityOf(m)['prov:startedAtTime'] = 'March 2024';
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(codes(provenanceIssues(r.issues))).toEqual(['provenance.invalid.P2.startedAtTime']);
  });

  it('paths index into an array of activities', () => {
    const m = sensitiveManifest();
    const activity = collectionActivityOf(m);
    delete activity['prov:endedAtTime'];
    m['prov:wasGeneratedBy'] = [
      'https://example.org/some-activity',
      activity,
      annotationActivity(),
    ];
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    const issue = r.issues.find((i) => i.code === 'provenance.invalid.P2.endedAtTime');
    expect(issue?.path).toBe('/wasGeneratedBy/1/endedAtTime');
  });

  it('an IRI string alone does not satisfy P2', () => {
    const m = sensitiveManifest();
    m['prov:wasGeneratedBy'] = 'https://example.org/some-activity';
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(r.issues.some((i) => i.code === 'provenance.missing.P2')).toBe(true);
    // P4 cannot be met without an activity either.
    expect(r.issues.some((i) => i.code === 'provenance.missing.P4')).toBe(true);
  });

  it('a derived dataset whose activity does not `used` the upstream → provenance.invalid.P2.used', () => {
    const m = sensitiveManifest();
    m['prov:wasDerivedFrom'] = 'https://doi.org/10.0000/upstream';
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(codes(provenanceIssues(r.issues))).toEqual(['provenance.invalid.P2.used']);
  });
});

describe('(e) annotation-campaign write-back distributions', () => {
  it('missing bio:integrity → provenance.missing.A2, an error at every tier in strict mode', () => {
    const m = sensitiveManifest();
    delete writeBackOf(m)['bio:integrity'];
    const index = (m['distribution'] as Json[]).findIndex((d) => d['@id'] === WRITE_BACK_ID);
    for (const accessTier of ['OPEN', 'REGISTERED', 'CONTROLLED', 'SENSITIVE'] as const) {
      const r = validate(m, { accessTier, strictProvenance: true });
      const a2 = r.issues.filter((i) => i.code === 'provenance.missing.A2');
      expect(a2, accessTier).toHaveLength(1);
      expect(a2[0]?.level, accessTier).toBe('error');
      expect(a2[0]?.path).toBe(`/distribution/${index}/integrity`);
    }
    // Permissive: one level down.
    const permissive = validate(m, { accessTier: 'SENSITIVE', strictProvenance: false });
    expect(permissive.issues.find((i) => i.code === 'provenance.missing.A2')?.level).toBe(
      'warning',
    );
  });

  it('a malformed chain root → provenance.invalid.A2.root', () => {
    const m = sensitiveManifest();
    (writeBackOf(m)['bio:integrity'] as Json)['root'] = 'not-hex!';
    const r = validate(m, { accessTier: 'OPEN', strictProvenance: true });
    expect(codes(provenanceIssues(r.issues))).toEqual(['provenance.invalid.A2.root']);
  });

  it('missing bio:receipts is a MUST at CONTROLLED and above, a MAY at OPEN', () => {
    const m = sensitiveManifest();
    delete writeBackOf(m)['bio:receipts'];
    const controlled = validate(m, { accessTier: 'CONTROLLED', strictProvenance: true });
    expect(controlled.issues.find((i) => i.code === 'provenance.missing.A3')?.level).toBe('error');
    const registered = validate(m, { accessTier: 'REGISTERED', strictProvenance: true });
    expect(registered.issues.find((i) => i.code === 'provenance.missing.A3')?.level).toBe(
      'warning',
    );
    const open = validate(m, { accessTier: 'OPEN', strictProvenance: true });
    expect(open.issues.some((i) => i.code === 'provenance.missing.A3')).toBe(false);
  });

  it('a write-back that is not wasDerivedFrom anything → provenance.missing.A1', () => {
    const m = sensitiveManifest();
    delete writeBackOf(m)['prov:wasDerivedFrom'];
    const r = validate(m, { accessTier: 'OPEN', strictProvenance: true });
    expect(codes(provenanceIssues(r.issues))).toEqual(['provenance.missing.A1']);
  });

  it('a campaign activity without a SoftwareAgent → provenance.invalid.A1.wasAssociatedWith', () => {
    const m = sensitiveManifest();
    const activity = writeBackOf(m)['prov:wasGeneratedBy'] as Json;
    activity['prov:wasAssociatedWith'] = { '@type': 'prov:Person', name: 'Someone' };
    const r = validate(m, { accessTier: 'OPEN', strictProvenance: true });
    expect(codes(provenanceIssues(r.issues))).toEqual(['provenance.invalid.A1.wasAssociatedWith']);
  });

  it('ordinary distributions are not treated as write-backs', () => {
    const m = sensitiveManifest();
    (m['distribution'] as Json[]).pop();
    const normalized = normalize(m) as Json;
    const detailed = validateProvenanceDetailed(normalized, {
      accessTier: 'SENSITIVE',
      strict: true,
    });
    expect(detailed.issues).toEqual([]);
    for (const id of ['A1', 'A2', 'A3']) {
      expect(detailed.report.find((e) => e.id === id)?.status).toBe('not_applicable');
    }
  });
});

describe('other health qualifiers', () => {
  it('a source site without a country → provenance.invalid.H1.country with an indexed pointer', () => {
    const m = sensitiveManifest();
    (m['bio:sourceSite'] as Json[]).push({ name: 'Satellite clinic' });
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    const issue = r.issues.find((i) => i.code === 'provenance.invalid.H1.country');
    expect(issue?.path).toBe('/sourceSite/1/country');
  });

  it('a device serial number is rejected (H3)', () => {
    const m = sensitiveManifest();
    (m['bio:dataAcquisitionEquipment'] as Json[])[0]!['serialNumber'] = 'SN-0001';
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(codes(provenanceIssues(r.issues))).toEqual(['provenance.invalid.H3.serialNumber']);
  });

  it('a deviceClass term satisfies H3 without equipment', () => {
    const m = sensitiveManifest();
    delete m['bio:dataAcquisitionEquipment'];
    m['bio:deviceClass'] = {
      '@type': 'sc:DefinedTerm',
      name: 'Computed Radiography',
      termCode: 'CR',
    };
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(provenanceIssues(r.issues)).toEqual([]);
  });

  it('a labelProtocol without its minimum fields → provenance.invalid.H6.<field>', () => {
    const m = sensitiveManifest();
    m['bio:labelProtocol'] = { version: 'v3' };
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(codes(provenanceIssues(r.issues))).toEqual([
      'provenance.invalid.H6.gradersPerItem',
      'provenance.invalid.H6.labelScale',
    ]);
  });

  it('every issue path is an RFC 6901 pointer', () => {
    const m = sensitiveManifest();
    delete m['bio:irbApproval'];
    delete m['bio:sourceSite'];
    (m['bio:deidentification'] as Json)['method'] = 'NONE';
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(provenanceIssues(r.issues).length).toBeGreaterThan(0);
    for (const issue of r.issues) expect(issue.path.startsWith('/')).toBe(true);
  });

  it('validateProvenance is callable on its own with a normalized manifest', () => {
    const issues = validateProvenance(normalize(sensitiveManifest()) as Json, {
      accessTier: 'SENSITIVE',
      strict: true,
    });
    expect(issues).toEqual([]);
  });
});

describe('(f) extractProvenance', () => {
  it('reads the IDRiD fixture: DOI in derivedFrom, the attributed organizations, the slice timeframe, the protocol', () => {
    const summary = extractProvenance(idrid());
    expect(summary.derivedFrom).toEqual(['https://doi.org/10.3390/data3030025']);
    expect(summary.sourceOrganizations).toEqual([
      'IDRiD consortium (Porwal et al., 2018) — source images captured at an eye clinic in Nanded, Maharashtra, India',
      'OCI Platform (GI-AI4H) — re-publisher of the demo slice',
    ]);
    expect(summary.timeframe).toEqual({
      start: '2026-07-30T00:00:00Z',
      end: '2026-07-30T00:00:00Z',
    });
    expect(summary.collectionTimeframeText).toBe(
      'IDRiD source collection published 2018; OCI demo slice prepared 30 July 2026',
    );
    expect(summary.labelProtocolVersion).toBe('IDRiD 2018 disease-grading protocol');
    // MAY at OPEN and not declared by the slice.
    expect(summary.sites).toEqual([]);
    expect(summary.deviceClasses).toEqual([]);
    expect(summary.deidentification).toBeNull();
    expect(summary.ethicsApproval).toBeNull();
    expect(summary.writeBacks).toEqual([]);
  });

  it('reads the synthetic SENSITIVE manifest including the write-back chain root', () => {
    const summary = extractProvenance(sensitiveManifest());
    expect(summary.sourceOrganizations).toEqual(['Test Hospital']);
    expect(summary.sites).toEqual([{ name: 'Test Hospital, main campus', country: 'US' }]);
    expect(summary.timeframe).toEqual({ start: '2024-01-01', end: '2024-12-31' });
    expect(summary.deviceClasses).toEqual(['Siemens Healthineers MULTIX Impact']);
    expect(summary.deidentification).toEqual({
      method: 'SAFE_HARBOR',
      resultingLevel: 'DEIDENTIFIED',
    });
    expect(summary.ethicsApproval).toEqual({
      approvingBody: 'Test Hospital IRB',
      approvalNumber: 'IRB-2023-1142',
    });
    expect(summary.labelProtocolVersion).toBe('CXR pneumonia protocol v3');
    expect(summary.derivedFrom).toEqual([]);
    expect(summary.writeBacks).toEqual([
      {
        distributionId: WRITE_BACK_ID,
        chainRoot: 'a3f1c2d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
        events: 1284,
      },
    ]);
  });

  it('accepts prefixed and normalized input alike', () => {
    const m = sensitiveManifest();
    expect(extractProvenance(normalize(m))).toEqual(extractProvenance(m));
  });

  it('returns an empty summary for junk input', () => {
    const summary = extractProvenance('nope');
    expect(summary.sourceOrganizations).toEqual([]);
    expect(summary.timeframe).toBeNull();
    expect(summary.writeBacks).toEqual([]);
  });
});

describe('(g) manifests that opt into nothing', () => {
  const cases: Array<[string, () => Json]> = [
    [
      'seeded oci-demo-chest-xr',
      () => loadJson(path.join(seedFixturesDir, 'oci-demo-chest-xr', 'manifest.json')),
    ],
    [
      'seeded rsna-pneumonia-2018',
      () => loadJson(path.join(seedFixturesDir, 'rsna-pneumonia-2018', 'manifest.json')),
    ],
    [
      'seeded demo-clinical-notes-2024',
      () => loadJson(path.join(seedFixturesDir, 'demo-clinical-notes-2024', 'manifest.json')),
    ],
    ['valid-biocroissant-1.1', () => fixture('valid-biocroissant-1.1.json')],
    ['valid-croissant-1.0', () => fixture('valid-croissant-1.0.json')],
    [
      'the IDRiD slice with the bio-prov target dropped from conformsTo',
      () => {
        const m = idrid();
        m['dct:conformsTo'] = CONFORMS_TO.croissant11;
        return m;
      },
    ],
  ];

  for (const [name, load] of cases) {
    it(`${name}: hasProvenanceProfile is false and no provenance.* issue is emitted at any tier`, () => {
      for (const options of [
        undefined,
        { accessTier: 'OPEN' as const },
        { accessTier: 'SENSITIVE' as const },
        { accessTier: 'SENSITIVE' as const, strictProvenance: true },
        { accessTier: 'SENSITIVE' as const, strictProvenance: false },
      ]) {
        const r = validate(load(), options);
        expect(r.hasProvenanceProfile, JSON.stringify(options)).toBe(false);
        expect(provenanceIssues(r.issues), JSON.stringify(options)).toEqual([]);
        // The other layers are unaffected by the strict flip: zero issues, still ok.
        expect(r.ok, JSON.stringify(options)).toBe(true);
      }
    });
  }

  it('non-object input reports hasProvenanceProfile false', () => {
    expect(validate(42).hasProvenanceProfile).toBe(false);
  });
});

describe('(h) opt-in and the deprecated v0.1 mechanics (spec section 2)', () => {
  it('the conformance target opts the layer in as an array element', () => {
    const m = sensitiveManifest();
    expect(m['dct:conformsTo']).toEqual([CONFORMS_TO.croissant11, PROVENANCE_CONFORMANCE_TARGET]);
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(r.hasProvenanceProfile).toBe(true);
    expect(r.conformance).toBe('croissant-1.1');
    expect(r.issues).toEqual([]);
  });

  it('the conformance target opts the layer in as a bare string', () => {
    const m = sensitiveManifest();
    m['dct:conformsTo'] = PROVENANCE_CONFORMANCE_TARGET;
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(r.hasProvenanceProfile).toBe(true);
    // No Croissant target left, so the base layer no longer knows the version:
    // the opt-in is independent of it.
    expect(r.conformance).toBe('unknown');
    expect(provenanceIssues(r.issues)).toEqual([]);
  });

  it('the deprecated marker still opts in and warns, in strict and permissive mode alike', () => {
    for (const strictProvenance of [true, false]) {
      const m = sensitiveManifest();
      m['dct:conformsTo'] = CONFORMS_TO.croissant11;
      m['bio:provenanceProfile'] = 'bio-prov/0.1';
      const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance });
      expect(r.hasProvenanceProfile, String(strictProvenance)).toBe(true);
      const marker = r.issues.find((i) => i.code === 'provenance.deprecated.marker');
      expect(marker?.level, String(strictProvenance)).toBe('warning');
      expect(marker?.path).toBe('/provenanceProfile');
      expect(marker?.message).toContain(PROVENANCE_CONFORMANCE_TARGET);
      // A warning never fails the manifest, and the obligations still ran.
      expect(codes(provenanceIssues(r.issues))).toEqual(['provenance.deprecated.marker']);
      expect(r.ok).toBe(true);
    }
  });

  it('a leftover bio:activityKind warns and no longer identifies a write-back (A1)', () => {
    const m = sensitiveManifest();
    const writeBack = writeBackOf(m);
    const activity = writeBack['prov:wasGeneratedBy'] as Json;
    activity['@type'] = 'prov:Activity';
    activity['bio:activityKind'] = 'ANNOTATION_CAMPAIGN';
    const index = (m['distribution'] as Json[]).findIndex((d) => d['@id'] === WRITE_BACK_ID);
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    const deprecated = r.issues.filter((i) => i.code === 'provenance.deprecated.activityKind');
    expect(deprecated).toHaveLength(1);
    expect(deprecated[0]?.level).toBe('warning');
    expect(deprecated[0]?.path).toBe(`/distribution/${index}/wasGeneratedBy/activityKind`);
    // A1–A3 no longer see the distribution: the DPV type is what identifies it.
    const detailed = validateProvenanceDetailed(normalize(m) as Json, {
      accessTier: 'SENSITIVE',
      strict: true,
    });
    for (const id of ['A1', 'A2', 'A3']) {
      expect(detailed.report.find((e) => e.id === id)?.status, id).toBe('not_applicable');
    }
    expect(r.ok).toBe(true);
  });
});

describe('(i) ODRL attachment points (spec section 5.5)', () => {
  const policy = {
    '@type': ['CreativeWork', 'odrl:Set'],
    '@id': '#policy-cc-by',
    'odrl:profile': 'http://w3.org/ns/odrl/2/ai',
    'odrl:permission': [
      {
        'odrl:action': ['odrl:use', 'odrl:distribute'],
        'odrl:target': 'the-dataset',
        'odrl:duty': [{ 'odrl:action': 'odrl:attribute' }],
      },
    ],
  };

  it('a usageInfo odrl:Set with an odrl:profile validates', () => {
    const m = sensitiveManifest();
    m['sc:usageInfo'] = policy;
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(r.issues, JSON.stringify(r.issues, null, 2)).toEqual([]);
  });

  it('a usageInfo odrl:Offer, bare key, validates too', () => {
    const m = sensitiveManifest();
    m['usageInfo'] = { ...policy, '@type': 'odrl:Offer' };
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(r.issues, JSON.stringify(r.issues, null, 2)).toEqual([]);
  });

  it('Croissant 1.1 hasOffer is still accepted, alongside usageInfo', () => {
    const m = sensitiveManifest();
    m['sc:usageInfo'] = policy;
    m['odrl:hasOffer'] = {
      '@type': 'odrl:Offer',
      '@id': '#offer-cc-by',
      'odrl:permission': [{ 'odrl:action': ['odrl:use'], 'odrl:target': 'the-dataset' }],
    };
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(r.issues, JSON.stringify(r.issues, null, 2)).toEqual([]);
  });

  it('a usageInfo that is not a policy is reported by the croissant11 layer', () => {
    const m = sensitiveManifest();
    m['sc:usageInfo'] = { '@type': 'CreativeWork', 'odrl:permission': [] };
    const r = validate(m);
    const issue = r.issues.find((i) => i.path.startsWith('/usageInfo'));
    expect(issue?.code.startsWith('croissant11.')).toBe(true);
  });
});

describe('(j) H6b — the annotation activity (spec section 5, H6b)', () => {
  function withoutAnnotationActivity(): Json {
    const m = sensitiveManifest();
    m['prov:wasGeneratedBy'] = [collectionActivityOf(m)];
    (m['distribution'] as Json[]).pop();
    return m;
  }

  it('missing at SENSITIVE is an error', () => {
    const r = validate(withoutAnnotationActivity(), {
      accessTier: 'SENSITIVE',
      strictProvenance: true,
    });
    const h6b = r.issues.filter((i) => i.code === 'provenance.missing.H6b');
    expect(h6b).toHaveLength(1);
    expect(h6b[0]?.level).toBe('error');
    expect(h6b[0]?.path).toBe('/wasGeneratedBy');
    expect(r.ok).toBe(false);
  });

  it('missing at CONTROLLED is an error, at REGISTERED a warning, at OPEN silent', () => {
    const m = withoutAnnotationActivity();
    expect(
      validate(m, { accessTier: 'CONTROLLED', strictProvenance: true }).issues.find(
        (i) => i.code === 'provenance.missing.H6b',
      )?.level,
    ).toBe('error');
    expect(
      validate(m, { accessTier: 'REGISTERED', strictProvenance: true }).issues.find(
        (i) => i.code === 'provenance.missing.H6b',
      )?.level,
    ).toBe('warning');
    const open = validate(m, { accessTier: 'OPEN', strictProvenance: true });
    expect(open.issues.some((i) => i.code.endsWith('.H6b'))).toBe(false);
  });

  it('a guideline without an @id does not satisfy H6b → provenance.invalid.H6b.used', () => {
    const m = sensitiveManifest();
    const labelling = (m['prov:wasGeneratedBy'] as Json[])[1] as Json;
    labelling['prov:used'] = { '@type': 'prov:Entity', name: 'A guideline with no identifier' };
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    const issue = r.issues.find((i) => i.code === 'provenance.invalid.H6b.used');
    expect(issue?.level).toBe('error');
    expect(issue?.path).toBe('/wasGeneratedBy/1/used');
  });

  it('an agent without prov:hadRole does not satisfy H6b → provenance.invalid.H6b.hadRole', () => {
    const m = sensitiveManifest();
    const labelling = (m['prov:wasGeneratedBy'] as Json[])[1] as Json;
    (labelling['prov:wasAssociatedWith'] as Json[])[1] = {
      '@type': 'prov:Person',
      name: 'Someone',
    };
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    const issue = r.issues.find((i) => i.code === 'provenance.invalid.H6b.hadRole');
    expect(issue?.path).toBe('/wasGeneratedBy/1/wasAssociatedWith/1/hadRole');
  });

  it('the campaign activity of a write-back can satisfy H6b on its own', () => {
    const m = sensitiveManifest();
    m['prov:wasGeneratedBy'] = [collectionActivityOf(m)];
    const campaign = writeBackOf(m)['prov:wasGeneratedBy'] as Json;
    campaign['prov:used'] = {
      '@type': 'prov:Entity',
      '@id': '#guideline-cxr-v3',
      name: 'CXR pneumonia reading guideline',
      version: '3',
    };
    campaign['prov:wasAssociatedWith'] = [
      {
        '@type': 'prov:SoftwareAgent',
        name: 'oci-annotation',
        'prov:hadRole': 'Annotation tool',
      },
    ];
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(r.issues, JSON.stringify(r.issues, null, 2)).toEqual([]);
  });
});

/**
 * (k) The point of #519: a manifest written the way the Croissant
 * Responsible AI specification's own worked examples are written — an
 * instant-timed collection activity typed with a DPV AI type, a labelling
 * activity with a guideline and agent roles, an ODRL policy on
 * `usageInfo` with an `odrl:profile`, and RAI attributes under both the
 * old and the new spellings — validates clean.
 */
describe('(k) the RAI specification’s own worked-example shapes', () => {
  function raiStyleManifest(): Json {
    return {
      '@context': {
        '@vocab': 'https://schema.org/',
        sc: 'https://schema.org/',
        cr: 'http://mlcommons.org/croissant/',
        rai: 'http://mlcommons.org/croissant/RAI/',
        prov: 'http://www.w3.org/ns/prov#',
        odrl: 'http://www.w3.org/ns/odrl/2/',
        dct: 'http://purl.org/dc/terms/',
      },
      '@type': 'sc:Dataset',
      'dct:conformsTo': [
        'http://mlcommons.org/croissant/1.1',
        'http://mlcommons.org/croissant/RAI/',
        PROVENANCE_CONFORMANCE_TARGET,
      ],
      name: 'Retinal screening cohort (RAI-style example)',
      description:
        'A worked example in the shapes the Croissant Responsible AI specification uses: DPV-typed activities, an instant time, agent roles and a usageInfo policy.',
      license: 'https://creativecommons.org/licenses/by/4.0/',
      url: 'https://example.org/datasets/rai-style',
      creator: { '@type': 'sc:Organization', name: 'Example Eye Hospital' },
      datePublished: '2026-09-01',
      'cr:version': '1.0.0',
      'prov:wasAttributedTo': [
        {
          '@type': 'prov:Organization',
          '@id': 'https://ror.org/00000000',
          name: 'Example Eye Hospital',
        },
      ],
      'prov:wasGeneratedBy': [
        {
          '@type': ['prov:Activity', DPV_AI_DATA_COLLECTION],
          '@id': '#collection',
          name: 'Retinal screening data collection',
          'prov:atTime': '2025-11-14',
          'prov:wasAssociatedWith': {
            '@type': 'prov:Organization',
            name: 'Example Eye Hospital',
          },
        },
        {
          '@type': ['prov:Activity', DPV_AI_DATA_LABELLING],
          '@id': '#labelling',
          name: 'Grading of the screening images',
          'prov:atTime': '2026-01-20',
          'prov:used': {
            '@type': 'prov:Entity',
            '@id': 'https://example.org/guidelines/icdr',
            name: 'ICDR grading guideline',
            version: '2018',
          },
          'prov:wasAssociatedWith': [
            { '@type': 'prov:Person', '@id': '#grader-pool', 'prov:hadRole': 'Annotator' },
            { '@type': 'prov:Person', '@id': '#senior', 'prov:hadRole': 'Adjudicator' },
          ],
        },
      ],
      'sc:usageInfo': {
        '@type': ['CreativeWork', 'odrl:Set'],
        '@id': '#policy',
        'odrl:profile': 'http://w3.org/ns/odrl/2/ai',
        'odrl:permission': [{ 'odrl:action': ['odrl:use'], 'odrl:target': 'rai-style' }],
      },
      'rai:dataCollection': 'Consecutive screening visits at one site.',
      'rai:dataLimitations': 'One site, one camera model.',
      'rai:dataBiases': 'Adults only; no paediatric images.',
      'rai:personalSensitiveInformation': 'None: images are anonymised at capture.',
      'rai:dataUseCases': 'Referable-DR triage evaluation.',
      // The renamed spellings from the RAI attribute table.
      'rai:dataMaintenancePlan': 'Reviewed annually; superseded versions stay resolvable.',
      'rai:socialImpact': 'Supports triage in settings with few ophthalmologists.',
      'bio:labelProtocol': {
        version: 'ICDR grading guideline 2018',
        labelScale: 'ICDR 0–4; referable ≥ 2',
        gradersPerItem: 2,
      },
    };
  }

  it('validates with zero errors at OPEN in strict mode', () => {
    const r = validate(raiStyleManifest(), { accessTier: 'OPEN', strictProvenance: true });
    expect(
      r.issues.filter((i) => i.level === 'error'),
      JSON.stringify(r.issues, null, 2),
    ).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.hasProvenanceProfile).toBe(true);
    expect(r.hasRai).toBe(true);
    expect(r.conformance).toBe('croissant-1.1');
  });

  it('has nothing to report at all at OPEN — not even a warning', () => {
    const r = validate(raiStyleManifest(), { accessTier: 'OPEN', strictProvenance: true });
    expect(r.issues, JSON.stringify(r.issues, null, 2)).toEqual([]);
  });

  it('is conformant up to CONTROLLED on the annotation requirements (H6, H6b)', () => {
    const r = validate(raiStyleManifest(), { accessTier: 'CONTROLLED', strictProvenance: true });
    const prov = provenanceIssues(r.issues);
    expect(prov.some((i) => i.code.endsWith('.H2'))).toBe(false);
    expect(prov.some((i) => i.code.endsWith('.H6'))).toBe(false);
    expect(prov.some((i) => i.code.endsWith('.H6b'))).toBe(false);
  });

  it('extractProvenance reads the instant time and the guideline-backed protocol', () => {
    const summary = extractProvenance(raiStyleManifest());
    expect(summary.timeframe).toEqual({ start: '2025-11-14', end: '2025-11-14' });
    expect(summary.sourceOrganizations).toEqual(['Example Eye Hospital']);
    expect(summary.labelProtocolVersion).toBe('ICDR grading guideline 2018');
    expect(summary.collectionTimeframeText).toBeNull();
  });
});

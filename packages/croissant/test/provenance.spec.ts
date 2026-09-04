import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
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
 * `bio-prov` v0.1 provenance layer (#495, ADR-0022,
 * docs/standards/bio-prov-v0.1.md). Cases:
 *
 *   (a) the seeded IDRiD fixture WITH the marker added in-test;
 *   (b) a synthetic SENSITIVE manifest missing H5;
 *   (c) an H4 resultingLevel / anonymizationLevel mismatch;
 *   (d) a prov:Activity whose endedAtTime precedes startedAtTime;
 *   (e) a campaign write-back distribution missing bio:integrity;
 *   (f) extractProvenance on the IDRiD fixture;
 *   (g) manifests without the marker are untouched.
 *
 * The seed fixture itself is not modified here: another change owns the
 * marker on the seeded manifest (#490).
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

function idridWithMarker(): Json {
  const m = loadJson(path.join(seedFixturesDir, 'idrid-grading-demo', 'manifest.json'));
  m['bio:provenanceProfile'] = 'bio-prov/0.1';
  return m;
}

function codes(issues: ReadonlyArray<{ code: string }>): string[] {
  return issues.map((i) => i.code).sort();
}

function provenanceIssues<T extends { code: string }>(issues: ReadonlyArray<T>): T[] {
  return issues.filter((i) => i.code.startsWith('provenance.'));
}

const WRITE_BACK_ID = 'campaign-7f3a-annotations.jsonl';

/**
 * A synthetic clinical dataset that is conformant at SENSITIVE: every
 * MUST in spec section 3 is met, including the annotation-campaign edge
 * on one write-back distribution. Built on the BIOCroissant fixture,
 * which already carries P1, H2, H3 (manufacturer), H5 and
 * `anonymizationLevel: DEIDENTIFIED`.
 */
function sensitiveManifest(): Json {
  const m = fixture('valid-biocroissant-1.1.json');
  m['bio:provenanceProfile'] = 'bio-prov/0.1';
  m['prov:wasAttributedTo'] = [
    { '@type': 'prov:Organization', '@id': 'https://ror.org/00000000', name: 'Test Hospital' },
  ];
  m['prov:wasGeneratedBy'] = {
    '@type': 'prov:Activity',
    '@id': '#collection-2024',
    name: 'Prospective collection of chest radiographs',
    'prov:startedAtTime': '2024-01-01',
    'prov:endedAtTime': '2024-12-31',
    'prov:wasAssociatedWith': { '@type': 'prov:Organization', name: 'Test Hospital' },
  };
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
      '@type': 'prov:Activity',
      '@id': 'urn:oci:campaign:7f3a',
      'bio:activityKind': 'ANNOTATION_CAMPAIGN',
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

describe('(a) seeded IDRiD fixture with the marker added in-test', () => {
  it('validates with zero errors at OPEN in strict mode', () => {
    const r = validate(idridWithMarker(), { accessTier: 'OPEN', strictProvenance: true });
    expect(r.hasProvenanceProfile).toBe(true);
    expect(
      r.issues.filter((i) => i.level === 'error'),
      JSON.stringify(r.issues, null, 2),
    ).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('at OPEN strict, reports only the SHOULDs the fixture does not yet fill (H2, H6) as warnings', () => {
    const r = validate(idridWithMarker(), { accessTier: 'OPEN', strictProvenance: true });
    const prov = provenanceIssues(r.issues);
    // The fixture has no rai:dataCollectionTimeframe and no bio:labelProtocol.
    expect(codes(prov)).toEqual(['provenance.missing.H2', 'provenance.missing.H6']);
    for (const issue of prov) expect(issue.level).toBe('warning');
    // H1 / H3 / H4 / H5 are MAY at OPEN: never reported as missing.
    // H4 stays MAY because the level is ANONYMIZED (footnote 2).
    for (const id of ['H1', 'H3', 'H4', 'H5']) {
      expect(
        prov.some((i) => i.code.endsWith(`.${id}`)),
        id,
      ).toBe(false);
    }
  });

  it('at REGISTERED strict, H1 / H3 / H4 / H5 surface as SHOULD-level warnings and H2 / H6 as errors', () => {
    const r = validate(idridWithMarker(), { accessTier: 'REGISTERED', strictProvenance: true });
    const prov = provenanceIssues(r.issues);
    const byCode = new Map(prov.map((i) => [i.code, i.level]));
    expect(byCode.get('provenance.missing.H1')).toBe('warning');
    expect(byCode.get('provenance.missing.H3')).toBe('warning');
    expect(byCode.get('provenance.missing.H4')).toBe('warning');
    expect(byCode.get('provenance.missing.H5')).toBe('warning');
    expect(byCode.get('provenance.missing.H2')).toBe('error');
    expect(byCode.get('provenance.missing.H6')).toBe('error');
    // P1–P4 are met by the fixture (derived slice with a dated activity).
    for (const id of ['P1', 'P2', 'P3', 'P4']) {
      expect(
        prov.some((i) => i.code.includes(`.${id}`)),
        id,
      ).toBe(false);
    }
  });

  it('the default (permissive, OPEN) reports nothing for the fixture', () => {
    const r = validate(idridWithMarker());
    expect(r.hasProvenanceProfile).toBe(true);
    expect(provenanceIssues(r.issues)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('permissive mode reports a MUST one level down, as a warning', () => {
    // At REGISTERED, H2 and H6 are MUSTs: errors strict, warnings permissive.
    const permissive = validate(idridWithMarker(), { accessTier: 'REGISTERED' });
    const prov = provenanceIssues(permissive.issues);
    expect(codes(prov)).toEqual(['provenance.missing.H2', 'provenance.missing.H6']);
    for (const issue of prov) expect(issue.level).toBe('warning');
    expect(permissive.ok).toBe(true);
  });

  it('the per-requirement report marks P3 applicable (derived) and A1–A3 not applicable', () => {
    const normalized = normalize(idridWithMarker()) as Json;
    const detailed = validateProvenanceDetailed(normalized, { accessTier: 'OPEN', strict: true });
    const status = new Map(detailed.report.map((e) => [e.id, e.status]));
    expect(status.get('P1')).toBe('satisfied');
    expect(status.get('P2')).toBe('satisfied');
    expect(status.get('P3')).toBe('satisfied');
    expect(status.get('P4')).toBe('satisfied');
    expect(status.get('A1')).toBe('not_applicable');
    expect(status.get('A2')).toBe('not_applicable');
    expect(status.get('A3')).toBe('not_applicable');
  });

  it('parses against ProvenanceProfileSchema once normalized', () => {
    const r = ProvenanceProfileSchema.safeParse(normalize(idridWithMarker()));
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

  it('missing H5 is a warning at SENSITIVE in permissive mode (the default)', () => {
    const m = sensitiveManifest();
    delete m['bio:irbApproval'];
    const r = validate(m, { accessTier: 'SENSITIVE' });
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

  it('a wrong profile version is reported as malformed', () => {
    const m = sensitiveManifest();
    m['bio:provenanceProfile'] = 'bio-prov/0.9';
    const r = validate(m, { accessTier: 'OPEN', strictProvenance: true });
    const marker = r.issues.find((i) => i.code === 'provenance.invalid.provenanceProfile');
    expect(marker?.level).toBe('error');
    expect(marker?.path).toBe('/provenanceProfile');
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
    const permissive = validate(m, { accessTier: 'OPEN' });
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

describe('(d) malformed prov:Activity dates', () => {
  it('endedAtTime before startedAtTime → provenance.invalid.P2.endedAtTime', () => {
    const m = sensitiveManifest();
    const activity = m['prov:wasGeneratedBy'] as Json;
    activity['prov:startedAtTime'] = '2024-12-31';
    activity['prov:endedAtTime'] = '2024-01-01';
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    const issue = r.issues.find((i) => i.code === 'provenance.invalid.P2.endedAtTime');
    expect(issue?.level).toBe('error');
    expect(issue?.path).toBe('/wasGeneratedBy/endedAtTime');
    expect(codes(provenanceIssues(r.issues))).toEqual(['provenance.invalid.P2.endedAtTime']);
  });

  it('a non-ISO date → provenance.invalid.P2.startedAtTime', () => {
    const m = sensitiveManifest();
    (m['prov:wasGeneratedBy'] as Json)['prov:startedAtTime'] = 'March 2024';
    const r = validate(m, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(codes(provenanceIssues(r.issues))).toEqual(['provenance.invalid.P2.startedAtTime']);
  });

  it('paths index into an array of activities', () => {
    const m = sensitiveManifest();
    const activity = m['prov:wasGeneratedBy'] as Json;
    delete activity['prov:endedAtTime'];
    m['prov:wasGeneratedBy'] = ['https://example.org/some-activity', activity];
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
    const permissive = validate(m, { accessTier: 'SENSITIVE' });
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
  it('reads the IDRiD fixture: DOI in derivedFrom, the attributed organizations, the slice timeframe', () => {
    const summary = extractProvenance(idridWithMarker());
    expect(summary.derivedFrom).toEqual(['https://doi.org/10.3390/data3030025']);
    expect(summary.sourceOrganizations).toEqual([
      'IDRiD consortium (Porwal et al., 2018) — source images captured at an eye clinic in Nanded, Maharashtra, India',
      'OCI Platform (GI-AI4H) — re-publisher of the demo slice',
    ]);
    expect(summary.timeframe).toEqual({
      start: '2026-07-30T00:00:00Z',
      end: '2026-07-30T00:00:00Z',
    });
    // Not in the fixture yet (#490 owns enriching it).
    expect(summary.sites).toEqual([]);
    expect(summary.deviceClasses).toEqual([]);
    expect(summary.deidentification).toBeNull();
    expect(summary.ethicsApproval).toBeNull();
    expect(summary.labelProtocolVersion).toBeNull();
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

describe('(g) manifests without the marker', () => {
  const cases: Array<[string, () => Json]> = [
    [
      'seeded idrid-grading-demo',
      () => loadJson(path.join(seedFixturesDir, 'idrid-grading-demo', 'manifest.json')),
    ],
    [
      'seeded oci-demo-chest-xr',
      () => loadJson(path.join(seedFixturesDir, 'oci-demo-chest-xr', 'manifest.json')),
    ],
    ['valid-biocroissant-1.1', () => fixture('valid-biocroissant-1.1.json')],
    ['valid-croissant-1.0', () => fixture('valid-croissant-1.0.json')],
  ];

  for (const [name, load] of cases) {
    it(`${name}: hasProvenanceProfile is false and no provenance.* issue is emitted`, () => {
      for (const options of [
        undefined,
        { accessTier: 'SENSITIVE' as const, strictProvenance: true },
      ]) {
        const r = validate(load(), options);
        expect(r.hasProvenanceProfile).toBe(false);
        expect(provenanceIssues(r.issues)).toEqual([]);
      }
    });
  }

  it('non-object input reports hasProvenanceProfile false', () => {
    expect(validate(42).hasProvenanceProfile).toBe(false);
  });
});

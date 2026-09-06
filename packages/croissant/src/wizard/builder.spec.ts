import { describe, expect, it } from 'vitest';
import {
  emptyManifestWizardProvenance,
  type ManifestWizardInput,
  type ManifestWizardProvenance,
} from '@oci/shared-types';
import { validate } from '../validator/index.js';
import { manifestWizardInputToCroissant } from './builder.js';

function baseInput(overrides: Partial<ManifestWizardInput> = {}): ManifestWizardInput {
  return {
    conformsTo: 'http://mlcommons.org/croissant/1.1',
    name: 'Test dataset',
    description: 'A short description suitable for testing the wizard builder.',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    homepage: 'https://example.org/',
    citeAs: undefined,
    version: '1.0.0',
    datePublished: '2026-05-08',
    creators: [{ type: 'Person', name: 'Test Author' }],
    imagingModality: [],
    bodyRegion: [],
    diseaseCondition: [],
    anonymizationLevel: undefined,
    duoTerms: [],
    distributions: [],
    notes: undefined,
    ...overrides,
  };
}

describe('manifestWizardInputToCroissant', () => {
  it('produces a manifest that passes the Croissant 1.1 validator', () => {
    const out = manifestWizardInputToCroissant(baseInput());
    const result = validate(out);
    expect(result.ok).toBe(true);
    expect(result.conformance).toBe('croissant-1.1');
  });

  it('includes biomedical fields when populated', () => {
    const out = manifestWizardInputToCroissant(
      baseInput({
        imagingModality: ['X-ray'],
        bodyRegion: ['Chest'],
        diseaseCondition: ['Pneumonia'],
        anonymizationLevel: 'ANONYMIZED',
      }),
    );
    expect(out['bio:imagingModality']).toEqual([{ name: 'X-ray' }]);
    expect(out['bio:bodyRegion']).toEqual([{ name: 'Chest' }]);
    expect(out['bio:diseaseCondition']).toEqual([{ name: 'Pneumonia' }]);
    expect(out['bio:anonymizationLevel']).toBe('ANONYMIZED');
  });

  it('omits biomedical fields when empty', () => {
    const out = manifestWizardInputToCroissant(baseInput());
    expect(out['bio:imagingModality']).toBeUndefined();
    expect(out['bio:bodyRegion']).toBeUndefined();
    expect(out['bio:diseaseCondition']).toBeUndefined();
    expect(out['bio:anonymizationLevel']).toBeUndefined();
  });

  it('encodes DUO terms as DefinedTerm references with OBO IRI + termCode', () => {
    const out = manifestWizardInputToCroissant(
      baseInput({ duoTerms: ['DUO_0000042', 'DUO_0000021'] }),
    );
    expect(out.consentCode).toEqual([
      {
        '@type': 'sc:DefinedTerm',
        '@id': 'http://purl.obolibrary.org/obo/DUO_0000042',
        termCode: 'DUO_0000042',
      },
      {
        '@type': 'sc:DefinedTerm',
        '@id': 'http://purl.obolibrary.org/obo/DUO_0000021',
        termCode: 'DUO_0000021',
      },
    ]);
  });

  it('encodes distributions as FileObjects', () => {
    const out = manifestWizardInputToCroissant(
      baseInput({
        distributions: [
          {
            croissantId: 'images-zip',
            name: 'images.zip',
            encodingFormat: 'application/zip',
            contentUrl: 'https://example.org/images.zip',
          },
        ],
      }),
    );
    expect(out.distribution).toEqual([
      {
        '@type': 'sc:FileObject',
        '@id': 'images-zip',
        name: 'images.zip',
        encodingFormat: 'application/zip',
        contentUrl: 'https://example.org/images.zip',
      },
    ]);
  });

  it('treats Organization creators differently from Person', () => {
    const out = manifestWizardInputToCroissant(
      baseInput({
        creators: [
          { type: 'Organization', name: 'University of Geneva' },
          { type: 'Person', name: 'Dr. Smith' },
        ],
      }),
    );
    expect(out.creator).toEqual([
      { '@type': 'sc:Organization', name: 'University of Geneva' },
      { '@type': 'sc:Person', name: 'Dr. Smith' },
    ]);
  });

  it('emits url from homepage; omits citeAs when undefined', () => {
    const out = manifestWizardInputToCroissant(
      baseInput({ homepage: 'https://example.org/', citeAs: undefined }),
    );
    expect(out.url).toBe('https://example.org/');
    expect(out.citeAs).toBeUndefined();
  });

  it('round-trips a full BioCroissant + DUO + distribution manifest through the validator', () => {
    const out = manifestWizardInputToCroissant(
      baseInput({
        imagingModality: ['X-ray'],
        bodyRegion: ['Chest'],
        diseaseCondition: ['Pneumonia'],
        anonymizationLevel: 'ANONYMIZED',
        duoTerms: ['DUO_0000042', 'DUO_0000021'],
        distributions: [
          {
            croissantId: 'metadata-csv',
            name: 'metadata.csv',
            encodingFormat: 'text/csv',
            contentUrl: 'https://example.org/metadata.csv',
          },
        ],
      }),
    );
    const result = validate(out);
    expect(result.ok).toBe(true);
  });

  it('omits the bio-prov profile entirely when the provenance step was not visited', () => {
    const out = manifestWizardInputToCroissant(baseInput());
    expect(out['bio:provenanceProfile']).toBeUndefined();
    expect(out['prov:wasAttributedTo']).toBeUndefined();
    expect(validate(out, { accessTier: 'SENSITIVE', strictProvenance: true }).ok).toBe(true);
  });
});

/** Every block filled: what a SENSITIVE clinical dataset MUST carry (spec 10.2). */
function fullProvenance(): ManifestWizardProvenance {
  return {
    sourceOrganization: { name: 'University Hospital Zurich', id: 'https://ror.org/01462r250' },
    collection: {
      name: 'Prospective collection of fundus photographs at two sites',
      startedAt: '2019-03-01',
      endedAt: '2021-11-30',
      agentName: '',
      agentIsSoftware: false,
    },
    derivedFrom: '',
    sites: [
      { name: 'USZ Ophthalmology', country: 'CH' },
      { name: 'Inselspital Bern', country: 'CH' },
    ],
    collectionTimeframe: 'March 2019 to November 2021',
    deviceClass: 'OP (ophthalmic photography)',
    equipment: { manufacturer: 'Topcon', model: 'TRC-NW8', softwareVersion: '' },
    deidentification: { method: 'SAFE_HARBOR', endedAt: '2024-05-02', toolName: 'deid-tool@2.1' },
    ethics: {
      approvingBody: 'Kantonale Ethikkommission Zürich',
      approvalNumber: 'BASEC 2019-00123',
      approvalDate: '2019-02-01',
      approvalScope: 'Covers evaluation of third-party AI models on the de-identified data.',
    },
    labelProtocol: {
      version: 'ICDR grading protocol 2018',
      labelScale: 'ICDR 0–4; referable ≥ 2',
      gradersPerItem: 2,
      graderQualification: 'ophthalmologist, >10 years',
      adjudication: 'third grader adjudicates disagreements',
      interRaterAgreement: { metric: 'quadratic-weighted kappa', value: 0.78 },
      perRaterLabelsRetained: false,
    },
  };
}

describe('manifestWizardInputToCroissant — bio-prov provenance (#496)', () => {
  it('a fully filled input validates at SENSITIVE with strict obligations and zero errors', () => {
    const out = manifestWizardInputToCroissant(
      baseInput({ anonymizationLevel: 'DEIDENTIFIED', provenance: fullProvenance() }),
    );
    const result = validate(out, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(result.hasProvenanceProfile).toBe(true);
    expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('emits the PROV-O shapes of spec section 4 with prefixed keys', () => {
    const out = manifestWizardInputToCroissant(
      baseInput({ anonymizationLevel: 'DEIDENTIFIED', provenance: fullProvenance() }),
    );
    expect(out['bio:provenanceProfile']).toBe('bio-prov/0.1');
    expect(out['prov:wasAttributedTo']).toEqual([
      {
        '@type': 'prov:Organization',
        '@id': 'https://ror.org/01462r250',
        name: 'University Hospital Zurich',
      },
    ]);
    expect(out['prov:wasGeneratedBy']).toEqual({
      '@type': 'prov:Activity',
      '@id': '#collection',
      name: 'Prospective collection of fundus photographs at two sites',
      'prov:startedAtTime': '2019-03-01',
      'prov:endedAtTime': '2021-11-30',
      // Blank agent → the source organisation ran the collection (spec P2 example).
      'prov:wasAssociatedWith': {
        '@type': 'prov:Organization',
        '@id': 'https://ror.org/01462r250',
        name: 'University Hospital Zurich',
      },
    });
    expect(out['prov:wasDerivedFrom']).toBeUndefined();
    expect(out['bio:sourceSite']).toEqual([
      { name: 'USZ Ophthalmology', country: 'CH' },
      { name: 'Inselspital Bern', country: 'CH' },
    ]);
    expect(out['rai:dataCollectionTimeframe']).toBe('March 2019 to November 2021');
    expect(out['bio:deviceClass']).toEqual({
      '@type': 'sc:DefinedTerm',
      name: 'OP (ophthalmic photography)',
    });
    expect(out['bio:dataAcquisitionEquipment']).toEqual({
      manufacturer: 'Topcon',
      model: 'TRC-NW8',
    });
    expect(out['bio:deidentification']).toEqual({
      '@type': 'prov:Activity',
      method: 'SAFE_HARBOR',
      resultingLevel: 'DEIDENTIFIED',
      'prov:endedAtTime': '2024-05-02',
      'prov:wasAssociatedWith': { '@type': 'prov:SoftwareAgent', name: 'deid-tool@2.1' },
    });
    expect(out['bio:irbApproval']).toEqual({
      approvingBody: 'Kantonale Ethikkommission Zürich',
      approvalNumber: 'BASEC 2019-00123',
      approvalDate: '2019-02-01',
      approvalScope: 'Covers evaluation of third-party AI models on the de-identified data.',
    });
    expect(out['bio:labelProtocol']).toEqual({
      version: 'ICDR grading protocol 2018',
      labelScale: 'ICDR 0–4; referable ≥ 2',
      graderQualification: 'ophthalmologist, >10 years',
      adjudication: 'third grader adjudicates disagreements',
      gradersPerItem: 2,
      interRaterAgreement: { metric: 'quadratic-weighted kappa', value: 0.78 },
      perRaterLabelsRetained: false,
    });
  });

  it('a minimal OPEN input (organisation + dated activity) validates with zero errors', () => {
    const provenance = emptyManifestWizardProvenance();
    provenance.sourceOrganization.name = 'Source institution';
    provenance.collection.name = 'Retrospective export';
    provenance.collection.startedAt = '2020-01-01';
    provenance.collection.endedAt = '2020-12-31';
    const out = manifestWizardInputToCroissant(
      baseInput({ anonymizationLevel: 'ANONYMIZED', provenance }),
    );
    const result = validate(out, { accessTier: 'OPEN', strictProvenance: true });
    expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
    // Only the health qualifiers that are SHOULD at OPEN are reported, as warnings.
    expect(result.issues.map((i) => i.code).sort()).toEqual([
      'provenance.missing.H2',
      'provenance.missing.H6',
    ]);
    // Nothing blank leaks into the manifest.
    expect(out['bio:sourceSite']).toBeUndefined();
    expect(out['bio:deidentification']).toBeUndefined();
    expect(out['bio:irbApproval']).toBeUndefined();
    expect(out['bio:labelProtocol']).toBeUndefined();
  });

  it('a missing ethics block at SENSITIVE yields provenance.missing.H5 as an error', () => {
    const provenance = fullProvenance();
    provenance.ethics = {
      approvingBody: '',
      approvalNumber: '',
      approvalDate: '',
      approvalScope: '',
    };
    const out = manifestWizardInputToCroissant(
      baseInput({ anonymizationLevel: 'DEIDENTIFIED', provenance }),
    );
    const result = validate(out, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'provenance.missing.H5',
        level: 'error',
        path: '/irbApproval',
      }),
    ]);
  });

  it('a derived dataset emits wasDerivedFrom as a prov:Entity and the activity `used` it', () => {
    const provenance = fullProvenance();
    provenance.derivedFrom = 'https://doi.org/10.3390/data3030025';
    provenance.collection.name = 'Class-stratified 30-image slice';
    provenance.collection.agentName = 'generate.mjs';
    provenance.collection.agentIsSoftware = true;
    const out = manifestWizardInputToCroissant(
      baseInput({ anonymizationLevel: 'ANONYMIZED', provenance }),
    );
    expect(out['prov:wasDerivedFrom']).toEqual({
      '@type': 'prov:Entity',
      '@id': 'https://doi.org/10.3390/data3030025',
    });
    const activity = out['prov:wasGeneratedBy'] as Record<string, unknown>;
    expect(activity['@id']).toBe('#derivation');
    expect(activity['prov:used']).toBe('https://doi.org/10.3390/data3030025');
    expect(activity['prov:wasAssociatedWith']).toEqual({
      '@type': 'prov:SoftwareAgent',
      name: 'generate.mjs',
      'prov:actedOnBehalfOf': {
        '@type': 'prov:Organization',
        '@id': 'https://ror.org/01462r250',
        name: 'University Hospital Zurich',
      },
    });
    const result = validate(out, { accessTier: 'CONTROLLED', strictProvenance: true });
    expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('keeps resultingLevel equal to the anonymisation level, whatever the method', () => {
    const provenance = fullProvenance();
    provenance.deidentification.method = 'PSEUDONYMISATION';
    const out = manifestWizardInputToCroissant(
      baseInput({ anonymizationLevel: 'LIMITED', provenance }),
    );
    expect((out['bio:deidentification'] as Record<string, unknown>).resultingLevel).toBe('LIMITED');
    expect(out['bio:anonymizationLevel']).toBe('LIMITED');
    const result = validate(out, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(result.issues.filter((i) => i.code.startsWith('provenance.mismatch'))).toEqual([]);
  });

  it('a partially filled block is emitted as-is so the validator names the missing field', () => {
    const provenance = fullProvenance();
    provenance.ethics.approvalNumber = '';
    const out = manifestWizardInputToCroissant(
      baseInput({ anonymizationLevel: 'DEIDENTIFIED', provenance }),
    );
    const result = validate(out, { accessTier: 'SENSITIVE', strictProvenance: true });
    expect(result.issues.map((i) => i.code)).toContain('provenance.invalid.H5.approvalNumber');
  });
});

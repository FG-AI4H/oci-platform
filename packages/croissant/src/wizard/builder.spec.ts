import { describe, expect, it } from 'vitest';
import type { ManifestWizardInput } from '@oci/shared-types';
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
});

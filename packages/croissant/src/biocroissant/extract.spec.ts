import { describe, expect, it } from 'vitest';
import { extractModalities } from './extract.js';

describe('extractModalities', () => {
  it('returns [] for an empty / non-object input', () => {
    expect(extractModalities(null)).toEqual([]);
    expect(extractModalities(undefined)).toEqual([]);
    expect(extractModalities('not-a-manifest')).toEqual([]);
    expect(extractModalities({})).toEqual([]);
  });

  it('reads `bio:imagingModality` as array of DefinedTerm', () => {
    const manifest = {
      'bio:imagingModality': [
        { '@type': 'sc:DefinedTerm', name: 'X-ray' },
        { '@type': 'sc:DefinedTerm', name: 'CT' },
      ],
    };
    expect(extractModalities(manifest)).toEqual(['X-ray', 'CT']);
  });

  it('reads the bare-key `imagingModality` (post-normalise form)', () => {
    expect(
      extractModalities({
        imagingModality: [{ name: 'MRI' }],
      }),
    ).toEqual(['MRI']);
  });

  it('handles a single DefinedTerm (non-array) entry', () => {
    expect(
      extractModalities({
        'bio:imagingModality': { name: 'Fundus' },
      }),
    ).toEqual(['Fundus']);
  });

  it('falls back to termCode when name is absent', () => {
    expect(
      extractModalities({
        'bio:imagingModality': [{ termCode: 'X-ray' }],
      }),
    ).toEqual(['X-ray']);
  });

  it('reads `bio:dataModality` for non-imaging datasets', () => {
    expect(
      extractModalities({
        'bio:dataModality': [{ name: 'Text' }, { name: 'EHR' }],
      }),
    ).toEqual(['Text', 'EHR']);
  });

  it('merges + de-dupes across both keys', () => {
    expect(
      extractModalities({
        'bio:imagingModality': [{ name: 'CT' }],
        'bio:dataModality': [{ name: 'CT' }, { name: 'Text' }],
      }),
    ).toEqual(['CT', 'Text']);
  });

  it('accepts plain-string entries', () => {
    expect(
      extractModalities({
        'bio:imagingModality': ['X-ray', 'CT'],
      }),
    ).toEqual(['X-ray', 'CT']);
  });

  it('trims whitespace + skips empty entries', () => {
    expect(
      extractModalities({
        'bio:imagingModality': ['  CT  ', '', { name: '   ' }, { name: 'MRI' }],
      }),
    ).toEqual(['CT', 'MRI']);
  });

  it('ignores @id-only entries (URLs are not human-readable labels)', () => {
    expect(
      extractModalities({
        'bio:imagingModality': [{ '@id': 'http://radlex.org/RID10312' }],
      }),
    ).toEqual([]);
  });
});

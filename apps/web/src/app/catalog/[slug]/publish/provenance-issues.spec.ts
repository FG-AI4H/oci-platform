import { describe, expect, it } from 'vitest';
import { validate } from '@oci/croissant';
import {
  describeProvenanceIssue,
  isProvenanceCode,
  requirementIdOf,
  REQUIREMENT_LABEL,
} from './provenance-issues';

describe('provenance-issues (#496)', () => {
  it('names the requirement from the code and leaves the marker check unnamed', () => {
    expect(requirementIdOf('provenance.missing.H5')).toBe('H5');
    expect(requirementIdOf('provenance.invalid.P2.endedAtTime')).toBe('P2');
    expect(requirementIdOf('provenance.mismatch.H4.anonymizationLevel')).toBe('H4');
    expect(requirementIdOf('provenance.invalid.provenanceProfile')).toBeNull();
    expect(isProvenanceCode('provenance.missing.H5')).toBe(true);
    expect(isProvenanceCode('oci.j1.duo.missing-on-non-public')).toBe(false);
    expect(isProvenanceCode(undefined)).toBe(false);
  });

  it('shapes a missing MUST as "<id> · <label> is required for a <tier> dataset"', () => {
    const shaped = describeProvenanceIssue(
      {
        code: 'provenance.missing.H5',
        path: '/irbApproval',
        message: 'H5 (Ethics / IRB approval) is a MUST at SENSITIVE: …',
        level: 'error',
      },
      'SENSITIVE',
    );
    expect(shaped.requirementId).toBe('H5');
    expect(shaped.headline).toBe(
      'H5 · Ethics approval (IRB, institutional review board) is required for a SENSITIVE dataset',
    );
    expect(shaped.detail).toMatch(/MUST at SENSITIVE/);
  });

  it('words a missing SHOULD as recommended, a mismatch as a disagreement, an invalid as malformed', () => {
    expect(
      describeProvenanceIssue(
        { code: 'provenance.missing.H3', path: '/x', message: 'm', level: 'warning' },
        'CONTROLLED',
      ).headline,
    ).toBe(`H3 · ${REQUIREMENT_LABEL.H3} is recommended for a CONTROLLED dataset`);
    expect(
      describeProvenanceIssue(
        {
          code: 'provenance.mismatch.H4.anonymizationLevel',
          path: '/deidentification/resultingLevel',
          message: 'm',
          level: 'error',
        },
        'OPEN',
      ).headline,
    ).toBe(`H4 · ${REQUIREMENT_LABEL.H4} disagrees with another field`);
    expect(
      describeProvenanceIssue(
        { code: 'provenance.invalid.P2.endedAtTime', path: '/x', message: 'm', level: 'error' },
        'OPEN',
      ).headline,
    ).toBe(`P2 · ${REQUIREMENT_LABEL.P2} is present but incomplete or malformed`);
    expect(
      describeProvenanceIssue(
        { code: 'provenance.invalid.provenanceProfile', path: '/x', message: 'm', level: 'error' },
        'OPEN',
      ).headline,
    ).toBe('Provenance profile marker is present but incomplete or malformed');
  });

  it('every code the validator emits at SENSITIVE for an empty profile maps to a labelled requirement', () => {
    const result = validate(
      {
        '@context': { '@vocab': 'https://schema.org/', bio: 'x', prov: 'y' },
        '@type': 'sc:Dataset',
        'dct:conformsTo': 'http://mlcommons.org/croissant/1.1',
        name: 'n',
        description: 'd',
        license: 'l',
        url: 'https://example.org/',
        creator: [{ '@type': 'sc:Person', name: 'p' }],
        datePublished: '2026-01-01',
        'cr:version': '1.0.0',
        'bio:provenanceProfile': 'bio-prov/0.1',
      },
      { accessTier: 'SENSITIVE', strictProvenance: true },
    );
    const provenance = result.issues.filter((i) => isProvenanceCode(i.code));
    expect(provenance.length).toBeGreaterThan(0);
    for (const issue of provenance) {
      const shaped = describeProvenanceIssue(issue, 'SENSITIVE');
      expect(shaped.requirementId).not.toBeNull();
      expect(shaped.headline).toMatch(/^[PH]\d · .+ is required for a SENSITIVE dataset$/);
    }
  });
});

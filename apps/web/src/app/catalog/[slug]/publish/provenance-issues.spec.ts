import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import { validate } from '@oci/croissant';
import en from '../../../../i18n/messages/en';
import fr from '../../../../i18n/messages/fr';
import {
  describeProvenanceIssue,
  isProvenanceCode,
  requirementIdOf,
  translateProvenanceHeadline,
  REQUIREMENT_LABEL,
  type ProvenanceIssue,
} from './provenance-issues';

/** One issue per headline shape, for the translation checks. */
function sampleIssues(): ProvenanceIssue[] {
  const raw: Array<{ code: string; level: 'error' | 'warning'; tier: 'OPEN' | 'SENSITIVE' }> = [
    { code: 'provenance.missing.H5', level: 'error', tier: 'SENSITIVE' },
    { code: 'provenance.missing.H3', level: 'warning', tier: 'OPEN' },
    { code: 'provenance.mismatch.H4.anonymizationLevel', level: 'error', tier: 'OPEN' },
    { code: 'provenance.invalid.P2.endedAtTime', level: 'error', tier: 'OPEN' },
    { code: 'provenance.invalid.H6b', level: 'error', tier: 'OPEN' },
    { code: 'provenance.deprecated.marker', level: 'warning', tier: 'OPEN' },
    { code: 'provenance.deprecated.activityKind', level: 'warning', tier: 'OPEN' },
    { code: 'provenance.optIn', level: 'warning', tier: 'OPEN' },
  ];
  return raw.map((r) =>
    describeProvenanceIssue({ code: r.code, path: '/x', message: 'm', level: r.level }, r.tier),
  );
}

describe('provenance-issues (#496, #519)', () => {
  it('names the requirement from the code and leaves the deprecation notices unnamed', () => {
    expect(requirementIdOf('provenance.missing.H5')).toBe('H5');
    expect(requirementIdOf('provenance.missing.H6b')).toBe('H6b');
    expect(requirementIdOf('provenance.invalid.P2.endedAtTime')).toBe('P2');
    expect(requirementIdOf('provenance.mismatch.H4.anonymizationLevel')).toBe('H4');
    expect(requirementIdOf('provenance.deprecated.marker')).toBeNull();
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
        {
          code: 'provenance.deprecated.marker',
          path: '/provenanceProfile',
          message: 'm',
          level: 'warning',
        },
        'OPEN',
      ).headline,
    ).toBe('The bio:provenanceProfile marker is deprecated in bio-prov v0.2');
    expect(
      describeProvenanceIssue(
        {
          code: 'provenance.deprecated.activityKind',
          path: '/distribution/0/wasGeneratedBy/activityKind',
          message: 'm',
          level: 'warning',
        },
        'OPEN',
      ).headline,
    ).toBe('The bio:activityKind property is deprecated in bio-prov v0.2');
  });

  it('every code the validator emits at SENSITIVE for an empty profile maps to a labelled requirement', () => {
    const result = validate(
      {
        '@context': { '@vocab': 'https://schema.org/', bio: 'x', prov: 'y' },
        '@type': 'sc:Dataset',
        'dct:conformsTo': [
          'http://mlcommons.org/croissant/1.1',
          'https://oci.ai4h.net/biocroissant/bio-prov/0.2',
        ],
        name: 'n',
        description: 'd',
        license: 'l',
        url: 'https://example.org/',
        creator: [{ '@type': 'sc:Person', name: 'p' }],
        datePublished: '2026-01-01',
        'cr:version': '1.0.0',
      },
      { accessTier: 'SENSITIVE', strictProvenance: true },
    );
    const provenance = result.issues.filter((i) => isProvenanceCode(i.code));
    expect(provenance.length).toBeGreaterThan(0);
    for (const issue of provenance) {
      const shaped = describeProvenanceIssue(issue, 'SENSITIVE');
      expect(shaped.requirementId, issue.code).not.toBeNull();
      expect(shaped.headline).toMatch(/^[PH]\d[a-z]? · .+ is required for a SENSITIVE dataset$/);
    }
  });

  it('words the headline from the English catalogue exactly as `headline` does (#654)', () => {
    const t = createTranslator({ locale: 'en', messages: en, namespace: 'Provenance' });
    for (const issue of sampleIssues()) {
      expect(translateProvenanceHeadline(t, issue), issue.code).toBe(issue.headline);
    }
    for (const id of Object.keys(REQUIREMENT_LABEL) as Array<keyof typeof REQUIREMENT_LABEL>) {
      // eslint-disable-next-line security/detect-object-injection
      expect(t(`requirement.${id}`)).toBe(REQUIREMENT_LABEL[id]);
    }
  });

  it('words every headline shape in French, keeping the id and naming the tier in French', () => {
    const t = createTranslator({ locale: 'fr', messages: fr, namespace: 'Provenance' });
    const h5 = translateProvenanceHeadline(t, sampleIssues()[0]!);
    expect(h5).toBe(
      'H5 · Approbation éthique (IRB, comité d’éthique institutionnel) : obligatoire pour un jeu de données sensible',
    );
    for (const issue of sampleIssues()) {
      const text = translateProvenanceHeadline(t, issue);
      expect(text).not.toBe(issue.headline);
      expect(text).not.toMatch(/Provenance\.|issue\.|requirement\./);
    }
  });
});

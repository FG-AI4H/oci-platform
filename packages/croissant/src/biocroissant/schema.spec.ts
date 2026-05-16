import { describe, expect, it } from 'vitest';
import { BIOCROISSANT_PROPERTIES, BioCroissantSchema } from './schema.js';

describe('BioCroissantSchema — WHO-driven extensions (ADR-0013)', () => {
  it('accepts a minimal manifest with no new fields (backwards compatibility)', () => {
    const minimal = {
      imagingModality: [{ name: 'X-ray' }],
      anonymizationLevel: 'DEIDENTIFIED',
    };
    expect(() => BioCroissantSchema.parse(minimal)).not.toThrow();
  });

  it('parses consentBasis enum values', () => {
    for (const basis of [
      'EXPLICIT_INFORMED',
      'OPT_OUT',
      'RETROSPECTIVE_WAIVER',
      'ARCHIVAL_EXCEPTION',
      'PUBLIC_INTEREST',
      'ANONYMOUS_NO_CONSENT',
    ] as const) {
      expect(() => BioCroissantSchema.parse({ consentBasis: basis })).not.toThrow();
    }
    expect(() => BioCroissantSchema.parse({ consentBasis: 'IMPLIED' })).toThrow();
  });

  it('parses a lawful-basis cell with article refs + jurisdiction', () => {
    const manifest = {
      lawfulBasis: [
        {
          jurisdiction: 'DE',
          framework: 'GDPR',
          articleRefs: ['Art.6(1)(e)', 'Art.9(2)(j)'],
          notes: 'Public-interest research basis approved by Ethik-Kommission.',
        },
      ],
    };
    expect(() => BioCroissantSchema.parse(manifest)).not.toThrow();
  });

  it('rejects an invalid ISO-2 jurisdiction code', () => {
    const bad = {
      lawfulBasis: [{ jurisdiction: 'DEU', articleRefs: ['Art.6(1)(e)'] }],
    };
    expect(() => BioCroissantSchema.parse(bad)).toThrow();
  });

  it('accepts EHDS data permit + cross-border sharing fields', () => {
    const manifest = {
      ehdsDataPermitId: 'EHDS-DAB-DE-2026-00041',
      crossBorderSharingPermitted: true,
      jurisdictionsEligible: ['DE', 'FR', 'CH'],
    };
    expect(() => BioCroissantSchema.parse(manifest)).not.toThrow();
  });

  it('accepts data-controller / data-processor declarations', () => {
    const manifest = {
      dataController: {
        name: 'University Hospital Zürich',
        jurisdictionCountry: 'CH',
        contactEmail: 'dpo@usz.ch',
      },
      dataProcessor: {
        name: 'OCI Platform Operator',
        jurisdictionCountry: 'CH',
      },
    };
    expect(() => BioCroissantSchema.parse(manifest)).not.toThrow();
  });

  it('BIOCROISSANT_PROPERTIES lists all new fields for heuristic detection', () => {
    expect(BIOCROISSANT_PROPERTIES).toContain('consentBasis');
    expect(BIOCROISSANT_PROPERTIES).toContain('lawfulBasis');
    expect(BIOCROISSANT_PROPERTIES).toContain('ehdsDataPermitId');
    expect(BIOCROISSANT_PROPERTIES).toContain('dataController');
    // `intendedUse` is intentionally NOT a BIOCroissant field — IUS
    // attaches to AI submissions (model cards), not to datasets.
    // See ADR-0013 amendment 2026-05-17.
  });

  it('passthrough preserves unknown fields (forward compatibility)', () => {
    const manifest = {
      anonymizationLevel: 'DEIDENTIFIED',
      'bio:futureField': { weShouldNotKnowAboutThisYet: true },
    };
    const parsed = BioCroissantSchema.parse(manifest);
    expect((parsed as Record<string, unknown>)['bio:futureField']).toBeDefined();
  });
});

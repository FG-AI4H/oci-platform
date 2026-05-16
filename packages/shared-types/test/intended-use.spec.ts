import { describe, expect, it } from 'vitest';
import {
  IntendedUseStatementSchema,
  RISK_TIER_RANK,
  deriveRiskTier,
  overrideRequiresJustification,
  type IntendedUseStatement,
} from '../src/intended-use.js';

const baseIus: IntendedUseStatement = {
  v: 1,
  medicalPurpose: 'screening',
  foreseeableMisuse: 'Use on paediatric patients (model trained on adults only).',
  contraindications: 'Patients <18; chest implants obscuring lung fields.',
  riskTier: 'II',
};

describe('IntendedUseStatementSchema (ADR-0013)', () => {
  it('parses a minimal valid statement', () => {
    expect(() => IntendedUseStatementSchema.parse(baseIus)).not.toThrow();
  });

  it('requires foreseeableMisuse and contraindications', () => {
    const { foreseeableMisuse: _fm, ...withoutMisuse } = baseIus;
    expect(() => IntendedUseStatementSchema.parse(withoutMisuse)).toThrow();
    const { contraindications: _c, ...withoutContra } = baseIus;
    expect(() => IntendedUseStatementSchema.parse(withoutContra)).toThrow();
  });

  it('requires medicalPurposeOther when medicalPurpose is `other`', () => {
    expect(() =>
      IntendedUseStatementSchema.parse({ ...baseIus, medicalPurpose: 'other' }),
    ).toThrow();
    expect(() =>
      IntendedUseStatementSchema.parse({
        ...baseIus,
        medicalPurpose: 'other',
        medicalPurposeOther: 'bespoke clinical workflow X',
      }),
    ).not.toThrow();
  });

  it('rejects unknown enum values', () => {
    expect(() =>
      IntendedUseStatementSchema.parse({
        ...baseIus,
        medicalPurpose: 'something-not-listed',
      }),
    ).toThrow();
    expect(() =>
      IntendedUseStatementSchema.parse({ ...baseIus, riskTier: 'V' }),
    ).toThrow();
  });
});

describe('deriveRiskTier (ADR-0013 §3 matrix)', () => {
  it('Tier IV: standalone diagnosis or treatment planning', () => {
    expect(
      deriveRiskTier({
        medicalPurpose: 'diagnosis',
        intendedClinicalPathway: 'standalone',
      }),
    ).toBe('IV');
    expect(
      deriveRiskTier({
        medicalPurpose: 'treatment-planning',
        intendedClinicalPathway: 'standalone',
      }),
    ).toBe('IV');
  });

  it('Tier III: adjunct-with-confirmation diagnosis', () => {
    expect(
      deriveRiskTier({
        medicalPurpose: 'diagnosis',
        intendedClinicalPathway: 'adjunct-with-confirmation',
      }),
    ).toBe('III');
  });

  it('Tier III: screening or triage in emergency operating environment', () => {
    expect(
      deriveRiskTier({
        medicalPurpose: 'screening',
        intendedClinicalPathway: 'screening-before-specialist',
        operatingEnvironment: ['emergency'],
      }),
    ).toBe('III');
    expect(
      deriveRiskTier({
        medicalPurpose: 'triage',
        intendedClinicalPathway: 'triage-before-clinician',
        operatingEnvironment: ['emergency'],
      }),
    ).toBe('III');
  });

  it('Tier II: routine screening / triage / monitoring / CDS', () => {
    expect(
      deriveRiskTier({
        medicalPurpose: 'screening',
        intendedClinicalPathway: 'screening-before-specialist',
        operatingEnvironment: ['primary-care'],
      }),
    ).toBe('II');
    expect(
      deriveRiskTier({
        medicalPurpose: 'monitoring',
        intendedClinicalPathway: 'adjunct-with-confirmation',
      }),
    ).toBe('II');
    expect(
      deriveRiskTier({
        medicalPurpose: 'clinical-decision-support',
        intendedClinicalPathway: 'adjunct-with-confirmation',
      }),
    ).toBe('II');
  });

  it('Tier I: research-only, administrative, patient-education', () => {
    expect(
      deriveRiskTier({
        medicalPurpose: 'research-only',
        intendedClinicalPathway: 'research-only',
      }),
    ).toBe('I');
    expect(
      deriveRiskTier({ medicalPurpose: 'administrative' }),
    ).toBe('I');
    expect(
      deriveRiskTier({ medicalPurpose: 'patient-education' }),
    ).toBe('I');
  });
});

describe('overrideRequiresJustification', () => {
  it('does not require justification for downward override', () => {
    expect(overrideRequiresJustification('IV', 'I')).toBe(false);
    expect(overrideRequiresJustification('III', 'II')).toBe(false);
  });

  it('does not require justification for a single tier up', () => {
    expect(overrideRequiresJustification('I', 'II')).toBe(false);
    expect(overrideRequiresJustification('II', 'III')).toBe(false);
  });

  it('requires justification for ≥ 2 tiers up', () => {
    expect(overrideRequiresJustification('I', 'III')).toBe(true);
    expect(overrideRequiresJustification('I', 'IV')).toBe(true);
    expect(overrideRequiresJustification('II', 'IV')).toBe(true);
  });

  it('RISK_TIER_RANK is monotonically increasing', () => {
    expect(RISK_TIER_RANK.I).toBeLessThan(RISK_TIER_RANK.II);
    expect(RISK_TIER_RANK.II).toBeLessThan(RISK_TIER_RANK.III);
    expect(RISK_TIER_RANK.III).toBeLessThan(RISK_TIER_RANK.IV);
  });
});

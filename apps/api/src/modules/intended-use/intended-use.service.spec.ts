import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { IntendedUseService } from './intended-use.service.js';

const validIus = {
  v: 1,
  medicalPurpose: 'screening' as const,
  intendedClinicalPathway: 'screening-before-specialist' as const,
  operatingEnvironment: ['primary-care' as const],
  foreseeableMisuse: 'Use on paediatric patients (model trained on adults only).',
  contraindications: 'Patients <18; chest implants obscuring lung fields.',
  riskTier: 'II' as const,
};

describe('IntendedUseService (ADR-0013, Phase B)', () => {
  const svc = new IntendedUseService();

  it('validate() accepts a well-formed IUS aligned with auto-derived tier', () => {
    expect(() => svc.validate(validIus)).not.toThrow();
  });

  it('validate() rejects a payload with missing foreseeableMisuse', () => {
    const bad = { ...validIus, foreseeableMisuse: undefined };
    expect(() => svc.validate(bad)).toThrow(BadRequestException);
  });

  it('validate() throws when declared tier is ≥ 2 levels up and no justification', () => {
    // medicalPurpose=research-only auto-derives to I; declaring IV without justification is a violation.
    const bad = {
      ...validIus,
      medicalPurpose: 'research-only' as const,
      intendedClinicalPathway: 'research-only' as const,
      riskTier: 'IV' as const,
    };
    expect(() => svc.validate(bad)).toThrow(BadRequestException);
  });

  it('validate() passes when ≥ 2-tier upward override carries justification', () => {
    const ok = {
      ...validIus,
      medicalPurpose: 'research-only' as const,
      intendedClinicalPathway: 'research-only' as const,
      riskTier: 'IV' as const,
      riskTierJustification:
        'Research dataset used for autonomous CT triage validation in a controlled clinical study; submitter elevates to IV to match the eventual deployment risk profile.',
    };
    expect(() => svc.validate(ok)).not.toThrow();
  });

  it('deriveTier() returns IV for standalone diagnosis', () => {
    expect(
      svc.deriveTier({
        medicalPurpose: 'diagnosis',
        intendedClinicalPathway: 'standalone',
      }),
    ).toBe('IV');
  });

  it('deriveTier() returns I for research-only', () => {
    expect(svc.deriveTier({ medicalPurpose: 'research-only' })).toBe('I');
  });
});

import { describe, expect, it } from 'vitest';
import { deriveRiskTier, explainRiskTier, type RiskTierInput } from './intended-use.js';

describe('explainRiskTier (#651)', () => {
  it.each<[RiskTierInput, string, string]>([
    [{ medicalPurpose: 'research-only' }, 'I', 'informational-purpose'],
    [{ medicalPurpose: 'administrative' }, 'I', 'informational-purpose'],
    [
      { medicalPurpose: 'patient-education', intendedClinicalPathway: 'standalone' },
      'I',
      'informational-purpose',
    ],
    [
      { medicalPurpose: 'diagnosis', intendedClinicalPathway: 'standalone' },
      'IV',
      'critical-standalone',
    ],
    [
      {
        medicalPurpose: 'treatment-planning',
        intendedClinicalPathway: 'adjunct-with-confirmation',
      },
      'III',
      'critical-with-clinician',
    ],
    [{ medicalPurpose: 'diagnosis' }, 'III', 'critical-with-clinician'],
    [
      { medicalPurpose: 'triage', operatingEnvironment: ['hospital-inpatient', 'emergency'] },
      'III',
      'triage-screening-emergency',
    ],
    [
      { medicalPurpose: 'screening', intendedClinicalPathway: 'screening-before-specialist' },
      'II',
      'triage-screening',
    ],
    [
      { medicalPurpose: 'prognosis', intendedClinicalPathway: 'standalone' },
      'III',
      'prognosis-monitoring-standalone',
    ],
    [{ medicalPurpose: 'monitoring' }, 'II', 'prognosis-monitoring'],
    [{ medicalPurpose: 'clinical-decision-support' }, 'II', 'decision-support'],
    [{ medicalPurpose: 'other' }, 'II', 'other-purpose'],
  ])('%o → tier %s because %s', (input, tier, reason) => {
    expect(explainRiskTier(input)).toEqual({ tier, reason });
  });

  it('is the same computation as deriveRiskTier', () => {
    const input: RiskTierInput = {
      medicalPurpose: 'screening',
      intendedClinicalPathway: 'standalone',
      operatingEnvironment: ['emergency'],
    };
    expect(deriveRiskTier(input)).toBe(explainRiskTier(input).tier);
  });
});

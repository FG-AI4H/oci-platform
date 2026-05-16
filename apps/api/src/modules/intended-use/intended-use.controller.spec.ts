import { describe, expect, it } from 'vitest';
import { IntendedUseController } from './intended-use.controller.js';
import { IntendedUseService } from './intended-use.service.js';

describe('IntendedUseController (ADR-0013)', () => {
  const controller = new IntendedUseController(new IntendedUseService());

  it('returns IV for standalone diagnosis', () => {
    const res = controller.derive({
      medicalPurpose: 'diagnosis',
      intendedClinicalPathway: 'standalone',
    });
    expect(res.autoDerivedTier).toBe('IV');
    expect(res.rationale).toContain('IV');
  });

  it('returns III for emergency-environment triage', () => {
    const res = controller.derive({
      medicalPurpose: 'triage',
      intendedClinicalPathway: 'triage-before-clinician',
      operatingEnvironment: ['emergency'],
    });
    expect(res.autoDerivedTier).toBe('III');
    expect(res.rationale.toLowerCase()).toContain('emergency');
  });

  it('returns I for research-only with informative rationale', () => {
    const res = controller.derive({ medicalPurpose: 'research-only' });
    expect(res.autoDerivedTier).toBe('I');
    expect(res.rationale.toLowerCase()).toContain('informational');
  });
});

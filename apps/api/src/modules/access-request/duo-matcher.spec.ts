import { describe, expect, it } from 'vitest';
import type { AccessRequestAttestations } from '@oci/shared-types';
import { matchDuoIntent } from './duo-matcher.js';

function attestations(overrides: Partial<AccessRequestAttestations> = {}): AccessRequestAttestations {
  return {
    v: 1,
    projectTitle: 'Replication of pneumonia detection benchmark',
    projectDescription:
      'A replication of the published RSNA pneumonia detection benchmark; outputs to be a peer-reviewed publication.',
    institution: 'University of Geneva',
    intendedUseCategory: 'NON_COMMERCIAL_RESEARCH',
    intendedUseDuoTerms: ['DUO_0000042'],
    irbApproved: true,
    irbApprovalRef: 'IRB-2026-001',
    dpiaRef: null,
    dataRetentionDays: 365,
    redistributionIntent: 'NONE',
    outputType: 'PUBLICATION',
    ...overrides,
  };
}

describe('matchDuoIntent', () => {
  it('UNCLEAR when dataset declares no terms', () => {
    const r = matchDuoIntent([], attestations());
    expect(r.status).toBe('UNCLEAR');
  });

  it('UNCLEAR when dataset references a term outside the registry', () => {
    const r = matchDuoIntent(['DUO_9999999'], attestations());
    expect(r.status).toBe('UNCLEAR');
    expect(r.explanations[0]).toMatch(/not in this platform's registry/);
  });

  it('MATCHED on a GRU-only dataset for non-commercial research', () => {
    const r = matchDuoIntent(['DUO_0000042'], attestations());
    expect(r.status).toBe('MATCHED');
  });

  it('MATCHED on a GRU dataset for commercial research too (GRU has no NCU)', () => {
    const r = matchDuoIntent(
      ['DUO_0000042'],
      attestations({ intendedUseCategory: 'COMMERCIAL_RESEARCH' }),
    );
    expect(r.status).toBe('MATCHED');
  });

  it('CONFLICT when commercial intent meets NCU', () => {
    const r = matchDuoIntent(
      ['DUO_0000042', 'DUO_0000046'],
      attestations({ intendedUseCategory: 'COMMERCIAL_RESEARCH' }),
    );
    expect(r.status).toBe('CONFLICT');
    expect(r.explanations[0]).toMatch(/commercial use prohibited/);
  });

  it('CONFLICT when IRB-required dataset gets a non-IRB request', () => {
    const r = matchDuoIntent(
      ['DUO_0000042', 'DUO_0000021'],
      attestations({ irbApproved: false }),
    );
    expect(r.status).toBe('CONFLICT');
    expect(r.explanations.join(' ')).toMatch(/IRB.*ethics/);
  });

  it('UNCLEAR when an RTN modifier requires a formal DUA', () => {
    const r = matchDuoIntent(['DUO_0000042', 'DUO_0000029'], attestations());
    expect(r.status).toBe('UNCLEAR');
    expect(r.explanations[0]).toMatch(/formal data-use agreement/);
  });

  it('UNCLEAR on HMB for clinical-care intent (partial coverage)', () => {
    const r = matchDuoIntent(
      ['DUO_0000006'],
      attestations({ intendedUseCategory: 'CLINICAL_CARE' }),
    );
    expect(r.status).toBe('UNCLEAR');
  });

  it('CONFLICT on HMB for education intent (out of scope)', () => {
    const r = matchDuoIntent(
      ['DUO_0000006'],
      attestations({ intendedUseCategory: 'EDUCATION' }),
    );
    expect(r.status).toBe('CONFLICT');
  });

  it('UNCLEAR on DS for any research intent (disease check is v2)', () => {
    const r = matchDuoIntent(
      ['DUO_0000007'],
      attestations({ intendedUseCategory: 'NON_COMMERCIAL_RESEARCH' }),
    );
    expect(r.status).toBe('UNCLEAR');
  });
});

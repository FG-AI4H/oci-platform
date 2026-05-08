import { describe, expect, it } from 'vitest';
import type { AccessRequestAttestations } from '@oci/shared-types';
import { matchDuoIntent } from './duo-matcher.js';

function attestations(
  overrides: Partial<AccessRequestAttestations> = {},
): AccessRequestAttestations {
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
    const r = matchDuoIntent(['DUO_0000042', 'DUO_0000021'], attestations({ irbApproved: false }));
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
    const r = matchDuoIntent(['DUO_0000006'], attestations({ intendedUseCategory: 'EDUCATION' }));
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

describe('matchDuoIntent — tier check (#115)', () => {
  it('CONFLICT when accessTier requires a higher score than the requester demonstrated', () => {
    const r = matchDuoIntent(['DUO_0000042'], attestations(), {
      accessTier: 'CONTROLLED',
      requesterIdentityScore: 'EMAIL_ONLY',
    });
    expect(r.status).toBe('CONFLICT');
    expect(r.explanations.some((e) => /CONTROLLED tier.*QUIZ_PASSED.*EMAIL_ONLY/.test(e))).toBe(
      true,
    );
  });

  it('MATCHED when score equals the tier requirement', () => {
    const r = matchDuoIntent(['DUO_0000042'], attestations(), {
      accessTier: 'REGISTERED',
      requesterIdentityScore: 'EMAIL_DOMAIN_VERIFIED',
    });
    expect(r.status).toBe('MATCHED');
  });

  it('MATCHED when score exceeds the tier requirement', () => {
    const r = matchDuoIntent(['DUO_0000042'], attestations(), {
      accessTier: 'OPEN',
      requesterIdentityScore: 'PASSPORT_VERIFIED',
    });
    expect(r.status).toBe('MATCHED');
  });

  it('tier conflict surfaces alongside DUO conflicts (combined CONFLICT)', () => {
    const r = matchDuoIntent(
      ['DUO_0000042', 'DUO_0000046'],
      attestations({ intendedUseCategory: 'COMMERCIAL_RESEARCH' }),
      { accessTier: 'CONTROLLED', requesterIdentityScore: 'EMAIL_ONLY' },
    );
    expect(r.status).toBe('CONFLICT');
    // Both the commercial-vs-NCU conflict AND the tier mismatch should be reported.
    expect(r.explanations.some((e) => /commercial use prohibited/.test(e))).toBe(true);
    expect(r.explanations.some((e) => /CONTROLLED tier/.test(e))).toBe(true);
  });

  it('tier conflict survives the no-DUO-terms early branch (CONFLICT, not UNCLEAR)', () => {
    const r = matchDuoIntent([], attestations(), {
      accessTier: 'SENSITIVE',
      requesterIdentityScore: 'EMAIL_ONLY',
    });
    expect(r.status).toBe('CONFLICT');
    expect(r.explanations[0]).toMatch(/SENSITIVE tier.*PASSPORT_VERIFIED.*EMAIL_ONLY/);
  });

  it('tier check is skipped when no tier inputs supplied (legacy callers)', () => {
    // No `tier` argument → matcher behaves exactly as pre-PR-115.
    const r = matchDuoIntent(['DUO_0000042'], attestations());
    expect(r.status).toBe('MATCHED');
  });
});

describe('matchDuoIntent — commercialUseTerms (#119)', () => {
  const tier = (commercialUseTerms?: 'OK' | 'NON_COMMERCIAL_ONLY' | 'CASE_BY_CASE') => ({
    accessTier: 'OPEN' as const,
    requesterIdentityScore: 'EMAIL_ONLY' as const,
    ...(commercialUseTerms ? { commercialUseTerms } : {}),
  });
  const commercial = attestations({ intendedUseCategory: 'COMMERCIAL_RESEARCH' });

  it('OK overrides DUO_0000046 (NCU) — commercial intent is permitted', () => {
    // Without commercialUseTerms the matcher would flag CONFLICT on NCU.
    // OK explicitly granted by the host wins.
    const r = matchDuoIntent(['DUO_0000042', 'DUO_0000046'], commercial, tier('OK'));
    expect(r.status).toBe('MATCHED');
  });

  it('NON_COMMERCIAL_ONLY rejects commercial intent even without DUO_0000046', () => {
    // The host might declare non-commercial-only without adding the
    // DUO term to the manifest. The matcher honours the dataset field.
    const r = matchDuoIntent(['DUO_0000042'], commercial, tier('NON_COMMERCIAL_ONLY'));
    expect(r.status).toBe('CONFLICT');
    expect(r.explanations.some((e) => /non-commercial only/i.test(e))).toBe(true);
  });

  it('CASE_BY_CASE flags UNCLEAR for commercial intent', () => {
    const r = matchDuoIntent(['DUO_0000042'], commercial, tier('CASE_BY_CASE'));
    expect(r.status).toBe('UNCLEAR');
    expect(r.explanations.some((e) => /case-by-case/i.test(e))).toBe(true);
  });

  it('non-commercial intent is unaffected by commercialUseTerms', () => {
    const r = matchDuoIntent(['DUO_0000042'], attestations(), tier('NON_COMMERCIAL_ONLY'));
    expect(r.status).toBe('MATCHED');
  });

  it('falls back to DUO_0000046 inference when commercialUseTerms is omitted', () => {
    const r = matchDuoIntent(['DUO_0000042', 'DUO_0000046'], commercial, tier());
    expect(r.status).toBe('CONFLICT');
    expect(r.explanations.some((e) => /commercial use prohibited/i.test(e))).toBe(true);
  });
});

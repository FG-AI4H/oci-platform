import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditPseudonymiser } from '../audit/audit-pseudonym.js';
import { ReaderPseudonymiser } from './reader-pseudonym.js';

const USER = '6f1c2a9e-0d3b-5c7e-9a1f-2b4d6e8f0a1c';
const CAMPAIGN_A = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_B = '22222222-2222-4222-8222-222222222222';

describe('ReaderPseudonymiser (#648)', () => {
  const saved = { key: process.env.OCI_AUDIT_PSEUDONYM_KEY, env: process.env.OCI_ENV };
  afterEach(() => {
    if (saved.key === undefined) delete process.env.OCI_AUDIT_PSEUDONYM_KEY;
    else process.env.OCI_AUDIT_PSEUDONYM_KEY = saved.key;
    if (saved.env === undefined) delete process.env.OCI_ENV;
    else process.env.OCI_ENV = saved.env;
  });

  function withKey(key: string | undefined, env?: string) {
    if (key === undefined) delete process.env.OCI_AUDIT_PSEUDONYM_KEY;
    else process.env.OCI_AUDIT_PSEUDONYM_KEY = key;
    if (env === undefined) delete process.env.OCI_ENV;
    else process.env.OCI_ENV = env;
    return new ReaderPseudonymiser();
  }

  it('is stable within a campaign and unrelated across campaigns', () => {
    const p = withKey('k'.repeat(40));
    const a = p.forCampaign(CAMPAIGN_A)(USER);
    expect(a).toMatch(/^r-[0-9a-f]{8}$/);
    expect(p.forCampaign(CAMPAIGN_A)(USER)).toBe(a);
    expect(new ReaderPseudonymiser().forCampaign(CAMPAIGN_A)(USER)).toBe(a);
    expect(p.forCampaign(CAMPAIGN_B)(USER)).not.toBe(a);
    expect(a).not.toContain(USER.slice(0, 8));
  });

  it('depends on the key', () => {
    const a = withKey('k'.repeat(40)).forCampaign(CAMPAIGN_A)(USER);
    const b = withKey('j'.repeat(40)).forCampaign(CAMPAIGN_A)(USER);
    expect(a).not.toBe(b);
  });

  it("never equals the audit trail's pseudonym of the same person", () => {
    withKey('k'.repeat(40));
    const audit = new AuditPseudonymiser().pseudonym(USER) ?? '';
    const reader = new ReaderPseudonymiser().forCampaign(CAMPAIGN_A)(USER);
    expect(audit.slice(3, 11)).not.toBe(reader.slice(2));
  });

  it('falls back to the local key on a local stack only', () => {
    expect(withKey(undefined, 'local').forCampaign(CAMPAIGN_A)(USER)).toMatch(/^r-/);
    expect(() => withKey(undefined).forCampaign(CAMPAIGN_A)).toThrow(ServiceUnavailableException);
    expect(() => withKey('short').forCampaign(CAMPAIGN_A)).toThrow(ServiceUnavailableException);
  });
});

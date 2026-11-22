import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditPseudonymiser, resolveKey } from './audit-pseudonym.js';

const KEY = 'k'.repeat(40);
const USER = '6f1f7b0e-4a53-4c1e-9a8e-2b8f2b1f0c11';

afterEach(() => vi.unstubAllEnvs());

function withEnv(key: string | undefined, env: string | undefined): AuditPseudonymiser {
  vi.stubEnv('OCI_AUDIT_PSEUDONYM_KEY', key);
  vi.stubEnv('OCI_ENV', env);
  return new AuditPseudonymiser();
}

describe('AuditPseudonymiser', () => {
  it('is ps- and the first 24 hex digits of a domain-separated HMAC-SHA256', () => {
    const p = withEnv(KEY, 'dev');
    const mac = createHmac('sha256', KEY)
      .update(`oci-audit-pseudonym/v1\u0000${USER}`)
      .digest('hex');
    expect(p.pseudonym(USER)).toBe(`ps-${mac.slice(0, 24)}`);
  });

  it('is stable for the same person and differs between people', () => {
    const p = withEnv(KEY, 'dev');
    expect(p.pseudonym(USER)).toBe(p.pseudonym(USER));
    expect(p.pseudonym(USER)).not.toBe(p.pseudonym('7f1f7b0e-4a53-4c1e-9a8e-2b8f2b1f0c11'));
  });

  it('depends on the key: another key gives another pseudonym', () => {
    const a = withEnv(KEY, 'dev').pseudonym(USER);
    const b = withEnv('z'.repeat(40), 'dev').pseudonym(USER);
    expect(a).not.toBe(b);
  });

  it('is not configured on a deployed environment without a key, or with a short one', () => {
    expect(withEnv(undefined, 'dev').configured).toBe(false);
    expect(withEnv('short', 'dev').pseudonym(USER)).toBeNull();
  });

  it('uses a fixed local key only when OCI_ENV=local', () => {
    expect(resolveKey(undefined, 'local')).not.toBeNull();
    expect(resolveKey(undefined, 'prod')).toBeNull();
    expect(resolveKey(KEY, 'local')).toBe(KEY);
  });
});

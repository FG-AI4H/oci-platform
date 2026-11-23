import { createHmac } from 'node:crypto';
import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditPseudonymiser, resolveKey } from './audit-pseudonym.js';

const KEY = 'k'.repeat(40);
const USER = '6f1f7b0e-4a53-4c1e-9a8e-2b8f2b1f0c11';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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

  it('accepts a key of the shape CDK generates: 64 letters and digits', () => {
    const generated = 'aB3'.repeat(21) + 'x';
    expect(generated).toHaveLength(64);
    expect(withEnv(generated, 'dev').configured).toBe(true);
  });
});

describe('AuditPseudonymiser: the key stays out of logs and responses (#775)', () => {
  // Distinctive, so a leak of any of it is found by substring.
  const SECRET = 'leak-canary-Zq7Xw2Vb9Np4Lm6Kc8Rt1Hs5Jd3Fg0Yu';
  const SHORT_SECRET = 'leak-canary-short';

  function captureLogs(): string[] {
    const logged: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' '));
      });
    }
    return logged;
  }

  it('is not in the instance as JSON.stringify, util.inspect or its own properties see it', () => {
    const p = withEnv(SECRET, 'prod');
    expect(p.configured).toBe(true);
    expect(JSON.stringify(p)).not.toContain(SECRET);
    expect(inspect(p, { depth: 10, showHidden: true })).not.toContain(SECRET);
    expect(JSON.stringify({ ...p })).not.toContain(SECRET);
  });

  it('is not logged at startup, whether it is accepted or refused as too short', () => {
    const logged = captureLogs();
    withEnv(SECRET, 'prod');
    expect(logged).toEqual([]);

    withEnv(SHORT_SECRET, 'prod');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('OCI_AUDIT_PSEUDONYM_KEY is not set');
    expect(logged.join('\n')).not.toContain(SHORT_SECRET);
  });

  it('is not part of a pseudonym', () => {
    const pseudonym = withEnv(SECRET, 'prod').pseudonym(USER);
    expect(pseudonym).toMatch(/^ps-[0-9a-f]{24}$/);
  });
});

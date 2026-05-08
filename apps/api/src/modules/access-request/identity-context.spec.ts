import { describe, expect, it } from 'vitest';
import { buildRequesterIdentityContext, extractRequesterEmail } from './identity-context.js';

describe('buildRequesterIdentityContext — score lift', () => {
  it('EMAIL_ONLY when no email is available', () => {
    const ctx = buildRequesterIdentityContext({ email: null });
    expect(ctx.identityScore).toBe('EMAIL_ONLY');
    expect(ctx.emailDomainCategory).toBe('public');
  });

  it('EMAIL_DOMAIN_VERIFIED for an institutional address', () => {
    const ctx = buildRequesterIdentityContext({ email: 'researcher@stanford.edu' });
    expect(ctx.identityScore).toBe('EMAIL_DOMAIN_VERIFIED');
    expect(ctx.emailDomainCategory).toBe('institutional');
  });

  it('EMAIL_DOMAIN_VERIFIED for a corporate address', () => {
    const ctx = buildRequesterIdentityContext({ email: 'engineer@acme-medtech.com' });
    expect(ctx.identityScore).toBe('EMAIL_DOMAIN_VERIFIED');
    expect(ctx.emailDomainCategory).toBe('corporate');
  });

  it('EMAIL_ONLY for a public-webmail address (gmail etc.)', () => {
    const ctx = buildRequesterIdentityContext({ email: 'someone@gmail.com' });
    expect(ctx.identityScore).toBe('EMAIL_ONLY');
    expect(ctx.emailDomainCategory).toBe('public');
  });

  it('EMAIL_ONLY for a disposable address (and category recorded for audit)', () => {
    const ctx = buildRequesterIdentityContext({ email: 'throw@mailinator.com' });
    expect(ctx.identityScore).toBe('EMAIL_ONLY');
    expect(ctx.emailDomainCategory).toBe('disposable');
  });

  it('dataset allowlist forces institutional category and lifts score', () => {
    const ctx = buildRequesterIdentityContext({
      email: 'pm@some-corp.io', // generic domain
      datasetEmailDomainAllowlist: ['some-corp.io'],
    });
    expect(ctx.emailDomainCategory).toBe('institutional');
    expect(ctx.identityScore).toBe('EMAIL_DOMAIN_VERIFIED');
  });

  it('active certification lifts EMAIL_ONLY → QUIZ_PASSED (#117 follow-up)', () => {
    const ctx = buildRequesterIdentityContext({
      email: 'someone@gmail.com', // public webmail → EMAIL_ONLY baseline
      hasActiveCertification: true,
    });
    expect(ctx.emailDomainCategory).toBe('public');
    expect(ctx.identityScore).toBe('QUIZ_PASSED');
  });

  it('active certification lifts EMAIL_DOMAIN_VERIFIED → QUIZ_PASSED', () => {
    const ctx = buildRequesterIdentityContext({
      email: 'researcher@stanford.edu',
      hasActiveCertification: true,
    });
    expect(ctx.identityScore).toBe('QUIZ_PASSED');
  });

  it('inactive certification is a no-op (score stays at the email-derived value)', () => {
    const ctx = buildRequesterIdentityContext({
      email: 'researcher@stanford.edu',
      hasActiveCertification: false,
    });
    expect(ctx.identityScore).toBe('EMAIL_DOMAIN_VERIFIED');
  });
});

describe('buildRequesterIdentityContext — empty / future-PR slots', () => {
  it('returns empty visas, null affiliation, and empty acceptedPolicies for now', () => {
    const ctx = buildRequesterIdentityContext({ email: 'a@b.edu' });
    expect(ctx.visas).toEqual([]);
    expect(ctx.affiliation).toBeNull();
    expect(ctx.acceptedPolicies).toEqual([]);
  });
});

describe('extractRequesterEmail', () => {
  it('returns user.email when an email-shaped value is present', () => {
    expect(extractRequesterEmail({ email: 'a@b.com', sub: 'uuid' })).toBe('a@b.com');
  });

  it('falls back to user.sub when sub is email-shaped (local-dev path)', () => {
    expect(extractRequesterEmail({ sub: 'local-dev@oci.ai4h.net' })).toBe('local-dev@oci.ai4h.net');
  });

  it('returns null for a UUID-shaped sub with no separate email (production access token)', () => {
    expect(extractRequesterEmail({ sub: '00000000-0000-4000-8000-000000000001' })).toBeNull();
  });

  it('returns null when user is undefined', () => {
    expect(extractRequesterEmail(undefined)).toBeNull();
  });
});

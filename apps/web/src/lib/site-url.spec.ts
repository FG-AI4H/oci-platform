import { describe, expect, it } from 'vitest';
import { siteUrl } from './site-url';

/** #831: the address pages publish as their own, read when a request is served. */
describe('siteUrl', () => {
  it('is the configured address, without a trailing slash', () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: 'https://dev.oci.ai4h.net/', OCI_ENV: 'dev' })).toBe(
      'https://dev.oci.ai4h.net',
    );
  });

  it('falls back to the sign-in address the same stack sets', () => {
    expect(siteUrl({ AUTH_URL: 'https://int.oci.ai4h.net', OCI_ENV: 'int' })).toBe(
      'https://int.oci.ai4h.net',
    );
  });

  it('prefers the site address over the sign-in address', () => {
    expect(
      siteUrl({ NEXT_PUBLIC_SITE_URL: 'https://oci.ai4h.net', AUTH_URL: 'https://other.example' }),
    ).toBe('https://oci.ai4h.net');
  });

  it('treats a blank value as not set', () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: '  ', AUTH_URL: 'https://dev.oci.ai4h.net' })).toBe(
      'https://dev.oci.ai4h.net',
    );
  });

  it.each(['dev', 'int', 'prod'])(
    'refuses to answer localhost on %s when nothing is configured',
    (OCI_ENV) => {
      expect(() => siteUrl({ OCI_ENV })).toThrow(/site address is not configured/);
    },
  );

  it('answers localhost on a laptop and in a test run', () => {
    expect(siteUrl({ OCI_ENV: 'local' })).toBe('http://localhost:3001');
    expect(siteUrl({})).toBe('http://localhost:3001');
  });

  it('does not fail the image build, which has no environment yet', () => {
    expect(siteUrl({ OCI_ENV: 'prod', NEXT_PHASE: 'phase-production-build' })).toBe(
      'http://localhost:3001',
    );
  });

  it('reads the process environment by default', () => {
    expect(typeof siteUrl()).toBe('string');
  });
});

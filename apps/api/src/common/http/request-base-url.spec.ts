import { describe, expect, it } from 'vitest';
import { requestBaseUrl } from './request-base-url.js';

describe('requestBaseUrl', () => {
  it('prefers the forwarded scheme and host set by the load balancer', () => {
    expect(
      requestBaseUrl({
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'dev.oci.ai4h.net',
          host: '10.0.0.5:3000',
        },
        protocol: 'http',
      }),
    ).toBe('https://dev.oci.ai4h.net');
  });

  it('falls back to the Host header and the request protocol', () => {
    expect(requestBaseUrl({ headers: { host: 'localhost:3000' }, protocol: 'http' })).toBe(
      'http://localhost:3000',
    );
  });

  it('ignores repeated forwarded headers rather than joining them', () => {
    expect(
      requestBaseUrl({
        headers: { 'x-forwarded-host': ['a.example', 'b.example'], host: 'api.example' },
      }),
    ).toBe('https://api.example');
  });

  it('defaults to the production host when nothing identifies one', () => {
    expect(requestBaseUrl({ headers: {} })).toBe('https://oci.ai4h.net');
  });
});

import { describe, expect, it } from 'vitest';
import { safeCallbackUrl } from './safe-callback-url';

describe('safeCallbackUrl', () => {
  it('falls back when missing', () => {
    expect(safeCallbackUrl(undefined)).toBe('/dashboard');
    expect(safeCallbackUrl('')).toBe('/dashboard');
  });

  it('keeps a same-origin path with query and hash', () => {
    expect(safeCallbackUrl('/annotation/campaigns/x?flag=y')).toBe(
      '/annotation/campaigns/x?flag=y',
    );
    expect(safeCallbackUrl('/catalog/My_Dataset#files')).toBe('/catalog/My_Dataset#files');
  });

  it.each([
    // `/%5Cevil.example` arrives here already decoded by searchParams.
    '/\\evil.example',
    '/\\/evil.example',
    '//evil.example',
    'https://evil.example',
    'evil.example',
    'javascript:alert(1)',
    '/\t/evil.example',
    '/\n/evil.example',
    '/.//evil.example',
    '/x/..//evil.example',
  ])('rejects off-site target %j', (raw) => {
    expect(safeCallbackUrl(raw)).toBe('/dashboard');
  });
});

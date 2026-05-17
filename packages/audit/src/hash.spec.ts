import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { payloadHash } from './hash.js';

describe('payloadHash', () => {
  it('is stable across key reordering', () => {
    const a = payloadHash({ foo: 'bar', baz: 1 });
    const b = payloadHash({ baz: 1, foo: 'bar' });
    expect(a).toBe(b);
  });

  it('matches sha256 over the canonical form an offline verifier can reproduce', () => {
    const canonical = '{"action":"dataset.published","id":"abc"}';
    const expected = createHash('sha256').update(canonical, 'utf8').digest('hex');
    expect(payloadHash({ id: 'abc', action: 'dataset.published' })).toBe(expected);
  });

  it('changes when the payload changes', () => {
    expect(payloadHash({ x: 1 })).not.toBe(payloadHash({ x: 2 }));
  });
});

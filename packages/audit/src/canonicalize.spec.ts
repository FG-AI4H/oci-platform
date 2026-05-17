import { describe, expect, it } from 'vitest';
import { canonicalize } from './canonicalize.js';

describe('canonicalize (RFC 8785)', () => {
  it('emits object keys in lexicographic order regardless of insertion order', () => {
    const a = canonicalize({ b: 1, a: 2, c: 3 });
    const b = canonicalize({ c: 3, a: 2, b: 1 });
    expect(a).toBe('{"a":2,"b":1,"c":3}');
    expect(a).toBe(b);
  });

  it('recurses through nested objects + arrays', () => {
    expect(canonicalize({ x: [{ z: 1, y: 2 }, 3], w: null })).toBe(
      '{"w":null,"x":[{"y":2,"z":1},3]}',
    );
  });

  it('serializes primitives consistent with JSON.stringify', () => {
    expect(canonicalize('hello "world"')).toBe('"hello \\"world\\""');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(null)).toBe('null');
  });

  it('drops undefined object members (matches JCS / JSON.stringify)', () => {
    expect(canonicalize({ a: 1, b: undefined as unknown })).toBe('{"a":1}');
  });

  it('throws on non-finite numbers', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });

  it('throws on bigint', () => {
    expect(() => canonicalize(1n)).toThrow(/bigint/);
  });
});

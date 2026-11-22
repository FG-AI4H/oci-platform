import { describe, expect, it } from 'vitest';
import { actorText, formatOccurredAt, payloadText, shortHash } from './audit-format';

describe('audit-format', () => {
  it('shortens a hash to 12 digits and shows a dash for none', () => {
    expect(shortHash('a'.repeat(64))).toBe(`${'a'.repeat(12)}…`);
    expect(shortHash(null)).toBe('—');
  });

  it('names each kind of actor', () => {
    expect(actorText({ kind: 'system' })).toBe('System (no person)');
    expect(actorText({ kind: 'withheld' })).toBe('Withheld');
    expect(actorText({ kind: 'pseudonym', id: 'ps-0123456789abcdef01234567' })).toBe(
      'Pseudonym ps-0123456789abcdef01234567',
    );
    expect(actorText({ kind: 'user', id: 'u-1' })).toBe('u-1');
  });

  it('prints times in UTC, whatever the zone', () => {
    expect(formatOccurredAt('2026-11-22T10:00:05.123+01:00')).toBe('2026-11-22 09:00:05 UTC');
    expect(formatOccurredAt('not a date')).toBe('not a date');
  });

  it('indents the payload', () => {
    expect(payloadText({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

import { describe, expect, it } from 'vitest';
import { formattersFor } from './format';

// Intl separates French thousands and percent signs with narrow or plain
// no-break spaces; compare with ordinary spaces.
const spaces = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('formattersFor', () => {
  const en = formattersFor('en');
  const fr = formattersFor('fr');
  const iso = '2026-12-17T09:30:00.000Z';

  it('keeps English on en-GB, as before translation', () => {
    expect(en.date(iso, { dateStyle: 'medium', timeZone: 'UTC' })).toBe('17 Dec 2026');
    expect(en.number(1234.5)).toBe('1,234.5');
    expect(en.percent(0.25)).toBe('25%');
  });

  it('formats French dates and numbers the French way', () => {
    expect(fr.date(iso, { dateStyle: 'medium', timeZone: 'UTC' })).toBe('17 déc. 2026');
    expect(spaces(fr.number(1234.5))).toBe('1 234,5');
    expect(spaces(fr.percent(0.25))).toBe('25 %');
  });

  it('formats sizes with the units the app used, and octets in French', () => {
    expect(en.bytes(512)).toBe('512 B');
    expect(en.bytes(1536)).toBe('1.5 KB');
    expect(en.bytes(5 * 1024 ** 3)).toBe('5.0 GB');
    expect(fr.bytes(1536)).toBe('1,5 Ko');
    expect(fr.bytes(3 * 1024 ** 2)).toBe('3,0 Mo');
  });

  it('returns an unparseable date as given', () => {
    expect(en.date('not a date')).toBe('not a date');
  });
});

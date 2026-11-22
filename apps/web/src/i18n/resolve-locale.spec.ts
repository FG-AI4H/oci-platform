import { describe, expect, it } from 'vitest';
import { intlLocale, toAppLocale } from './locales';
import { localeFromAcceptLanguage, resolveLocale } from './resolve-locale';

describe('resolveLocale — the order the ticket gives (#654)', () => {
  it('takes the stored preference over everything else', () => {
    expect(
      resolveLocale({ preference: 'fr', cookie: 'en', acceptLanguage: 'en-GB,en;q=0.9' }),
    ).toBe('fr');
    expect(resolveLocale({ preference: 'en', cookie: 'fr', acceptLanguage: 'fr-FR' })).toBe('en');
  });

  it('takes the cookie when there is no preference', () => {
    expect(resolveLocale({ preference: null, cookie: 'fr', acceptLanguage: 'en-US' })).toBe('fr');
  });

  it('takes Accept-Language when there is neither preference nor cookie', () => {
    expect(resolveLocale({ acceptLanguage: 'fr-CH,fr;q=0.9,en;q=0.8' })).toBe('fr');
  });

  it('falls back to English', () => {
    expect(resolveLocale({})).toBe('en');
    expect(resolveLocale({ acceptLanguage: 'de-DE,de;q=0.9' })).toBe('en');
  });

  it('skips a preference in a language with no interface instead of obeying it as English', () => {
    expect(resolveLocale({ preference: 'de-CH', cookie: 'fr' })).toBe('fr');
    expect(resolveLocale({ preference: 'de-CH', acceptLanguage: 'fr' })).toBe('fr');
  });

  it('reads a regional preference by its language', () => {
    expect(resolveLocale({ preference: 'fr-CH' })).toBe('fr');
  });

  it('ignores a cookie with an unknown value', () => {
    expect(resolveLocale({ cookie: 'xx', acceptLanguage: 'fr' })).toBe('fr');
    expect(resolveLocale({ cookie: '', acceptLanguage: '' })).toBe('en');
  });
});

describe('localeFromAcceptLanguage', () => {
  it('honours quality values over order', () => {
    expect(localeFromAcceptLanguage('en;q=0.5,fr;q=0.8')).toBe('fr');
  });

  it('keeps header order between equal qualities', () => {
    expect(localeFromAcceptLanguage('fr,en')).toBe('fr');
    expect(localeFromAcceptLanguage('en,fr')).toBe('en');
  });

  it('passes over languages with no interface to the first one that has one', () => {
    expect(localeFromAcceptLanguage('ar,de;q=0.9,fr;q=0.8,en;q=0.7')).toBe('fr');
  });

  it('ignores q=0 and the wildcard', () => {
    expect(localeFromAcceptLanguage('fr;q=0,*;q=0.5')).toBeNull();
  });

  it('returns null for an empty or missing header', () => {
    expect(localeFromAcceptLanguage(undefined)).toBeNull();
    expect(localeFromAcceptLanguage('')).toBeNull();
  });
});

describe('locale helpers', () => {
  it('maps tags to interface languages by primary subtag', () => {
    expect(toAppLocale('FR-ca')).toBe('fr');
    expect(toAppLocale('en_US')).toBe('en');
    expect(toAppLocale('es')).toBeNull();
    expect(toAppLocale(null)).toBeNull();
  });

  it('keeps English dates and numbers on en-GB', () => {
    expect(intlLocale('en')).toBe('en-GB');
    expect(intlLocale('fr')).toBe('fr-FR');
  });
});

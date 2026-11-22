/**
 * The interface languages (#654, ADR-0029). English is the default and
 * the reference: every key exists in English first, and the French file
 * must hold the same keys (see `messages.spec.ts`).
 *
 * The locale is never part of the URL. It is resolved on each request
 * from the user's stored preference, the `oci-locale` cookie, the
 * browser's `Accept-Language`, then English (`resolve-locale.ts`).
 */
export const LOCALES = ['en', 'fr'] as const;
export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'en';

/** Set by the language switch and by `/settings`; read on each request. */
export const LOCALE_COOKIE = 'oci-locale';

/** One year: the choice should outlive sessions. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Each language's name in that language, for the switch and the settings list. */
export function localeName(locale: AppLocale): string {
  switch (locale) {
    case 'en':
      return 'English';
    case 'fr':
      return 'Français';
  }
}

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The interface language a BCP-47 tag asks for, or `null` when the
 * platform has no interface in that language. Only the primary subtag
 * counts: `fr-CH`, `fr-CA` and `FR` all mean French.
 */
export function toAppLocale(tag: string | null | undefined): AppLocale | null {
  if (typeof tag !== 'string') return null;
  const primary = tag.trim().split(/[-_]/)[0]?.toLowerCase() ?? '';
  return isAppLocale(primary) ? primary : null;
}

/**
 * The `Intl` locale that dates and numbers are formatted with. English
 * stays on `en-GB`, which the whole app used before translation (day
 * before month, 24-hour clock), so English pages read as they did.
 */
export function intlLocale(locale: AppLocale): string {
  return locale === 'fr' ? 'fr-FR' : 'en-GB';
}

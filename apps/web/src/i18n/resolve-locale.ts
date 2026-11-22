import { DEFAULT_LOCALE, toAppLocale, type AppLocale } from './locales';

/** What a request says about the language it wants, strongest first. */
export interface LocaleSignals {
  /** The signed-in user's stored preference (`identity.user_preferences.locale`). */
  preference?: string | null;
  /** The `oci-locale` cookie, set by the language switch or `/settings`. */
  cookie?: string | null;
  /** The browser's `Accept-Language` header. */
  acceptLanguage?: string | null;
}

/**
 * The interface language for a request (#654): the user's preference,
 * then the cookie, then the browser's `Accept-Language`, then English.
 * A signal naming a language the platform has no interface in (a stored
 * `de-CH`, say) is skipped, not obeyed as English, so the next one gets
 * its say.
 */
export function resolveLocale(signals: LocaleSignals): AppLocale {
  return (
    toAppLocale(signals.preference) ??
    toAppLocale(signals.cookie) ??
    localeFromAcceptLanguage(signals.acceptLanguage) ??
    DEFAULT_LOCALE
  );
}

/**
 * The first interface language in an `Accept-Language` header, by
 * quality then by order (RFC 9110 §12.5.4). `*` and `q=0` entries ask
 * for nothing in particular and are ignored.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): AppLocale | null {
  if (typeof header !== 'string' || header.length === 0) return null;
  const ranges = header
    // Bounded: a header longer than this is not a browser's.
    .slice(0, 1000)
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const q = qParam === undefined ? 1 : Number(qParam.slice(2));
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((range) => range.tag.length > 0 && range.tag !== '*' && range.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const range of ranges) {
    const locale = toAppLocale(range.tag);
    if (locale !== null) return locale;
  }
  return null;
}

import { getRequestConfig } from 'next-intl/server';
import type { AppLocale } from './locales';
import type { Messages } from './messages/en';
import { requestLocale } from './request-locale';

/** Only the request's language is loaded; the other catalogue stays on disk. */
async function loadMessages(locale: AppLocale): Promise<Messages> {
  return locale === 'fr'
    ? (await import('./messages/fr')).default
    : (await import('./messages/en')).default;
}

/**
 * next-intl's per-request configuration (#654, ADR-0028), wired in by
 * the plugin in `next.config.ts`. No locale segment in the URL and no
 * next-intl middleware: the language is resolved here from the user's
 * preference, the cookie and `Accept-Language`.
 */
export default getRequestConfig(async () => {
  const locale = await requestLocale();
  return {
    locale,
    messages: await loadMessages(locale),
    // Dates are formatted through `i18n/format.ts`, which keeps the
    // server's zone as before; this only fixes next-intl's own default.
    timeZone: 'UTC',
  };
});

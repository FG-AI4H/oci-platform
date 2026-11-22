import { cookies } from 'next/headers';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS, type AppLocale } from './locales';

/**
 * Remembers the interface language in this browser, signed in or not
 * (#654). Server actions only: cookies are read-only while a page
 * renders.
 */
export async function writeLocaleCookie(locale: AppLocale): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
  });
}

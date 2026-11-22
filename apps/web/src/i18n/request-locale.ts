import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import type { UserPreferences } from '@oci/shared-types';
import { auth } from '../auth';
import { apiFetch } from '../lib/api';
import type { AppLocale } from './locales';
import { LOCALE_COOKIE } from './locales';
import { resolveLocale } from './resolve-locale';

/**
 * The signed-in user's stored language preference, or `null` (signed
 * out, none set, or the API did not answer). Read once per request.
 *
 * Read from the API rather than from a cookie copy, so a preference set
 * on another device applies here from the first page. A failure is not
 * a reason to fail the page: the cookie and the browser decide instead.
 */
const storedPreference = cache(async (): Promise<string | null> => {
  const session = await auth();
  if (!session?.user) return null;
  try {
    const preferences = await apiFetch<UserPreferences>('/v2/preferences/me', {
      session,
      revalidate: 0,
    });
    return preferences?.locale ?? null;
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
});

/**
 * The interface language of the current request (#654). Runs where the
 * page renders, not in `proxy.ts`: the proxy keeps the session cookie
 * current and is left as it is; the language needs nothing written on
 * the response, only read from it.
 */
export const requestLocale = cache(async (): Promise<AppLocale> => {
  const [cookieStore, headerList, preference] = await Promise.all([
    cookies(),
    headers(),
    storedPreference(),
  ]);
  return resolveLocale({
    preference,
    cookie: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerList.get('accept-language'),
  });
});

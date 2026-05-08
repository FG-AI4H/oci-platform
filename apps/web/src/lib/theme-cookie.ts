import { cookies } from 'next/headers';
import { DarkModeSchema, type DarkMode } from '@oci/shared-types';

/**
 * Cookie name for the user's dark-mode preference. Mirrored from the
 * canonical row in `identity.user_preferences` so SSR can render the
 * right `data-theme` on `<html>` without an API round-trip on every
 * page load.
 */
export const THEME_COOKIE = 'oci-theme';

/** One year in seconds — long enough to survive sessions; the cookie
 *  is rewritten on every preferences PUT, so it stays in sync. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function readThemeCookie(): Promise<DarkMode> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  const parsed = DarkModeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'system';
}

export async function writeThemeCookie(value: DarkMode): Promise<void> {
  (await cookies()).set(THEME_COOKIE, value, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false, // readable by client JS in case we add a tab-sync listener
    maxAge: ONE_YEAR_SECONDS,
  });
}

/**
 * Returns the `data-theme` attribute value to put on `<html>`:
 *   - 'dark'  → force dark
 *   - 'light' → force light (suppresses prefers-color-scheme)
 *   - null    → no attribute (let prefers-color-scheme decide)
 */
export function themeAttr(mode: DarkMode): 'dark' | 'light' | null {
  return mode === 'system' ? null : mode;
}

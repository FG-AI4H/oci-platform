'use server';

import { unstable_rethrow } from 'next/navigation';
import type { UpdateUserPreferencesRequest } from '@oci/shared-types';
import { auth } from '../auth';
import { fetchAsUser } from '../lib/api-action';
import { writeLocaleCookie } from './locale-cookie';
import { isAppLocale } from './locales';

/**
 * The header's language switch (#654). Writes the cookie and, for a
 * signed-in user, the stored preference too: the preference outranks
 * the cookie, so a switch that left it alone would not switch anything.
 *
 * Setting a cookie in a server action re-renders the page the form is
 * on, so the new language shows at once, on the same URL.
 */
export async function switchLocaleAction(formData: FormData): Promise<void> {
  const locale = formData.get('locale');
  if (!isAppLocale(locale)) return;
  await writeLocaleCookie(locale);

  const session = await auth();
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!session?.user || !base) return;
  const body: UpdateUserPreferencesRequest = { locale };
  // A save that fails (an error status or a thrown fetch) leaves the old
  // preference in charge, so the page stays in its language until the
  // user tries again or uses /settings, which reports errors. The cookie
  // is written either way and applies once signed out. The switch itself
  // has nowhere to show an error.
  try {
    const res = await fetchAsUser(`${base}/v2/preferences/me`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) console.warn(`language switch: preferences PUT answered ${res.status}`);
  } catch (err) {
    unstable_rethrow(err);
  }
}

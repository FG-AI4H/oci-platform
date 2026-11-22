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
  try {
    await fetchAsUser(`${base}/v2/preferences/me`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (err) {
    // A failed save leaves the old preference in charge; the cookie is
    // still written. Not worth an error page for the user.
    unstable_rethrow(err);
  }
}

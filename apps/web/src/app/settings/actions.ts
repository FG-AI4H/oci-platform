'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { zodParseParams } from '../../i18n/zod';
import {
  DarkModeSchema,
  DensitySchema,
  LocaleSchema,
  UpdateUserPreferencesRequestSchema,
  type UpdateUserPreferencesRequest,
} from '@oci/shared-types';
import { z } from 'zod';
import { writeLocaleCookie } from '../../i18n/locale-cookie';
import { LOCALE_COOKIE, toAppLocale } from '../../i18n/locales';
import { fetchAsUser } from '../../lib/api-action';
import { sessionForAction } from '../../lib/session-recovery';
import { writeThemeCookie } from '../../lib/theme-cookie';

export interface PreferencesFormValues {
  darkMode: string;
  density: string;
  locale: string;
}

export type PreferencesFormState =
  | { status: 'idle' }
  | { status: 'success'; values: PreferencesFormValues }
  | {
      status: 'error';
      message: string;
      fieldErrors?: ReadonlyMap<string, string>;
      values?: PreferencesFormValues;
    };

const FormSchema = z
  .object({
    darkMode: DarkModeSchema,
    density: DensitySchema,
    // Empty string from the form means "use browser default" → null.
    locale: z
      .string()
      .max(35)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null))
      .pipe(LocaleSchema.nullable()),
  })
  .strict();

/**
 * Server action invoked by `/settings`. Validates the form, forwards
 * to `PUT /v2/preferences/me`, mirrors the dark-mode value into the
 * `oci-theme` cookie so the SSR layout can render the right palette
 * on the very next request, and revalidates the settings path so the
 * form re-displays the canonical server state.
 *
 * The language (#654) applies on the redirect that follows: the layout
 * reads the stored preference first. It is also mirrored into the
 * `oci-locale` cookie so the choice holds after signing out; "follow my
 * browser" (or a saved tag with no interface) clears the cookie, or an old
 * switch choice would win.
 */
export async function updatePreferencesAction(
  _prev: PreferencesFormState,
  formData: FormData,
): Promise<PreferencesFormState> {
  const session = await sessionForAction();
  const t = await getTranslations('Settings');
  const common = await getTranslations('Common');
  if (!session?.user) {
    return { status: 'error', message: t('signIn') };
  }

  const raw: PreferencesFormValues = {
    darkMode: String(formData.get('darkMode') ?? 'system'),
    density: String(formData.get('density') ?? 'comfortable'),
    locale: String(formData.get('locale') ?? ''),
  };

  const parsed = FormSchema.safeParse(raw, zodParseParams(await getLocale()));
  if (!parsed.success) {
    const fieldErrors = new Map<string, string>();
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? '');
      if (k && !fieldErrors.has(k)) fieldErrors.set(k, issue.message);
    }
    return {
      status: 'error',
      message: common('correctErrors'),
      fieldErrors,
      values: raw,
    };
  }

  const body: UpdateUserPreferencesRequest = parsed.data;
  // Defensive parse against the canonical schema as well — keeps form
  // and API contract aligned even if the schema drifts later.
  const apiCheck = UpdateUserPreferencesRequestSchema.safeParse(body);
  if (!apiCheck.success) {
    return { status: 'error', message: t('invalidShape'), values: raw };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: common('apiBaseUrlMissing') };
  }
  const res = await fetchAsUser(`${base}/v2/preferences/me`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      status: 'error',
      message: common('apiError', {
        status: String(res.status),
        statusText: res.statusText,
        detail: text.slice(0, 300),
      }),
      values: raw,
    };
  }

  await writeThemeCookie(parsed.data.darkMode);
  const interfaceLocale = toAppLocale(parsed.data.locale);
  // "Follow my browser", or a tag with no interface: drop an older switch
  // choice, which would otherwise outrank the browser.
  if (interfaceLocale !== null) await writeLocaleCookie(interfaceLocale);
  else (await cookies()).delete(LOCALE_COOKIE);
  revalidatePath('/settings');
  // Re-render the settings page with the new server state.
  redirect('/settings?saved=1');
}

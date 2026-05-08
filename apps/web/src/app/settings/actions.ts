'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  DarkModeSchema,
  DensitySchema,
  LocaleSchema,
  UpdateUserPreferencesRequestSchema,
  type UpdateUserPreferencesRequest,
} from '@oci/shared-types';
import { z } from 'zod';
import { auth } from '../../auth';
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
 */
export async function updatePreferencesAction(
  _prev: PreferencesFormState,
  formData: FormData,
): Promise<PreferencesFormState> {
  const session = await auth();
  if (!session?.accessToken) {
    return { status: 'error', message: 'Sign in to change your preferences.' };
  }

  const raw: PreferencesFormValues = {
    darkMode: String(formData.get('darkMode') ?? 'system'),
    density: String(formData.get('density') ?? 'comfortable'),
    locale: String(formData.get('locale') ?? ''),
  };

  const parsed = FormSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = new Map<string, string>();
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? '');
      if (k && !fieldErrors.has(k)) fieldErrors.set(k, issue.message);
    }
    return {
      status: 'error',
      message: 'Please correct the errors below.',
      fieldErrors,
      values: raw,
    };
  }

  const body: UpdateUserPreferencesRequest = parsed.data;
  // Defensive parse against the canonical schema as well — keeps form
  // and API contract aligned even if the schema drifts later.
  const apiCheck = UpdateUserPreferencesRequestSchema.safeParse(body);
  if (!apiCheck.success) {
    return { status: 'error', message: 'Invalid preferences shape.', values: raw };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.' };
  }
  const res = await fetch(`${base}/v2/preferences/me`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
      values: raw,
    };
  }

  await writeThemeCookie(parsed.data.darkMode);
  revalidatePath('/settings');
  // Re-render the settings page with the new server state.
  redirect('/settings?saved=1');
}

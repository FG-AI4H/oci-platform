'use server';

import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { zodParseParams } from '../../../i18n/zod';
import { z } from 'zod';
import {
  CreateDatasetRequestSchema,
  DatasetSlugSchema,
  type DatasetDetail,
} from '@oci/shared-types';
import { fetchAsUser } from '../../../lib/api-action';
import { isHost } from '../../../lib/groups';
import { sessionForAction } from '../../../lib/session-recovery';

export interface CreateDatasetValues {
  slug: string;
  name: string;
  description: string;
  visibility: string;
}

export type CreateDatasetState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      fieldErrors?: ReadonlyMap<string, string>;
      values?: CreateDatasetValues;
    };

const FormSchema = CreateDatasetRequestSchema.extend({
  // FormData entries arrive as strings; coerce blanks to undefined so
  // Zod's `.optional().nullable()` shape matches the API contract.
  description: z
    .string()
    .max(2000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

/**
 * Server action invoked by the `/catalog/new` form. Validates the
 * fields, forwards the create request to the API on behalf of the
 * caller (server-side fetch with the NextAuth-attached bearer token),
 * and redirects to the publish step on success. Returns an error
 * state with field-level messages otherwise.
 *
 * Messages are in the interface language (`CatalogNew`, `Common`);
 * field-level messages from the Zod schema stay as Zod words them.
 */
export async function createDatasetAction(
  _prev: CreateDatasetState,
  formData: FormData,
): Promise<CreateDatasetState> {
  const [t, tCommon] = await Promise.all([
    getTranslations('CatalogNew'),
    getTranslations('Common'),
  ]);
  const session = await sessionForAction();
  if (!session?.user || !isHost(session)) {
    return { status: 'error', message: t('errors.onlyHosts') };
  }

  const raw = {
    slug: String(formData.get('slug') ?? ''),
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    visibility: String(formData.get('visibility') ?? 'PRIVATE'),
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
      message: tCommon('correctErrors'),
      fieldErrors,
      values: raw,
    };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: t('errors.apiBaseUrlMissing') };
  }
  const res = await fetchAsUser(`${base}/v2/catalog/datasets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });

  if (res.status === 409) {
    return {
      status: 'error',
      message: t('errors.slugTaken', { slug: parsed.data.slug }),
      fieldErrors: new Map([['slug', t('errors.slugTakenField')]]),
      values: raw,
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: tCommon('apiError', {
        status: res.status,
        statusText: res.statusText,
        detail: body.slice(0, 300),
      }),
      values: raw,
    };
  }

  const ds = (await res.json()) as DatasetDetail;
  // Defensive: validate the returned slug really matches what we sent
  // (the API canonicalises). Use the same Zod schema rather than a
  // bare === so unexpected shapes surface as a proper error.
  const slugCheck = DatasetSlugSchema.safeParse(ds.slug);
  if (!slugCheck.success) {
    return { status: 'error', message: t('errors.unexpectedShape') };
  }
  redirect(`/catalog/${slugCheck.data}/publish`);
}

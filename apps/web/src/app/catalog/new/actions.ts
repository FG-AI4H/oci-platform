'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  CreateDatasetRequestSchema,
  DatasetSlugSchema,
  type DatasetDetail,
} from '@oci/shared-types';
import { auth } from '../../../auth';
import { isHost } from '../../../lib/groups';

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
 */
export async function createDatasetAction(
  _prev: CreateDatasetState,
  formData: FormData,
): Promise<CreateDatasetState> {
  const session = await auth();
  if (!session?.accessToken || !isHost(session)) {
    return { status: 'error', message: 'Only hosts can create datasets.' };
  }

  const raw = {
    slug: String(formData.get('slug') ?? ''),
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    visibility: String(formData.get('visibility') ?? 'PRIVATE'),
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

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.' };
  }
  const res = await fetch(`${base}/v2/catalog/datasets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });

  if (res.status === 409) {
    return {
      status: 'error',
      message: `Slug "${parsed.data.slug}" is already taken.`,
      fieldErrors: new Map([['slug', 'taken']]),
      values: raw,
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
      values: raw,
    };
  }

  const ds = (await res.json()) as DatasetDetail;
  // Defensive: validate the returned slug really matches what we sent
  // (the API canonicalises). Use the same Zod schema rather than a
  // bare === so unexpected shapes surface as a proper error.
  const slugCheck = DatasetSlugSchema.safeParse(ds.slug);
  if (!slugCheck.success) {
    return { status: 'error', message: 'API returned an unexpected dataset shape.' };
  }
  redirect(`/catalog/${slugCheck.data}/publish`);
}

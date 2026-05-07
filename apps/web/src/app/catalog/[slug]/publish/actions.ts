'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { DatasetSlugSchema, PublishDatasetVersionRequestSchema } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { isHost } from '../../../../lib/groups';

export interface ManifestIssue {
  /**
   * JSON-pointer-ish path produced by `@oci/croissant`'s validator
   * (e.g. `/distribution/0/contentUrl`). Free-form string; surfaced
   * verbatim in the validation panel.
   */
  path?: string;
  message: string;
  severity?: string;
}

export interface PublishVersionValues {
  version: string;
  notes: string;
  manifest: string;
}

export type PublishVersionState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      fieldErrors?: ReadonlyMap<string, string>;
      values?: PublishVersionValues;
    }
  | {
      status: 'invalid-manifest';
      message: string;
      conformance: string;
      issues: ManifestIssue[];
      values?: PublishVersionValues;
    };

const FormSchema = z.object({
  slug: DatasetSlugSchema,
  version: PublishDatasetVersionRequestSchema.shape.version,
  notes: z
    .string()
    .max(4000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  manifest: z.string().min(2, 'paste or upload a Croissant manifest JSON'),
});

/**
 * Server action for `/catalog/<slug>/publish`. Parses the JSON
 * manifest client-side (pre-flight, so we don't waste an API round
 * trip on a syntax error), then POSTs to the API. The API runs the
 * full Croissant 1.1 + RAI + BIOCroissant validator; failures come
 * back as a 400 with `{conformance, issues}` which we surface in the
 * UI as a structured panel rather than a wall of text.
 */
export async function publishVersionAction(
  _prev: PublishVersionState,
  formData: FormData,
): Promise<PublishVersionState> {
  const session = await auth();
  if (!session?.accessToken || !isHost(session)) {
    return { status: 'error', message: 'Only hosts can publish dataset versions.' };
  }

  const raw = {
    slug: String(formData.get('slug') ?? ''),
    version: String(formData.get('version') ?? ''),
    notes: String(formData.get('notes') ?? ''),
    manifest: String(formData.get('manifest') ?? ''),
  };
  const echoed: PublishVersionValues = {
    version: raw.version,
    notes: raw.notes,
    manifest: raw.manifest,
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
      values: echoed,
    };
  }

  let croissant: unknown;
  try {
    croissant = JSON.parse(parsed.data.manifest);
  } catch (err) {
    return {
      status: 'error',
      message: 'Manifest is not valid JSON.',
      fieldErrors: new Map([['manifest', err instanceof Error ? err.message : 'parse error']]),
      values: echoed,
    };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.' };
  }
  const res = await fetch(
    `${base}/v2/catalog/datasets/${encodeURIComponent(parsed.data.slug)}/versions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        version: parsed.data.version,
        notes: parsed.data.notes,
        croissant,
      }),
      cache: 'no-store',
    },
  );

  if (res.status === 400) {
    const body = await res.json().catch(() => null);
    if (body && Array.isArray(body.issues)) {
      return {
        status: 'invalid-manifest',
        message: typeof body.message === 'string' ? body.message : 'Manifest validation failed.',
        conformance: typeof body.conformance === 'string' ? body.conformance : 'unknown',
        issues: body.issues as ManifestIssue[],
        values: echoed,
      };
    }
    return {
      status: 'error',
      message:
        typeof body?.message === 'string'
          ? body.message
          : `API 400: ${JSON.stringify(body).slice(0, 300)}`,
      values: echoed,
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
      values: echoed,
    };
  }

  redirect(`/catalog/${parsed.data.slug}`);
}

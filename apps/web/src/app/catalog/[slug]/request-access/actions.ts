'use server';

import { redirect } from 'next/navigation';
import { CreateAccessRequestRequestSchema } from '@oci/shared-types';
import { auth } from '../../../../auth';

export interface RequestAccessValues {
  justification: string;
  irbApproved: string;
  irbApprovalRef: string;
  dpiaRef: string;
  dataRetentionDays: string;
  duoConsent: string;
}

export type RequestAccessState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      fieldErrors?: ReadonlyMap<string, string>;
      values?: RequestAccessValues;
    };

/**
 * Server action: POST /v2/catalog/datasets/:slug/access-requests on
 * behalf of the authenticated caller. Validates the form fields with
 * the same Zod schema the API uses, then forwards. Redirects to
 * `/dashboard/access-requests` on success.
 */
export async function requestAccessAction(
  slug: string,
  _prev: RequestAccessState,
  formData: FormData,
): Promise<RequestAccessState> {
  const session = await auth();
  if (!session?.accessToken) {
    return { status: 'error', message: 'Sign in required.' };
  }

  const raw: RequestAccessValues = {
    justification: String(formData.get('justification') ?? ''),
    irbApproved: String(formData.get('irbApproved') ?? ''),
    irbApprovalRef: String(formData.get('irbApprovalRef') ?? ''),
    dpiaRef: String(formData.get('dpiaRef') ?? ''),
    dataRetentionDays: String(formData.get('dataRetentionDays') ?? ''),
    duoConsent: String(formData.get('duoConsent') ?? ''),
  };

  // FormData is all strings; coerce to the contract shape before parse.
  const candidate = {
    justification: raw.justification,
    attestations: {
      irbApproved: raw.irbApproved === 'true' || raw.irbApproved === 'on',
      irbApprovalRef: raw.irbApprovalRef.length > 0 ? raw.irbApprovalRef : null,
      dpiaRef: raw.dpiaRef.length > 0 ? raw.dpiaRef : null,
      dataRetentionDays: raw.dataRetentionDays.length > 0 ? Number(raw.dataRetentionDays) : null,
      // One IRI per line. Empty lines + whitespace are dropped.
      duoConsent: raw.duoConsent
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    },
  };

  const parsed = CreateAccessRequestRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    const fieldErrors = new Map<string, string>();
    for (const issue of parsed.error.issues) {
      // Surface attestation issues under the leaf field name so the
      // form can highlight them; surface top-level issues under their
      // own key.
      const path = issue.path;
      const key =
        path.length === 0
          ? '_form'
          : path[path.length - 1] !== undefined
            ? String(path[path.length - 1])
            : '_form';
      if (!fieldErrors.has(key)) fieldErrors.set(key, issue.message);
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
  const res = await fetch(
    `${base}/v2/catalog/datasets/${encodeURIComponent(slug)}/access-requests`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
      values: raw,
    };
  }

  redirect('/dashboard/access-requests');
}

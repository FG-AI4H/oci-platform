'use server';

import { redirect } from 'next/navigation';
import { CreateRemoteCatalogRequestSchema, type RemoteCatalogDetail } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { isAdmin } from '../../../../lib/groups';

export interface CreateRemoteValues {
  slug: string;
  name: string;
  endpointUrl: string;
  description: string;
}

export type CreateRemoteState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      fieldErrors?: ReadonlyMap<string, string>;
      values?: CreateRemoteValues;
    };

/**
 * Server action invoked by `/catalog/remotes/new`. Forwards the
 * register request to the API on behalf of the caller, and redirects
 * to the detail page on success.
 */
export async function createRemoteAction(
  _prev: CreateRemoteState,
  formData: FormData,
): Promise<CreateRemoteState> {
  const session = await auth();
  if (!session?.accessToken || !isAdmin(session)) {
    return { status: 'error', message: 'Only admins can register peer catalogues.' };
  }

  const raw: CreateRemoteValues = {
    slug: String(formData.get('slug') ?? ''),
    name: String(formData.get('name') ?? ''),
    endpointUrl: String(formData.get('endpointUrl') ?? ''),
    description: String(formData.get('description') ?? ''),
  };

  const parsed = CreateRemoteCatalogRequestSchema.safeParse({
    slug: raw.slug,
    name: raw.name,
    endpointUrl: raw.endpointUrl,
    description: raw.description.length > 0 ? raw.description : null,
  });
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
  const res = await fetch(`${base}/v2/catalog/remotes`, {
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

  const remote = (await res.json()) as RemoteCatalogDetail;
  redirect(`/catalog/remotes/${remote.id}`);
}

'use server';

import { redirect } from 'next/navigation';
import { auth } from '../../../../auth';
import { isAdmin } from '../../../../lib/groups';

export type DeleteRemoteState = { status: 'idle' } | { status: 'error'; message: string };

/**
 * Server action invoked by the deregister form on
 * `/catalog/remotes/[id]`. On success, redirects back to the list.
 */
export async function deleteRemoteAction(
  _prev: DeleteRemoteState,
  formData: FormData,
): Promise<DeleteRemoteState> {
  const session = await auth();
  if (!session?.accessToken || !isAdmin(session)) {
    return { status: 'error', message: 'Only admins can deregister peer catalogues.' };
  }

  const id = String(formData.get('id') ?? '');
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return { status: 'error', message: 'Invalid id.' };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.' };
  }
  const res = await fetch(`${base}/v2/catalog/remotes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: 'no-store',
  });
  if (res.status === 404) {
    return { status: 'error', message: 'Peer no longer exists.' };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
    };
  }

  redirect('/catalog/remotes');
}

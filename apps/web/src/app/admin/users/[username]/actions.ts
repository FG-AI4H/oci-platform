'use server';

import { revalidatePath } from 'next/cache';
import { PlatformGroupSchema, type PlatformGroup } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { isAdmin } from '../../../../lib/groups';

export type GroupActionResult =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

/**
 * Toggle a Cognito group membership for the target user. The form on
 * the detail page renders one checkbox per known group with the
 * current value as `defaultChecked`; on submit we call this action,
 * which figures out whether to POST or DELETE based on the checked
 * state.
 *
 * We don't trust the client about whether the group was set before —
 * the API itself is idempotent (the service no-ops when the new state
 * matches), so a slightly stale form doesn't corrupt history.
 */
export async function toggleGroupAction(
  _prev: GroupActionResult,
  formData: FormData,
): Promise<GroupActionResult> {
  const session = await auth();
  if (!session?.accessToken || !isAdmin(session)) {
    return { status: 'error', message: 'Only admins can change group memberships.' };
  }

  const username = String(formData.get('username') ?? '');
  if (!username) return { status: 'error', message: 'Missing target username.' };

  const groupRaw = String(formData.get('group') ?? '');
  const groupParse = PlatformGroupSchema.safeParse(groupRaw);
  if (!groupParse.success) {
    return { status: 'error', message: `Unknown group: ${groupRaw}` };
  }
  const group: PlatformGroup = groupParse.data;

  const desired = formData.get('desired') === 'on' ? 'grant' : 'revoke';

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.' };
  }

  const url =
    desired === 'grant'
      ? `${base}/v2/admin/users/${encodeURIComponent(username)}/groups`
      : `${base}/v2/admin/users/${encodeURIComponent(username)}/groups/${encodeURIComponent(group)}`;

  const res = await fetch(url, {
    method: desired === 'grant' ? 'POST' : 'DELETE',
    headers: {
      ...(desired === 'grant' ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: desired === 'grant' ? JSON.stringify({ group }) : undefined,
    cache: 'no-store',
  });

  if (res.status === 403) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: body.includes('admin')
        ? 'You cannot remove your own admin group. Have another admin do it.'
        : 'Forbidden — admin role required.',
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      status: 'error',
      message: `API ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
    };
  }

  // Force the detail page to re-fetch so the audit trail surfaces the
  // new event without a manual refresh.
  revalidatePath(`/admin/users/${username}`);
  revalidatePath('/admin/users');

  return {
    status: 'success',
    message: desired === 'grant' ? `Granted ${group}.` : `Revoked ${group}.`,
  };
}

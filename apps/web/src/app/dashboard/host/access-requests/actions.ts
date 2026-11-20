'use server';

import { revalidatePath } from 'next/cache';
import { AccessRequestDecisionSchema } from '@oci/shared-types';
import { fetchAsUser } from '../../../../lib/api-action';
import { isHost } from '../../../../lib/groups';
import { sessionForAction } from '../../../../lib/session-recovery';

export type DecisionState = { status: 'idle' } | { status: 'error'; message: string };

/**
 * Server action: POST /v2/catalog/access-requests/:id/decision.
 * Wired to the host inbox. The decision form posts the request id as
 * a hidden field; this action looks it up, calls the API, and
 * revalidates the inbox so the row's status updates without a manual
 * reload.
 */
export async function decideAction(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const session = await sessionForAction();
  if (!session?.user || !isHost(session)) {
    return { status: 'error', message: 'Only hosts can decide access requests.' };
  }

  const id = String(formData.get('id') ?? '');
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return { status: 'error', message: 'Invalid request id.' };
  }

  const parsed = AccessRequestDecisionSchema.safeParse({
    status: String(formData.get('status') ?? ''),
    decisionNote: String(formData.get('decisionNote') ?? '').slice(0, 4000) || null,
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Decision must be APPROVED, DENIED, or REVOKED.' };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    return { status: 'error', message: 'NEXT_PUBLIC_API_BASE_URL not set in web env.' };
  }
  const res = await fetchAsUser(
    `${base}/v2/catalog/access-requests/${encodeURIComponent(id)}/decision`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
    };
  }

  // Bust the inbox cache so the row's status flips immediately.
  revalidatePath('/dashboard/host/access-requests');
  return { status: 'idle' };
}

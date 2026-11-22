'use server';

import { unstable_rethrow } from 'next/navigation';
import type { AuditChainVerification } from '@oci/shared-types';
import { fetchAsUser } from '../../../lib/api-action';
import { canReadAuditTrail } from '../../../lib/groups';
import { sessionForAction } from '../../../lib/session-recovery';
import { AUDIT_PAGE } from './strings';

export type VerifyState =
  | { status: 'idle' }
  | { status: 'done'; result: AuditChainVerification }
  | { status: 'error'; message: string };

/**
 * "Verify chain": `GET /v2/audit/events/verify` as the signed-in caller,
 * over the whole trail. The token stays on the server (ADR-0027). The
 * API decides who may verify; the check here spares a round trip.
 */
export async function verifyChainAction(_prev: VerifyState): Promise<VerifyState> {
  const session = await sessionForAction();
  if (!session?.user || !canReadAuditTrail(session)) {
    return { status: 'error', message: AUDIT_PAGE.verifyNotAllowed };
  }
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { status: 'error', message: AUDIT_PAGE.verifyFailed };
  try {
    const res = await fetchAsUser(
      `${base}/v2/audit/events/verify`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' },
      { returnTo: '/admin/audit' },
    );
    if (res.status === 403) return { status: 'error', message: AUDIT_PAGE.verifyNotAllowed };
    if (!res.ok) return { status: 'error', message: AUDIT_PAGE.verifyFailed };
    return { status: 'done', result: (await res.json()) as AuditChainVerification };
  } catch (err) {
    unstable_rethrow(err);
    return { status: 'error', message: AUDIT_PAGE.verifyFailed };
  }
}

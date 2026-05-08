import { createHash } from 'node:crypto';
import type { Session } from 'next-auth';
import { userGroups } from './groups';

/**
 * Mirror of the API's `subToUuid` — the deterministic UUIDv5 derivation
 * applied to a Cognito sub before it's used as a soft FK onto
 * `identity.users.id`. Same `SUB_NAMESPACE_UUID` constant; same
 * fall-through for already-UUID-shaped subs (which is what the
 * local-dev Credentials provider hands out).
 *
 * Used on the web side to detect "viewer is the host of THIS dataset"
 * by comparing `subToUuid(session.user.sub)` against `detail.hostId`
 * (which the API already serialises as a UUID).
 */
const SUB_NAMESPACE_UUID = 'a4f1c8b2-7d3e-5b9c-9f0a-3c8d4e5f6a7b';
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function subToUuid(sub: string): string {
  if (UUID_RE.test(sub)) return sub.toLowerCase();
  const nsBytes = Buffer.from(SUB_NAMESPACE_UUID.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(Buffer.from(sub, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * True iff the signed-in viewer is the host of the given dataset.
 * Requires the `host` group AND the derived UUID to match the
 * dataset's `hostId`. PR L.1 (#91).
 */
export function isHostOfDataset(
  session: Session | null | undefined,
  datasetHostId: string,
): boolean {
  if (!session?.user) return false;
  const sub =
    (session.user as { id?: string; sub?: string }).id ??
    (session.user as { id?: string; sub?: string }).sub;
  if (!sub) return false;
  if (!userGroups(session).includes('host')) return false;
  return subToUuid(sub).toLowerCase() === datasetHostId.toLowerCase();
}

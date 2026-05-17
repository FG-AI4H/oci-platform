import type { Session } from 'next-auth';
import { redirect } from 'next/navigation';

/**
 * Reads the caller's Cognito group memberships out of the NextAuth
 * session. Two token shapes are supported, picked by prefix so the
 * same call site works in both deployed envs and the local-dev stub:
 *
 *   - `dev:<user>:<roles>` (the local Credentials provider's
 *     sentinel — see [auth.ts](../auth.ts)). Roles are the
 *     comma-separated tail.
 *   - JWT (real Cognito access token). The `cognito:groups` claim
 *     lives in the payload (segment 1, base64url).
 *
 * Returns `[]` when no token is attached, the JWT can't be decoded,
 * or the claim is missing — never throws. Callers should treat the
 * empty list as "no privileged role" and gate accordingly.
 */
export function userGroups(session: Session | null | undefined): string[] {
  const token = session?.accessToken;
  if (!token || typeof token !== 'string') return [];

  if (token.startsWith('dev:')) {
    // Format: dev:<user>:<roles>. The user value can itself contain
    // colons (e.g. an email) so we split off the prefix and keep the
    // last colon-separated segment as the roles list.
    const rest = token.slice('dev:'.length);
    const lastColon = rest.lastIndexOf(':');
    if (lastColon < 0) return [];
    return rest
      .slice(lastColon + 1)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Real Cognito access token — JWT, three base64url segments.
  const parts = token.split('.');
  if (parts.length !== 3) return [];
  try {
    const payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as {
      'cognito:groups'?: unknown;
    };
    const groups = payload['cognito:groups'];
    return Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Returns the caller's principal identifier — either the `sub` from a
 * real Cognito JWT, or the `<user>` segment of a `dev:<user>:<roles>`
 * sentinel. Useful for "is this me?" comparisons against an API-side
 * `AdminUserSummary.sub` / `.username`. Returns `null` when the
 * session has no token attached.
 */
export function userSub(session: Session | null | undefined): string | null {
  const token = session?.accessToken;
  if (!token || typeof token !== 'string') return null;

  if (token.startsWith('dev:')) {
    const rest = token.slice('dev:'.length);
    const lastColon = rest.lastIndexOf(':');
    return lastColon < 0 ? null : rest.slice(0, lastColon);
  }

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as {
      sub?: unknown;
    };
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** True when the caller belongs to the `host` or `admin` Cognito group. */
export function isHost(session: Session | null | undefined): boolean {
  const groups = userGroups(session);
  return groups.includes('host') || groups.includes('admin');
}

/** True when the caller belongs to the `admin` Cognito group. */
export function isAdmin(session: Session | null | undefined): boolean {
  return userGroups(session).includes('admin');
}

/**
 * True when the caller can create annotation campaigns. Mirrors the
 * server-side guard in `AnnotationRolesGuard`: `campaign-manager` is
 * the principal role; `admin` is the operator override. Phase B.A.1
 * still reads Cognito groups directly — visa-backed Annotation Visa
 * checks land with the queue endpoints (#215).
 */
export function isCampaignManager(session: Session | null | undefined): boolean {
  const groups = userGroups(session);
  return groups.includes('campaign-manager') || groups.includes('admin');
}

/**
 * Server-side guard for host-only routes. Redirects unauthenticated
 * callers to the home page (sign-in CTA) and authenticated non-hosts
 * to /dashboard. Use at the top of a Server Component:
 *
 *   const session = await auth();
 *   requireHost(session);
 *
 * Returns the session (narrowed) when the check passes so callers
 * can use it without re-asserting non-null.
 */
export function requireHost(session: Session | null | undefined): Session {
  if (!session?.user) {
    redirect('/');
  }
  if (!isHost(session)) {
    redirect('/dashboard');
  }
  return session;
}

/** Server-side guard for admin-only routes (e.g. /catalog/remotes). */
export function requireAdmin(session: Session | null | undefined): Session {
  if (!session?.user) {
    redirect('/');
  }
  if (!isAdmin(session)) {
    redirect('/dashboard');
  }
  return session;
}

/** Server-side guard for /annotation/campaigns/new (campaign-manager only). */
export function requireCampaignManager(session: Session | null | undefined): Session {
  if (!session?.user) {
    redirect('/');
  }
  if (!isCampaignManager(session)) {
    redirect('/dashboard');
  }
  return session;
}

/**
 * Which annotation gate the caller is eligible to work at. Mirrors
 * `TaskService.gateFromGroups` on the API side — a caller with
 * multiple roles gets the earliest gate they qualify for (preserves
 * the SOP ordering: INDEPENDENT → AWAITING_ARBITRATION → AWAITING_EXPERT).
 *
 * `admin` is intentionally NOT auto-mapped here — operator override
 * is appropriate for lifecycle transitions but not for "pull a task
 * to annotate as if you were the annotator". Operators sign in with
 * an annotator role when they want to test the queue.
 */
export function annotationGateForCaller(
  session: Session | null | undefined,
): 'INDEPENDENT' | 'AWAITING_ARBITRATION' | 'AWAITING_EXPERT' | null {
  const groups = userGroups(session);
  if (groups.includes('annotator')) return 'INDEPENDENT';
  if (groups.includes('arbitration-annotator')) return 'AWAITING_ARBITRATION';
  if (groups.includes('expert-reviewer')) return 'AWAITING_EXPERT';
  return null;
}

/** True when the caller can pick up annotation work in at least one gate. */
export function isAnnotationWorker(session: Session | null | undefined): boolean {
  return annotationGateForCaller(session) !== null;
}

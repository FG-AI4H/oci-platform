import type { Session } from 'next-auth';
import { redirect } from 'next/navigation';

/**
 * The caller's Cognito group memberships, as the session carries them.
 *
 * The session callback (`auth.ts`) reads them from the access token
 * each time the session is read, so they follow the token: a role
 * granted during a session appears when the access token is next
 * renewed, within the hour (#643). The token itself is not on the
 * session; see `lib/token-claims.ts` for how the claims are read.
 *
 * Returns `[]` when nobody is signed in or the token carried no groups
 * — never throws. Callers should treat the empty list as "no
 * privileged role" and gate accordingly.
 */
export function userGroups(session: Session | null | undefined): string[] {
  const groups = session?.groups;
  return Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [];
}

/**
 * Returns the caller's principal identifier — either the `sub` from a
 * real Cognito access token, or the `<user>` segment of a
 * `dev:<user>:<roles>` sentinel, as the session callback copied it
 * onto the session. Useful for "is this me?" comparisons against an
 * API-side `AdminUserSummary.sub` / `.username`. Returns `null` when
 * nobody is signed in.
 */
export function userSub(session: Session | null | undefined): string | null {
  const subject = session?.subject;
  return typeof subject === 'string' && subject.length > 0 ? subject : null;
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

/**
 * True when the caller can read the audit trail: `admin` or `regulator`.
 * Mirrors `@Roles('admin', 'regulator')` on `/v2/audit`; the API's 403
 * stays authoritative.
 */
export function canReadAuditTrail(session: Session | null | undefined): boolean {
  const groups = userGroups(session);
  return groups.includes('admin') || groups.includes('regulator');
}

/** Server-side guard for /admin/audit (admin or regulator). */
export function requireAuditReader(session: Session | null | undefined): Session {
  if (!session?.user) {
    redirect('/');
  }
  if (!canReadAuditTrail(session)) {
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

/**
 * True when the caller oversees campaigns: can read a campaign's task
 * list (`GET /v2/annotation/campaigns/:slug/tasks`, #556) and its
 * calibration flags (#554). Mirrors
 * `@AnnotationRoles('campaign-manager', 'task-supervisor')` on both
 * endpoints, where `admin` is the operator override. Only decides what
 * the page shows; the API's 403 stays authoritative. Supervisors see
 * progress but not task seeding, which stays with `isCampaignManager`.
 * If the two endpoints' role sets ever diverge, split this again.
 */
export function canOverseeCampaign(session: Session | null | undefined): boolean {
  const groups = userGroups(session);
  return (
    groups.includes('campaign-manager') ||
    groups.includes('task-supervisor') ||
    groups.includes('admin')
  );
}

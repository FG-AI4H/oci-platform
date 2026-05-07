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

/**
 * What the web app reads out of the caller's access token: their groups
 * and their subject. Nothing else is taken from it, and only these two
 * are copied onto the session (#643); the token itself stays in the
 * encrypted session cookie.
 *
 * Two token shapes, told apart by prefix so the same code serves the
 * deployed environments and the local-dev stub:
 *
 *   - `dev:<user>:<roles>` — the local Credentials provider's sentinel
 *     (see `auth.ts`). Roles are the comma-separated tail.
 *   - a JWT — a real Cognito access token. The claims are in the payload
 *     (segment 1, base64url).
 *
 * The token is not verified here. It came from the pool's token
 * endpoint over TLS, and these claims only decide what the web app
 * shows; the API verifies the token on every call and stays the
 * authority on what the caller may do.
 */

const DEV_PREFIX = 'dev:';

function devParts(token: string): { user: string; roles: string } | null {
  // The user value can itself contain colons (e.g. an email), so the
  // LAST colon delimits the roles list.
  const rest = token.slice(DEV_PREFIX.length);
  const lastColon = rest.lastIndexOf(':');
  if (lastColon < 0) return null;
  return { user: rest.slice(0, lastColon), roles: rest.slice(lastColon + 1) };
}

function jwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'));
    return typeof claims === 'object' && claims !== null
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The caller's Cognito groups. `[]` when there is no token, it cannot
 * be decoded, or the claim is missing — never throws.
 */
export function groupsFromAccessToken(token: string | undefined): string[] {
  if (!token) return [];
  if (token.startsWith(DEV_PREFIX)) {
    const parts = devParts(token);
    if (!parts) return [];
    return parts.roles
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const groups = jwtClaims(token)?.['cognito:groups'];
  return Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [];
}

/**
 * The caller's principal identifier: the `sub` of a real access token,
 * or the `<user>` segment of the local-dev sentinel. `null` when there
 * is no token or it carries none.
 */
export function subjectFromAccessToken(token: string | undefined): string | null {
  if (!token) return null;
  if (token.startsWith(DEV_PREFIX)) return devParts(token)?.user ?? null;
  const sub = jwtClaims(token)?.sub;
  return typeof sub === 'string' ? sub : null;
}

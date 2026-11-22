import type { Session } from 'next-auth';
import { unstable_rethrow } from 'next/navigation';

/**
 * Thrown by `apiFetch` for any non-2xx, non-404 response. Carries the
 * HTTP status so callers can branch on it (e.g. render a not-authorised
 * state on 403) without parsing the message.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Where to send a caller whose API token was rejected (401), e.g. an
 * expired Cognito access token. `reason=expired` stops /signin from
 * bouncing straight back because the (stale) session still exists.
 */
export function reauthUrl(callbackPath: string): string {
  return `/signin?reason=expired&callbackUrl=${encodeURIComponent(callbackPath)}`;
}

/**
 * The signed-in caller's bearer token. The session object does not
 * carry it (#643); it is read from the encrypted session cookie. The
 * auth configuration is loaded on demand so this module stays free of
 * it for everything that only needs `ApiError`.
 */
async function callerAccessToken(): Promise<string | null> {
  const { sessionAccessToken } = await import('../auth');
  return sessionAccessToken();
}

/**
 * The token to retry with after a 401, or `null`. A renewal that
 * cannot run leaves the caller with the 401 it already had.
 */
async function renewedAccessToken(rejected: string): Promise<string | null> {
  try {
    const { accessTokenAfterRejection } = await import('./session-recovery');
    const renewal = await accessTokenAfterRejection(rejected);
    return renewal.status === 'renewed' ? renewal.accessToken : null;
  } catch (err) {
    // Next.js signals (dynamic rendering, redirects) are not failures.
    unstable_rethrow(err);
    return null;
  }
}

/**
 * Server-side API helper for Next.js Server Components / Actions.
 * Returns `null` for 404 (so callers can render notFound()), throws
 * for everything else.
 *
 * Auth: when the session of a signed-in caller is supplied, attaches
 * their Cognito Bearer header — lets the API surface RESTRICTED rows.
 * Anonymous calls (no session) only see PUBLIC rows. A 401 on a
 * signed-in call is retried once with a renewed token before it is
 * thrown.
 */
export async function apiFetch<T>(
  path: string,
  options: { session?: Session | null; revalidate?: number | false } = {},
): Promise<T | null> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL not set in web container env');
  }
  const send = (accessToken: string | null): Promise<Response> =>
    fetch(`${base}${path}`, {
      headers: {
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      next:
        options.revalidate === undefined ? { revalidate: 30 } : { revalidate: options.revalidate },
    });
  const accessToken = options.session?.user ? await callerAccessToken() : null;
  let res = await send(accessToken);
  if (res.status === 401 && accessToken !== null) {
    // The API refused a token the session still held (#643): renew it
    // once and ask again.
    const renewed = await renewedAccessToken(accessToken);
    if (renewed !== null) res = await send(renewed);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(
      res.status,
      `API ${res.status} ${res.statusText} on ${path}: ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

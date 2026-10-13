import type { Session } from 'next-auth';

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
 * Server-side API helper for Next.js Server Components / Actions.
 * Returns `null` for 404 (so callers can render notFound()), throws
 * for everything else.
 *
 * Auth: when a session is supplied AND has an access token, attaches
 * the Cognito Bearer header — lets the API surface RESTRICTED rows.
 * Anonymous calls (no session) only see PUBLIC rows.
 */
export async function apiFetch<T>(
  path: string,
  options: { session?: Session | null; revalidate?: number | false } = {},
): Promise<T | null> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL not set in web container env');
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.session?.accessToken) {
    headers.Authorization = `Bearer ${options.session.accessToken}`;
  }
  const res = await fetch(`${base}${path}`, {
    headers,
    next:
      options.revalidate === undefined ? { revalidate: 30 } : { revalidate: options.revalidate },
  });
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

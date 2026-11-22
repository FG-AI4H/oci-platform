import { safeCallbackUrl } from './safe-callback-url';

/**
 * What `proxy.ts` does for a browser whose session ended between two
 * requests (#643): idle past the limit, or a refresh token the pool no
 * longer accepts.
 *
 * The request arrived with a session cookie and the session callback
 * answered that there is no session any more. For a page the browser
 * is loading, the answer is the sign-in page, saying why, with the way
 * back to that page.
 *
 * Only a full page load is redirected. The request that discovers the
 * ended session is often something else: the activity report, a form
 * submission, a script's `fetch`, or the router fetching a page, which
 * may be a prefetch for a click the user has not made (Next.js hides
 * its router headers from the proxy, so the two cannot be told apart).
 * Those are let through and answered as for anyone who is not signed
 * in; a server action sends the user to sign in on its own terms (see
 * `sessionForAction`) and a page's own guard does the same. By then the
 * session cookie is gone, so a marker cookie remembers, for a few
 * minutes, that a session ended here, and the next full page load is
 * still recognised.
 */

/** Marker cookie: `HttpOnly`, short-lived, carries no information but its presence. */
export const ENDED_SESSION_COOKIE = 'oci-session-ended';
export const ENDED_SESSION_COOKIE_SECONDS = 10 * 60;

export interface EndedSessionDecision {
  /** Same-origin path to redirect to, or `null` to let the request through. */
  redirectTo: string | null;
  marker: 'set' | 'clear' | 'keep';
}

export interface IncomingRequest {
  method: string;
  pathname: string;
  search: string;
  cookieNames: readonly string[];
  /** The browser is loading a document (`Sec-Fetch-Dest: document`). */
  isPageLoad: boolean;
  hasSession: boolean;
}

export function decideForEndedSession(request: IncomingRequest): EndedSessionDecision {
  const marked = request.cookieNames.includes(ENDED_SESSION_COOKIE);
  const ended = !request.hasSession && (marked || request.cookieNames.some(isSessionCookie));
  // Signed in (again), or never was: nothing to do but drop a stale marker.
  if (!ended) return { redirectTo: null, marker: marked ? 'clear' : 'keep' };
  // Already where they need to be; redirecting here would loop.
  if (request.pathname === '/signin') return { redirectTo: null, marker: 'clear' };

  const pageLoad =
    request.method === 'GET' && request.isPageLoad && !request.pathname.startsWith('/api/');
  if (!pageLoad) return { redirectTo: null, marker: 'set' };

  const returnTo = safeCallbackUrl(`${request.pathname}${request.search}`);
  return {
    redirectTo: `/signin?reason=expired&callbackUrl=${encodeURIComponent(returnTo)}`,
    marker: 'clear',
  };
}

/** The session cookie, with or without the `__Secure-` prefix, whole or in chunks. */
function isSessionCookie(name: string): boolean {
  const bare = name.startsWith('__Secure-') ? name.slice('__Secure-'.length) : name;
  if (bare === 'authjs.session-token') return true;
  const chunk = bare.startsWith('authjs.session-token.')
    ? bare.slice('authjs.session-token.'.length)
    : '';
  return /^\d+$/.test(chunk);
}

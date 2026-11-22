import type { Session } from 'next-auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, sessionAccessToken, signOut } from '../auth';
import { safeCallbackUrl } from './safe-callback-url';
import { markAccessTokenRejected } from './token-refresh';

/**
 * What to do when a signed-in caller can no longer call the API (#643).
 *
 * The session callback already renews the access token before it
 * expires, so a 401 from the API is the unusual case: a token revoked
 * at the pool, a clock that disagrees, a session that could not be
 * renewed in time. The answer is the same each time: renew once, and if
 * that does not produce a different token the session is over.
 */

export type RenewalAfterRejection =
  /** A different token to send the request again with. */
  | { status: 'renewed'; accessToken: string }
  /** The session is over: the pool no longer accepts its refresh token. */
  | { status: 'ended' }
  /**
   * The session stands but no new token could be had just now (the pool
   * did not answer, or there is nothing to renew with). Not a reason to
   * sign anyone out.
   */
  | { status: 'unchanged' };

/**
 * What became of the session after the API refused `rejected`.
 *
 * Works in a server component as well as in a server action: it reads
 * the session again and writes no cookie. The proxy stores the renewed
 * tokens on the next request.
 */
export async function accessTokenAfterRejection(rejected: string): Promise<RenewalAfterRejection> {
  markAccessTokenRejected(rejected);
  const current = await sessionAccessToken();
  if (current === null) return { status: 'ended' };
  if (current === rejected) return { status: 'unchanged' };
  return { status: 'renewed', accessToken: current };
}

/**
 * The caller's session inside a server action. A form is only shown to
 * someone signed in, so an action that finds no session is being
 * submitted after the session ended: the user is sent to sign in, with
 * the way back to `returnTo` (default: the page the form is on), and
 * the call does not return.
 */
export async function sessionForAction(returnTo?: string): Promise<Session> {
  const session = await auth();
  if (session?.user) return session;
  redirect(expiredSignInUrl(returnTo ?? (await currentPagePath())));
}

/** `/signin?reason=expired&callbackUrl=…`; kept in step with `reauthUrl` in `api.ts`. */
function expiredSignInUrl(returnTo: string): string {
  return `/signin?reason=expired&callbackUrl=${encodeURIComponent(safeCallbackUrl(returnTo))}`;
}

/**
 * The page the current request came from, as a same-origin path. A
 * server action is posted from the page that holds its form, so the
 * `Referer` is where the user should land after signing in again.
 */
export async function currentPagePath(): Promise<string> {
  const referer = (await headers()).get('referer');
  if (!referer) return safeCallbackUrl(undefined);
  try {
    const url = new URL(referer);
    return safeCallbackUrl(`${url.pathname}${url.search}`);
  } catch {
    return safeCallbackUrl(undefined);
  }
}

/**
 * End a session that can no longer call the API and send the user to
 * sign in, with the way back to `returnTo` (default: the page the
 * request came from). Never returns.
 *
 * `rendering: true` when the caller is a page being rendered rather
 * than a server action or route handler. Cookies are read-only there,
 * so the session cannot be cleared, and signing out would revoke the
 * refresh token of a session the browser still holds. The user is sent
 * to the sign-in page, which shows its "session expired" state over the
 * old session, as it did before sessions were renewed.
 */
export async function endExpiredSession(
  returnTo?: string,
  options: { rendering?: boolean } = {},
): Promise<never> {
  const target = expiredSignInUrl(returnTo ?? (await currentPagePath()));
  if (!options.rendering) await signOut({ redirect: false });
  redirect(target);
}

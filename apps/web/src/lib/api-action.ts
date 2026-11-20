import { sessionAccessToken } from '../auth';
import { accessTokenAfterRejection, endExpiredSession } from './session-recovery';

/**
 * `fetch` against the OCI API as the signed-in caller, for server
 * actions and route handlers (#643).
 *
 * Reads the caller's access token from the encrypted session and adds
 * the bearer header; the caller never handles the token. When the API
 * answers 401 it renews the token once and sends the request again:
 *
 *   - the API accepts the renewed token: that answer is returned;
 *   - the session is over, or the API refuses the renewed token too:
 *     the user is signed out and sent to `/signin?reason=expired` with
 *     the way back to the page they were on. The call does not return;
 *   - no new token could be had just now (the pool did not answer):
 *     the 401 is returned. The session stands and the user can try
 *     again; an outage at the pool does not sign anyone out.
 *
 * Any other status, 403 included, is returned for the caller to handle
 * as it does today. Without a session the request goes out without a
 * bearer header and the API's answer is returned.
 *
 * The request may be sent twice, so `init.body` has to be something
 * that can be: a string, `FormData`, a `Blob`. Not a stream.
 *
 * `options.rendering`: set it when calling from a page that is being
 * rendered, where the session cookie cannot be cleared.
 */
export async function fetchAsUser(
  input: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
  options: { returnTo?: string; rendering?: boolean } = {},
): Promise<Response> {
  const send = (accessToken: string | null): Promise<Response> =>
    fetch(input, {
      ...init,
      headers: {
        ...init.headers,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });

  const accessToken = await sessionAccessToken();
  const first = await send(accessToken);
  if (first.status !== 401 || accessToken === null) return first;

  const renewal = await accessTokenAfterRejection(accessToken);
  if (renewal.status === 'unchanged') return first;
  if (renewal.status === 'renewed') {
    const second = await send(renewal.accessToken);
    if (second.status !== 401) return second;
  }
  return endExpiredSession(options.returnTo, { rendering: options.rendering });
}

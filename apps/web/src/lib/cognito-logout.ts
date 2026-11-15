/**
 * Cognito hosted-UI logout (#663).
 *
 * NextAuth's `signOut` clears the app's session cookie only. The hosted
 * UI keeps its own session cookie on the Cognito domain, so the next
 * "Sign in" returns an authorization code for the same user without
 * showing the form, and nobody can switch account. Ending that session
 * means sending the browser to the pool's `/logout` endpoint, which
 * Cognito publishes as `end_session_endpoint` in the issuer's OpenID
 * discovery document. Reading it from there keeps the web task's
 * environment as it is: no hosted-domain variable to add in CDK.
 *
 * `logout_uri` must match one of the client's registered logout URLs
 * exactly; `identity-stack.ts` registers `https://<domain>/`.
 */

const DISCOVERY_TIMEOUT_MS = 3_000;

type Discovery = { end_session_endpoint?: unknown };

let endSessionEndpoint: Promise<string | null> | undefined;

async function discoverEndSessionEndpoint(
  issuer: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const doc = (await res.json()) as Discovery;
    const endpoint = doc.end_session_endpoint;
    return typeof endpoint === 'string' && endpoint.startsWith('https://') ? endpoint : null;
  } catch {
    return null;
  }
}

/**
 * The URL that ends the hosted-UI session and returns the browser to
 * `returnTo`, or `null` when it cannot be built: no issuer or client id
 * configured (local dev), or the discovery document unreachable. The
 * caller then falls back to the plain app sign-out.
 *
 * The discovery lookup is cached for the process; a failed lookup is
 * retried on the next call rather than cached.
 */
export async function cognitoLogoutUrl(
  args: { issuer: string | undefined; clientId: string | undefined; returnTo: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!args.issuer || !args.clientId) return null;

  endSessionEndpoint ??= discoverEndSessionEndpoint(args.issuer, fetchImpl);
  const endpoint = await endSessionEndpoint;
  if (endpoint === null) {
    endSessionEndpoint = undefined;
    return null;
  }

  const url = new URL(endpoint);
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('logout_uri', args.returnTo);
  return url.toString();
}

/** Test seam: forget the cached discovery result. */
export function resetCognitoLogoutCache(): void {
  endSessionEndpoint = undefined;
}

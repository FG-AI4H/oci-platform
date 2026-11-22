import NextAuth from 'next-auth';
import type { NextAuthConfig, Session } from 'next-auth';
import Cognito from 'next-auth/providers/cognito';
import Credentials from 'next-auth/providers/credentials';
// The type import also merges the module-augmentation declarations
// below into next-auth's exported types.
import type { JWT } from 'next-auth/jwt';
import { groupsFromAccessToken, subjectFromAccessToken } from './lib/token-claims';
import {
  refreshConfigFromEnv,
  refreshMarginSeconds,
  refreshTokens,
  requestTokenRefresh,
  revokeRefreshToken,
  sessionIdleSeconds,
  sessionTokensAfterRefresh,
} from './lib/token-refresh';

declare module 'next-auth' {
  interface Session {
    /** The caller's Cognito groups, read from their access token. */
    groups?: string[];
    /** The access token's `sub` (or the local-dev user). */
    subject?: string;
    // No token here, on purpose: a browser can fetch this object from
    // `/api/auth/session`. Server code gets the bearer token from
    // `sessionAccessToken()`.
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    /** Never leaves the encrypted session cookie, except as a bearer header to the API. */
    accessToken?: string;
    /** Never leaves the encrypted session cookie. */
    refreshToken?: string;
    /** Access-token expiry, seconds since the epoch. */
    expiresAt?: number;
    /** Last request from the user's browser, seconds since the epoch. */
    lastActivityAt?: number;
  }
}

export const isLocal =
  process.env.OCI_ENV === 'local' || process.env.NEXT_PUBLIC_OCI_ENV === 'local';

/**
 * NextAuth.js v5 configuration — `handlers`, `signIn`, `signOut`, `auth`
 * for route handlers, server actions, server components and `proxy.ts`.
 *
 * Two provider modes, picked at boot from `OCI_ENV`:
 *
 *   - default → Cognito Hosted UI (confidential client; OIDC code flow
 *     exchanged server-side via the `clientSecret`).
 *   - `OCI_ENV=local` → a `Credentials` provider with `id: 'cognito'`
 *     so that existing `signIn('cognito')` call sites remain unchanged.
 *     The form takes a username + comma-separated role list and stamps
 *     a fake session whose `accessToken` is a sentinel string that the
 *     API's DevAuthGuard ignores. Unreachable in deployed envs because
 *     CDK never sets `OCI_ENV=local`.
 *
 * Required env in non-local (set in apps/web Fargate task by web-stack):
 *   AUTH_SECRET           — NextAuth session-encryption secret (Secrets Manager)
 *   AUTH_COGNITO_ID       — Cognito user pool client id
 *   AUTH_COGNITO_SECRET   — Cognito user pool client secret (Secrets Manager)
 *   AUTH_COGNITO_ISSUER   — https://cognito-idp.<region>.amazonaws.com/<userPoolId>
 *   AUTH_URL              — Public origin, e.g. https://dev.oci.ai4h.net
 *
 * Where the tokens live (#643, ADR-0027). The access token and the
 * refresh token are kept in the session cookie, which is encrypted with
 * `AUTH_SECRET` and `HttpOnly`: the browser stores it and cannot read
 * it. The `jwt` callback renews the access token shortly before it
 * expires; `proxy.ts` runs it on every request so the renewed cookie is
 * written back. The id token is not kept: nothing reads it.
 *
 * How long a session lasts. As long as the user keeps using the app.
 * It ends when nothing has come from their browser for the
 * environment's idle limit (`OCI_SESSION_IDLE_SECONDS`), and in any
 * case when the pool's refresh token expires, a fixed time after
 * sign-in that activity does not extend.
 */
function providers(): NextAuthConfig['providers'] {
  return [
    isLocal
      ? Credentials({
          id: 'cognito',
          name: 'Local Dev',
          credentials: {
            user: { label: 'User', type: 'text', placeholder: 'local-dev@oci.ai4h.net' },
            roles: {
              label: 'Roles (comma-sep, lowercase)',
              type: 'text',
              placeholder: 'annotator,host,admin',
            },
          },
          authorize: (raw) => {
            const userValue =
              typeof raw?.user === 'string' && raw.user.length > 0
                ? raw.user
                : 'local-dev@oci.ai4h.net';
            // Cognito group names on this platform are all-lowercase
            // (see PlatformGroupSchema in @oci/shared-types). The
            // local sign-in form accepts any case so we don't punish
            // typos like 'Annotator' — every role gating check uses
            // `groups.includes('annotator')` exactly, so we lowercase
            // here once and forget about it.
            const rolesRaw =
              typeof raw?.roles === 'string' && raw.roles.length > 0 ? raw.roles : 'host,admin';
            const rolesValue = rolesRaw
              .split(',')
              .map((r) => r.trim().toLowerCase())
              .filter(Boolean)
              .join(',');
            return {
              id: userValue,
              name: userValue,
              email: userValue.includes('@') ? userValue : `${userValue}@local`,
              // Sentinel — the API's DevAuthGuard ignores tokens; the
              // bearer header is forwarded only so apiFetch keeps its
              // existing branch ("session has accessToken → forward").
              accessToken: `dev:${userValue}:${rolesValue}`,
            };
          },
        })
      : Cognito({
          clientId: process.env.AUTH_COGNITO_ID,
          clientSecret: process.env.AUTH_COGNITO_SECRET,
          issuer: process.env.AUTH_COGNITO_ISSUER,
          authorization: { params: { scope: 'openid email profile' } },
        }),
  ];
}

type Callbacks = NonNullable<NextAuthConfig['callbacks']>;

/**
 * Runs at sign-in and then on every read of the session. After sign-in
 * it ends a session that has been idle past the limit, records the
 * activity otherwise, and renews the access token when it is close to
 * expiry or the API has refused it. Returning `null` ends the session.
 */
const jwt: Callbacks['jwt'] = async ({ token, account, user }) => {
  if (account) {
    token.accessToken = account.access_token;
    token.refreshToken = account.refresh_token;
    token.expiresAt = account.expires_at;
  }
  if (isLocal && user && 'accessToken' in user && typeof user.accessToken === 'string') {
    token.accessToken = user.accessToken;
  }
  const idleSeconds = sessionIdleSeconds();
  if (account) {
    if (idleSeconds !== null) token.lastActivityAt = Math.floor(Date.now() / 1000);
    return token;
  }

  const pool = refreshConfigFromEnv();
  const marginSeconds = refreshMarginSeconds();
  return sessionTokensAfterRefresh<JWT>(token, {
    nowMs: Date.now,
    marginSeconds,
    idleSeconds,
    refresh:
      pool === null
        ? null
        : (refreshToken) =>
            refreshTokens(refreshToken, (current) => requestTokenRefresh(pool, current), {
              marginSeconds,
            }),
    ...(pool === null
      ? {}
      : { revoke: (refreshToken: string) => revokeRefreshToken(pool, refreshToken) }),
  });
};

/**
 * On sign-out, revoke the refresh token at the pool. Clearing the cookie
 * ends the session in this browser; revoking ends it for any copy of
 * the cookie, once the access token it holds has run out.
 */
const events: NextAuthConfig['events'] = {
  async signOut(message) {
    const pool = refreshConfigFromEnv();
    const refreshToken = 'token' in message ? message.token?.refreshToken : undefined;
    if (pool !== null && refreshToken) await revokeRefreshToken(pool, refreshToken);
  },
};

/**
 * What the session says about the caller, and all it says: who they
 * are and which groups they are in. Both are read from the access token
 * each time, so they change when the token is renewed. The tokens are
 * not copied: this object is what `GET /api/auth/session` returns to
 * the browser and what pages may hand to client components.
 *
 * The subject (Cognito `sub`, or the local-dev user) is what the API
 * derives `hostId` from. Without it on the session, "is this viewer
 * the host?" and "my datasets" cannot be answered on the web side.
 */
function describeCaller<S extends Session>(session: S, token: JWT): S {
  if (session.user && typeof token.sub === 'string') session.user.id = token.sub;
  session.groups = groupsFromAccessToken(token.accessToken);
  session.subject = subjectFromAccessToken(token.accessToken) ?? undefined;
  return session;
}

function config(session: Callbacks['session']): NextAuthConfig {
  return {
    providers: providers(),
    callbacks: { jwt, session },
    events,
    // Route NextAuth UI to our own branded page (apps/web/src/app/signin).
    // The default NextAuth-generated form is unstyled (#79) and breaks
    // the dark-mode flow. `signOut` keeps NextAuth's default — we handle
    // it via a server action in site-header anyway.
    pages: {
      signIn: '/signin',
    },
    // Trust the X-Forwarded-* headers from the ALB (we sit behind one).
    trustHost: true,
  };
}

/**
 * The session everything uses: pages, actions, route handlers, the
 * proxy, and the `/api/auth/*` routes a browser can call. It never
 * carries a token.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(
  config(({ session, token }) => describeCaller(session, token)),
);

type TokenBearingSession = Session & { accessToken?: string };

/**
 * A second reading of the same cookie whose only purpose is to hand the
 * access token to `sessionAccessToken` below. Its routes are not
 * mounted and nothing else is exported from it, so the object that
 * carries the token never leaves this module.
 */
const tokenReader = NextAuth(
  config(({ session, token }) => {
    const bearing: TokenBearingSession = session;
    bearing.accessToken = token.accessToken;
    return bearing;
  }),
);

/**
 * The signed-in caller's API bearer token, or `null` when nobody is
 * signed in. Server-side only: it is read from the encrypted session
 * cookie, renewed first if it is due, and must go no further than an
 * `Authorization` header on a request to the API.
 *
 * Most code does not need it: `apiFetch` (reads) and `fetchAsUser`
 * (server actions) attach it themselves. To ask "is someone signed
 * in?", use `auth()` and test `session?.user`.
 */
export async function sessionAccessToken(): Promise<string | null> {
  const session: TokenBearingSession | null = await tokenReader.auth();
  return session?.accessToken ?? null;
}

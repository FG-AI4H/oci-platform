import NextAuth from 'next-auth';
import Cognito from 'next-auth/providers/cognito';
import Credentials from 'next-auth/providers/credentials';
// Side-effect import so the module-augmentation declarations below
// merge into next-auth's exported types.
import type {} from 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    idToken?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    idToken?: string;
    expiresAt?: number;
  }
}

const isLocal = process.env.OCI_ENV === 'local' || process.env.NEXT_PUBLIC_OCI_ENV === 'local';

/**
 * NextAuth.js v5 server-side singleton — exports `handlers`, `signIn`,
 * `signOut`, `auth` for use in route handlers, server actions, and
 * `middleware.ts`.
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
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    isLocal
      ? Credentials({
          id: 'cognito',
          name: 'Local Dev',
          credentials: {
            user: { label: 'User', type: 'text', placeholder: 'local-dev@oci.ai4h.net' },
            roles: { label: 'Roles (comma-sep)', type: 'text', placeholder: 'host,admin' },
          },
          authorize: (raw) => {
            const userValue =
              typeof raw?.user === 'string' && raw.user.length > 0
                ? raw.user
                : 'local-dev@oci.ai4h.net';
            const rolesValue =
              typeof raw?.roles === 'string' && raw.roles.length > 0 ? raw.roles : 'host,admin';
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
  ],
  callbacks: {
    // Forward Cognito access + id tokens (or the local-dev sentinel) to
    // the session so client-side code can call the OCI API with
    // `Authorization: Bearer <accessToken>`.
    jwt({ token, account, user }) {
      if (account) {
        token.accessToken = account.access_token;
        token.idToken = account.id_token;
        token.expiresAt = account.expires_at;
      }
      if (isLocal && user && 'accessToken' in user && typeof user.accessToken === 'string') {
        token.accessToken = user.accessToken;
      }
      return token;
    },
    session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      session.idToken = token.idToken as string | undefined;
      return session;
    },
  },
  // Route NextAuth UI to our own branded page (apps/web/src/app/signin).
  // The default NextAuth-generated form is unstyled (#79) and breaks
  // the dark-mode flow. `signOut` keeps NextAuth's default — we handle
  // it via a server action in site-header anyway.
  pages: {
    signIn: '/signin',
  },
  // Trust the X-Forwarded-* headers from the ALB (we sit behind one).
  trustHost: true,
});

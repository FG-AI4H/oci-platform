import NextAuth from 'next-auth';
import Cognito from 'next-auth/providers/cognito';
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

/**
 * NextAuth.js v5 server-side singleton — exports `handlers`, `signIn`,
 * `signOut`, `auth` for use in route handlers, server actions, and
 * `middleware.ts`.
 *
 * Uses Cognito as the only provider. Confidential client (Cognito user
 * pool client with `generateSecret: true`); the OIDC code flow is
 * exchanged server-side via the `clientSecret`.
 *
 * Required env (set in apps/web Fargate task by web-stack):
 *   AUTH_SECRET           — NextAuth session-encryption secret (Secrets Manager)
 *   AUTH_COGNITO_ID       — Cognito user pool client id
 *   AUTH_COGNITO_SECRET   — Cognito user pool client secret (Secrets Manager)
 *   AUTH_COGNITO_ISSUER   — https://cognito-idp.<region>.amazonaws.com/<userPoolId>
 *   AUTH_URL              — Public origin, e.g. https://dev.oci.ai4h.net
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Cognito({
      clientId: process.env.AUTH_COGNITO_ID,
      clientSecret: process.env.AUTH_COGNITO_SECRET,
      issuer: process.env.AUTH_COGNITO_ISSUER,
      authorization: { params: { scope: 'openid email profile' } },
    }),
  ],
  callbacks: {
    // Forward Cognito access + id tokens to the session so client-side
    // code can call the OCI API with `Authorization: Bearer <accessToken>`.
    jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.idToken = account.id_token;
        token.expiresAt = account.expires_at;
      }
      return token;
    },
    session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      session.idToken = token.idToken as string | undefined;
      return session;
    },
  },
  // Trust the X-Forwarded-* headers from the ALB (we sit behind one).
  trustHost: true,
});

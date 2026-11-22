/**
 * Settings shared by `playwright.session.config.ts`, which starts the
 * web app, and `session-refresh.spec.ts`, which starts the stand-in
 * pool the app is pointed at (#643).
 *
 * The client id and client secret below are made up for this test and
 * are accepted by nothing but the stand-in pool on loopback. The
 * session-encryption key is not here: the config makes a new one for
 * each run.
 */
const APP_PORT = 3643;
const POOL_PORT = 4643;

export const SESSION_E2E = {
  appPort: APP_PORT,
  appOrigin: `http://localhost:${APP_PORT}`,
  poolPort: POOL_PORT,
  poolIssuer: `http://127.0.0.1:${POOL_PORT}`,
  clientId: 'e2e-web-client',
  clientSecret: 'not-a-secret',
  /** Each access token lives this long… */
  accessTokenSeconds: 10,
  /** …and is renewed once it has this long left, or less. */
  refreshMarginSeconds: 4,
  /**
   * The session ends after this long without activity. Longer than two
   * access-token lifetimes, so a test can let a token expire, and expire
   * again, without the session being idle.
   */
  idleSeconds: 25,
} as const;

/**
 * Environment of the web app under test: deployed mode, stand-in pool
 * and API. `AUTH_SECRET` is added by whoever starts the app.
 */
export const SESSION_E2E_APP_ENV: Record<string, string> = {
  // Anything but `local`: the Cognito provider, not the local-dev form.
  OCI_ENV: 'e2e',
  NEXT_PUBLIC_OCI_ENV: 'e2e',
  AUTH_URL: SESSION_E2E.appOrigin,
  AUTH_COGNITO_ID: SESSION_E2E.clientId,
  AUTH_COGNITO_SECRET: SESSION_E2E.clientSecret,
  AUTH_COGNITO_ISSUER: SESSION_E2E.poolIssuer,
  NEXT_PUBLIC_API_BASE_URL: `${SESSION_E2E.poolIssuer}/api`,
  NEXT_PUBLIC_SITE_URL: SESSION_E2E.appOrigin,
  OCI_SESSION_REFRESH_MARGIN_SECONDS: String(SESSION_E2E.refreshMarginSeconds),
  OCI_SESSION_IDLE_SECONDS: String(SESSION_E2E.idleSeconds),
};

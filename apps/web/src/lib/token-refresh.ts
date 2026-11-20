import { createHash } from 'node:crypto';

/**
 * How long a web session lives (#643, ADR-0027).
 *
 * The session holds a Cognito access token (60 minutes) and a refresh
 * token. This module exchanges the refresh token for a new access token
 * at the pool's token endpoint, makes that exchange safe when many
 * requests ask for it at once, applies the idle limit, and revokes the
 * refresh token of a session that has ended.
 *
 * Why the bookkeeping. One page view runs the session callback several
 * times (the proxy, then each `auth()` call while rendering), and a
 * browser sends several requests in parallel. All of them carry the
 * same session cookie, so near expiry all of them want a refresh:
 *
 *   - `refreshTokens` runs one exchange per refresh token and hands its
 *     outcome to every caller that presents the same refresh token for
 *     the next minute. A request that arrives with the old cookie after
 *     the exchange completed gets the tokens the first one obtained
 *     instead of spending the refresh token a second time. This is what
 *     keeps a pool that rotates refresh tokens from signing a user out.
 *   - The books live on `globalThis`: the proxy and the app are bundled
 *     separately, and a module-level map would exist once in each.
 *
 * The books are per process. Two web tasks can still each refresh the
 * same token once; that is harmless while the pool does not rotate
 * refresh tokens, and bounded by the pool's grace period if it ever
 * does (see the ADR).
 *
 * Nothing here logs or returns a token to anything but the session
 * callback.
 */

/** Tokens kept in the encrypted session. */
export interface SessionTokens {
  accessToken?: string;
  refreshToken?: string;
  /** Access-token expiry, in seconds since the epoch. */
  expiresAt?: number;
  /** When the user last did something, in seconds since the epoch. */
  lastActivityAt?: number;
}

export type RefreshOutcome =
  | {
      status: 'refreshed';
      accessToken: string;
      /** Present only when the pool rotated the refresh token. */
      refreshToken?: string;
      expiresAt: number;
    }
  /** The pool refused the refresh token: the session is over. */
  | { status: 'rejected' }
  /** No answer worth trusting (network, 5xx, misconfiguration): try again later. */
  | { status: 'unavailable' };

export interface RefreshConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

/** Refresh when the access token has this long left, or less. */
export const DEFAULT_REFRESH_MARGIN_SECONDS = 300;

const OUTCOME_TTL_MS = 60_000;
const UNAVAILABLE_TTL_MS = 5_000;
const REJECTED_MARK_TTL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 5_000;

interface RefreshEntry {
  outcome: Promise<RefreshOutcome>;
  /** `Infinity` while the exchange is in flight. */
  forgetAtMs: number;
}

interface Books {
  refreshes: Map<string, RefreshEntry>;
  /** Access tokens the API refused although they had not expired. */
  rejected: Map<string, number>;
  /** Sessions that passed the idle check a moment ago; see `passesIdleCheck`. */
  seenActive: Map<string, number>;
  tokenEndpoints: Map<string, Promise<string | null>>;
}

declare global {
  var __ociTokenRefreshBooks: Books | undefined;
}

function books(): Books {
  globalThis.__ociTokenRefreshBooks ??= {
    refreshes: new Map(),
    rejected: new Map(),
    seenActive: new Map(),
    tokenEndpoints: new Map(),
  };
  return globalThis.__ociTokenRefreshBooks;
}

/** Test seam: forget every exchange, mark and discovery result. */
export function resetTokenRefreshState(): void {
  const b = books();
  b.refreshes.clear();
  b.rejected.clear();
  b.seenActive.clear();
  b.tokenEndpoints.clear();
}

function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sweep(b: Books, nowMs: number): void {
  for (const [key, entry] of b.refreshes) {
    if (entry.forgetAtMs <= nowMs) b.refreshes.delete(key);
  }
  for (const [key, forgetAtMs] of b.rejected) {
    if (forgetAtMs <= nowMs) b.rejected.delete(key);
  }
  for (const [key, forgetAtMs] of b.seenActive) {
    if (forgetAtMs <= nowMs) b.seenActive.delete(key);
  }
}

/**
 * The refresh margin, in seconds. `OCI_SESSION_REFRESH_MARGIN_SECONDS`
 * overrides the default so a test can run with a token that lives a few
 * seconds; anything that is not a whole number of seconds from 0 to
 * 3000 is ignored.
 */
export function refreshMarginSeconds(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.OCI_SESSION_REFRESH_MARGIN_SECONDS;
  if (raw === undefined || !/^\d{1,4}$/.test(raw)) return DEFAULT_REFRESH_MARGIN_SECONDS;
  const value = Number(raw);
  return value <= 3000 ? value : DEFAULT_REFRESH_MARGIN_SECONDS;
}

/** The idle limit applied when a deployed environment does not state one. */
export const DEFAULT_IDLE_SECONDS = 30 * 60;

const MAX_IDLE_SECONDS = 24 * 60 * 60;

/**
 * How long a session may go without activity before it ends, in
 * seconds, or `null` for no limit.
 *
 * `OCI_SESSION_IDLE_SECONDS` is set per environment by the CDK web
 * stack. A deployed environment that does not state a usable value
 * gets the strictest default, not an unlimited session. Local dev,
 * which has no real identity behind it, has no limit unless it sets
 * one.
 */
export function sessionIdleSeconds(
  env: Record<string, string | undefined> = process.env,
): number | null {
  const raw = env.OCI_SESSION_IDLE_SECONDS;
  if (raw !== undefined && /^\d{1,5}$/.test(raw)) {
    const value = Number(raw);
    if (value >= 1 && value <= MAX_IDLE_SECONDS) return value;
  }
  const local = env.OCI_ENV === 'local' || env.NEXT_PUBLIC_OCI_ENV === 'local';
  return local ? null : DEFAULT_IDLE_SECONDS;
}

/**
 * How often an open page may report that someone is using it: a
 * quarter of the idle limit, between five seconds and five minutes.
 */
export function activityReportSeconds(idleSeconds: number): number {
  return Math.max(5, Math.min(300, Math.floor(idleSeconds / 4)));
}

/** The pool's refresh settings from the web task's environment, or `null` (local dev). */
export function refreshConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): RefreshConfig | null {
  const issuer = env.AUTH_COGNITO_ISSUER;
  const clientId = env.AUTH_COGNITO_ID;
  const clientSecret = env.AUTH_COGNITO_SECRET;
  if (!issuer || !clientId || !clientSecret) return null;
  return { issuer, clientId, clientSecret };
}

/**
 * Record that the API answered 401 to this access token. The next pass
 * through the session callback refreshes it whatever its expiry says.
 */
export function markAccessTokenRejected(accessToken: string, nowMs: number = Date.now()): void {
  const b = books();
  sweep(b, nowMs);
  b.rejected.set(fingerprint(accessToken), nowMs + REJECTED_MARK_TTL_MS);
}

export function wasAccessTokenRejected(accessToken: string, nowMs: number = Date.now()): boolean {
  const forgetAtMs = books().rejected.get(fingerprint(accessToken));
  return forgetAtMs !== undefined && forgetAtMs > nowMs;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * The refresh request carries the client secret and the refresh token,
 * so it only ever goes out over TLS. Plain HTTP is accepted for a
 * loopback address, which is how the end-to-end test points the app at
 * a stand-in pool.
 */
function usableTokenEndpoint(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return url.toString();
  if (url.protocol === 'http:' && isLoopback(url.hostname)) return url.toString();
  return null;
}

async function discoverTokenEndpoint(
  issuer: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const doc = (await res.json()) as { token_endpoint?: unknown };
    return usableTokenEndpoint(doc.token_endpoint);
  } catch {
    return null;
  }
}

/** Cached for the process; a failed lookup is retried on the next call. */
async function tokenEndpoint(issuer: string, fetchImpl: typeof fetch): Promise<string | null> {
  const b = books();
  let lookup = b.tokenEndpoints.get(issuer);
  if (!lookup) {
    lookup = discoverTokenEndpoint(issuer, fetchImpl);
    b.tokenEndpoints.set(issuer, lookup);
  }
  const endpoint = await lookup;
  if (endpoint === null && b.tokenEndpoints.get(issuer) === lookup) {
    b.tokenEndpoints.delete(issuer);
  }
  return endpoint;
}

/** `exp` of a JWT, read without verifying it; only a fallback for a missing `expires_in`. */
function expiryClaim(jwt: string): number | null {
  const payload = jwt.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof claims.exp === 'number' && Number.isFinite(claims.exp) ? claims.exp : null;
  } catch {
    return null;
  }
}

function warn(
  reason: string,
  detail: Record<string, string | number> = {},
  msg = 'session token refresh failed',
): void {
  // Reason and status only. Never a token, a secret or a response body.
  console.warn(JSON.stringify({ msg, reason, ...detail }));
}

function basicAuth(config: RefreshConfig): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
}

const REVOKE_TIMEOUT_MS = 3_000;

/**
 * Revoke a refresh token at the pool, so that it can renew nothing any
 * more: on sign-out, and when a session is ended for inactivity. A copy
 * of the session cookie taken earlier then dies with its access token,
 * within the hour, instead of living to the refresh token's own expiry.
 *
 * Cognito's revocation endpoint is `/oauth2/revoke`, beside the token
 * endpoint; it answers 200 with an empty body, also for a token that
 * was already revoked. Returns whether the pool accepted the request.
 * Never throws: ending the session must not depend on it.
 */
export async function revokeRefreshToken(
  config: RefreshConfig,
  refreshToken: string,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const failed = (reason: string, detail: Record<string, string | number> = {}): false => {
    warn(reason, detail, 'refresh token revocation failed');
    return false;
  };

  const grantEndpoint = await tokenEndpoint(config.issuer, fetchImpl);
  if (!grantEndpoint) return failed('token endpoint not discoverable');
  const endpoint = new URL(grantEndpoint);
  if (!endpoint.pathname.endsWith('/oauth2/token')) return failed('no revocation endpoint known');
  endpoint.pathname = endpoint.pathname.replace(/\/token$/, '/revoke');

  try {
    const res = await fetchImpl(endpoint.toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuth(config),
      },
      body: new URLSearchParams({ token: refreshToken }).toString(),
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      cache: 'no-store',
    });
    return res.ok
      ? true
      : failed('revocation endpoint refused the request', { status: res.status });
  } catch {
    return failed('revocation endpoint unreachable');
  }
}

/**
 * One refresh-token grant against the pool's token endpoint. Never
 * throws: every failure is an outcome.
 */
export async function requestTokenRefresh(
  config: RefreshConfig,
  refreshToken: string,
  deps: { fetchImpl?: typeof fetch; nowMs?: () => number } = {},
): Promise<RefreshOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowMs = deps.nowMs ?? Date.now;

  const endpoint = await tokenEndpoint(config.issuer, fetchImpl);
  if (endpoint === null) {
    warn('token endpoint not discoverable');
    return { status: 'unavailable' };
  }

  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuth(config),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.clientId,
        refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    warn('token endpoint unreachable');
    return { status: 'unavailable' };
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await res.json();
    body = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    body = {};
  }

  if (!res.ok) {
    // `invalid_grant` is the pool saying this refresh token is expired,
    // revoked or already rotated out. Anything else (a wrong client
    // secret, throttling, an outage) says nothing about the user, so it
    // must not end their session.
    if (res.status === 400 && body.error === 'invalid_grant') return { status: 'rejected' };
    warn('token endpoint refused the request', {
      status: res.status,
      ...(typeof body.error === 'string' ? { error: body.error.slice(0, 64) } : {}),
    });
    return { status: 'unavailable' };
  }

  const accessToken = body.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    warn('token endpoint answered without an access token');
    return { status: 'unavailable' };
  }
  const expiresIn = body.expires_in;
  const expiresAt =
    typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
      ? Math.floor(nowMs() / 1000) + Math.floor(expiresIn)
      : expiryClaim(accessToken);
  if (expiresAt === null) {
    warn('token endpoint answered without an expiry');
    return { status: 'unavailable' };
  }
  const rotated = body.refresh_token;
  return {
    status: 'refreshed',
    accessToken,
    ...(typeof rotated === 'string' && rotated.length > 0 ? { refreshToken: rotated } : {}),
    expiresAt,
  };
}

/**
 * Exchange a refresh token, once. Callers presenting the same refresh
 * token while the exchange runs, or within a minute of its end, share
 * its outcome. An outcome is not reused once its own access token needs
 * renewing, or once the API has refused that token: the next caller
 * starts a new exchange.
 */
export async function refreshTokens(
  refreshToken: string,
  exchange: (refreshToken: string) => Promise<RefreshOutcome>,
  clock: { nowMs?: () => number; marginSeconds?: number } = {},
): Promise<RefreshOutcome> {
  const nowMs = clock.nowMs ?? Date.now;
  const marginSeconds = clock.marginSeconds ?? DEFAULT_REFRESH_MARGIN_SECONDS;
  const b = books();
  const key = fingerprint(refreshToken);

  for (let attempt = 0; attempt < 2; attempt++) {
    sweep(b, nowMs());
    const known = b.refreshes.get(key);
    if (!known) break;
    // Joined while it was running: this is the single flight, whatever
    // the outcome turns out to be.
    if (known.forgetAtMs === Number.POSITIVE_INFINITY) return known.outcome;
    const outcome = await known.outcome;
    const stale =
      outcome.status === 'refreshed' &&
      (wasAccessTokenRejected(outcome.accessToken, nowMs()) ||
        isRefreshDue(outcome.expiresAt, nowMs(), marginSeconds));
    if (!stale) return outcome;
    // Drop it unless another caller already replaced it.
    if (b.refreshes.get(key) === known) b.refreshes.delete(key);
  }

  const started = b.refreshes.get(key);
  if (started) return started.outcome;

  const entry: RefreshEntry = {
    forgetAtMs: Number.POSITIVE_INFINITY,
    outcome: exchange(refreshToken)
      .catch((): RefreshOutcome => ({ status: 'unavailable' }))
      .then((outcome) => {
        entry.forgetAtMs =
          nowMs() + (outcome.status === 'unavailable' ? UNAVAILABLE_TTL_MS : OUTCOME_TTL_MS);
        return outcome;
      }),
  };
  b.refreshes.set(key, entry);
  return entry.outcome;
}

/** True when the access token is within `marginSeconds` of its expiry, or past it. */
export function isRefreshDue(
  expiresAt: number | undefined,
  nowMs: number,
  marginSeconds: number,
): boolean {
  if (typeof expiresAt !== 'number') return false;
  return nowMs >= (expiresAt - marginSeconds) * 1000;
}

export interface SessionRefreshDeps {
  nowMs: () => number;
  marginSeconds: number;
  /** `null` when no pool is configured (local dev): nothing can be refreshed. */
  refresh: ((refreshToken: string) => Promise<RefreshOutcome>) | null;
  /** Idle limit in seconds; `null` or absent for none. */
  idleSeconds?: number | null;
  /** Revokes the refresh token of a session ended for inactivity. */
  revoke?: (refreshToken: string) => Promise<unknown>;
}

/**
 * What the session callback does with the stored session on every
 * request after sign-in. Returns the token to keep (possibly with new
 * tokens in it), or `null` to end the session.
 *
 * The idle limit comes first. Every run of this function is a request
 * from the user's browser, so it counts as activity: when the previous
 * one is further back than the limit the session ends, and otherwise
 * the time of this one is recorded. A session is never ended for its
 * age alone; the only fixed end is the refresh token's own expiry,
 * which the pool enforces (see the ADR).
 *
 * Then the tokens:
 *
 *   - Access token good for longer than the margin and not refused by
 *     the API: unchanged.
 *   - Refresh due: exchange the refresh token. New tokens replace the
 *     old; a rotated refresh token replaces the stored one.
 *   - The pool refuses the refresh token: `null`. The user signs in again.
 *   - The pool cannot be reached: unchanged. The access token may still
 *     be valid, and the next request tries again.
 *   - Expired with no refresh token (a session minted before refresh
 *     existed): `null`, rather than a signed-in shell whose every API
 *     call fails.
 */
export async function sessionTokensAfterRefresh<T extends SessionTokens>(
  token: T,
  deps: SessionRefreshDeps,
): Promise<T | null> {
  const idleSeconds = deps.idleSeconds ?? null;
  if (idleSeconds === null) return renewedTokens(token, deps);

  const now = deps.nowMs();
  if (!passesIdleCheck(token, idleSeconds, now)) {
    if (token.refreshToken && deps.revoke) {
      await deps.revoke(token.refreshToken).catch(() => undefined);
    }
    return null;
  }
  const renewed = await renewedTokens(token, deps);
  return renewed === null ? null : { ...renewed, lastActivityAt: Math.floor(now / 1000) };
}

const SAME_REQUEST_MS = 30_000;

/**
 * Whether the session was active recently enough to go on.
 *
 * One request reads its session several times: the proxy first, then
 * each `auth()` while the page renders. All of them see the cookie the
 * request arrived with, and only the proxy's answer reaches the
 * browser. A request that arrives just inside the limit must not be
 * accepted by the proxy and then refused, and its refresh token
 * revoked, by a read a moment later. So a session that passed is
 * remembered for half a minute, and passes again for that long.
 */
function passesIdleCheck(token: SessionTokens, idleSeconds: number, nowMs: number): boolean {
  if (typeof token.lastActivityAt !== 'number') return true;
  const b = books();
  sweep(b, nowMs);
  const key = fingerprint(
    `${token.lastActivityAt}:${token.refreshToken ?? token.accessToken ?? ''}`,
  );
  if (nowMs - token.lastActivityAt * 1000 <= idleSeconds * 1000) {
    b.seenActive.set(key, nowMs + SAME_REQUEST_MS);
    return true;
  }
  return b.seenActive.has(key);
}

async function renewedTokens<T extends SessionTokens>(
  token: T,
  deps: SessionRefreshDeps,
): Promise<T | null> {
  const now = deps.nowMs();
  const refused =
    typeof token.accessToken === 'string' && wasAccessTokenRejected(token.accessToken, now);
  if (!refused && !isRefreshDue(token.expiresAt, now, deps.marginSeconds)) return token;

  if (!token.refreshToken || deps.refresh === null) {
    const expired = isRefreshDue(token.expiresAt, now, 0);
    return expired ? null : token;
  }

  const outcome = await deps.refresh(token.refreshToken);
  if (outcome.status === 'rejected') return null;
  if (outcome.status === 'unavailable') return token;
  return {
    ...token,
    accessToken: outcome.accessToken,
    refreshToken: outcome.refreshToken ?? token.refreshToken,
    expiresAt: outcome.expiresAt,
  };
}

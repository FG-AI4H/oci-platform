import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupsFromAccessToken } from './token-claims';
import {
  activityReportSeconds,
  DEFAULT_IDLE_SECONDS,
  DEFAULT_REFRESH_MARGIN_SECONDS,
  sessionIdleSeconds,
  isRefreshDue,
  markAccessTokenRejected,
  refreshConfigFromEnv,
  refreshMarginSeconds,
  refreshTokens,
  requestTokenRefresh,
  resetTokenRefreshState,
  revokeRefreshToken,
  sessionTokensAfterRefresh,
  type RefreshOutcome,
  type SessionTokens,
} from './token-refresh';

const ISSUER = 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_TEST';
const TOKEN_ENDPOINT = 'https://oci-test.auth.eu-central-1.amazoncognito.com/oauth2/token';
const CONFIG = { issuer: ISSUER, clientId: 'client-abc', clientSecret: 'secret-xyz' };

/** Wed 18 Nov 2026 09:00:00 UTC, in ms. */
const T0 = Date.UTC(2026, 10, 18, 9, 0, 0);
const T0_SECONDS = T0 / 1000;

function accessTokenWith(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.signature`;
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A `fetch` that serves the discovery document and scripts the token endpoint. */
function poolFetch(
  tokenResponse: (body: URLSearchParams) => { status: number; body: unknown } | Error,
  discovery: unknown = { token_endpoint: TOKEN_ENDPOINT },
): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/.well-known/openid-configuration')) {
      return new Response(JSON.stringify(discovery), { status: 200 });
    }
    const answer = tokenResponse(new URLSearchParams(String(init?.body ?? '')));
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => resetTokenRefreshState());
afterEach(() => vi.restoreAllMocks());

describe('requestTokenRefresh', () => {
  it('sends a refresh-token grant, authenticated as the client, to the discovered endpoint', async () => {
    const { fetchImpl, calls } = poolFetch(() => ({
      status: 200,
      body: { access_token: 'access-2', id_token: 'id-2', token_type: 'Bearer', expires_in: 3600 },
    }));

    const outcome = await requestTokenRefresh(CONFIG, 'refresh-1', { fetchImpl, nowMs: () => T0 });

    expect(outcome).toEqual({
      status: 'refreshed',
      accessToken: 'access-2',
      expiresAt: T0_SECONDS + 3600,
    });
    expect(calls.map((c) => c.url)).toEqual([
      `${ISSUER}/.well-known/openid-configuration`,
      TOKEN_ENDPOINT,
    ]);
    const request = calls[1]?.init;
    expect(request?.method).toBe('POST');
    expect(request?.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from('client-abc:secret-xyz').toString('base64')}`,
    });
    const body = new URLSearchParams(String(request?.body));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'refresh_token',
      client_id: 'client-abc',
      refresh_token: 'refresh-1',
    });
  });

  it('returns the new refresh token when the pool rotates it', async () => {
    const { fetchImpl } = poolFetch(() => ({
      status: 200,
      body: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 },
    }));
    const outcome = await requestTokenRefresh(CONFIG, 'refresh-1', { fetchImpl, nowMs: () => T0 });
    expect(outcome).toMatchObject({ status: 'refreshed', refreshToken: 'refresh-2' });
  });

  it('falls back to the access token exp claim when expires_in is missing', async () => {
    const accessToken = accessTokenWith({ exp: T0_SECONDS + 1800 });
    const { fetchImpl } = poolFetch(() => ({ status: 200, body: { access_token: accessToken } }));
    const outcome = await requestTokenRefresh(CONFIG, 'refresh-1', { fetchImpl, nowMs: () => T0 });
    expect(outcome).toMatchObject({ status: 'refreshed', expiresAt: T0_SECONDS + 1800 });
  });

  it('reports invalid_grant as rejected: the refresh token is expired, revoked or rotated out', async () => {
    const { fetchImpl } = poolFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await requestTokenRefresh(CONFIG, 'refresh-1', { fetchImpl })).toEqual({
      status: 'rejected',
    });
  });

  it.each([
    ['a wrong client secret', { status: 401, body: { error: 'invalid_client' } }],
    ['throttling', { status: 429, body: {} }],
    ['an outage', { status: 503, body: 'upstream down' }],
    ['a success without an access token', { status: 200, body: { expires_in: 3600 } }],
    ['a success without any expiry', { status: 200, body: { access_token: 'opaque' } }],
    ['a network failure', new TypeError('fetch failed')],
  ])('reports %s as unavailable, which must not end the session', async (_name, answer) => {
    const { fetchImpl } = poolFetch(() => answer);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await requestTokenRefresh(CONFIG, 'refresh-1', { fetchImpl })).toEqual({
      status: 'unavailable',
    });
  });

  it('never sends the refresh token to a token endpoint that is not TLS', async () => {
    const { fetchImpl, calls } = poolFetch(() => ({ status: 200, body: {} }), {
      token_endpoint: 'http://pool.example.org/oauth2/token',
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await requestTokenRefresh(CONFIG, 'refresh-1', { fetchImpl })).toEqual({
      status: 'unavailable',
    });
    expect(calls).toHaveLength(1);
  });

  it('accepts a plain-HTTP token endpoint on loopback, for the end-to-end stand-in pool', async () => {
    const { fetchImpl, calls } = poolFetch(
      () => ({ status: 200, body: { access_token: 'access-2', expires_in: 60 } }),
      { token_endpoint: 'http://127.0.0.1:4643/oauth2/token' },
    );
    const outcome = await requestTokenRefresh(CONFIG, 'refresh-1', { fetchImpl });
    expect(outcome.status).toBe('refreshed');
    expect(calls[1]?.url).toBe('http://127.0.0.1:4643/oauth2/token');
  });

  it('logs the reason for a failure and nothing that is secret', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fetchImpl } = poolFetch(() => ({
      status: 401,
      body: { error: 'invalid_client', error_description: 'refresh-1 secret-xyz' },
    }));
    await requestTokenRefresh(CONFIG, 'refresh-1', { fetchImpl });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('invalid_client');
    expect(logged).not.toContain('refresh-1');
    expect(logged).not.toContain('secret-xyz');
  });
});

describe('revokeRefreshToken', () => {
  const REVOKE_ENDPOINT = 'https://oci-test.auth.eu-central-1.amazoncognito.com/oauth2/revoke';

  it('posts the refresh token to the pool revocation endpoint, authenticated as the client', async () => {
    const { fetchImpl, calls } = poolFetch(() => ({ status: 200, body: {} }));
    expect(await revokeRefreshToken(CONFIG, 'refresh-1', { fetchImpl })).toBe(true);

    expect(calls[1]?.url).toBe(REVOKE_ENDPOINT);
    const request = calls[1]?.init;
    expect(request?.method).toBe('POST');
    expect(request?.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from('client-abc:secret-xyz').toString('base64')}`,
    });
    expect(Object.fromEntries(new URLSearchParams(String(request?.body)))).toEqual({
      token: 'refresh-1',
    });
  });

  it.each([
    ['the pool refuses', { status: 400, body: { error: 'invalid_request' } }],
    ['the pool cannot be reached', new TypeError('fetch failed')],
  ])('is false, and does not throw, when %s', async (_name, answer) => {
    const { fetchImpl } = poolFetch(() => answer);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await revokeRefreshToken(CONFIG, 'refresh-1', { fetchImpl })).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('refresh-1');
  });

  it('does not guess an endpoint for a pool whose token endpoint is not /oauth2/token', async () => {
    const { fetchImpl, calls } = poolFetch(() => ({ status: 200, body: {} }), {
      token_endpoint: 'https://idp.example.org/connect/token-service',
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await revokeRefreshToken(CONFIG, 'refresh-1', { fetchImpl })).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe('refreshTokens', () => {
  const refreshed = (n: number): RefreshOutcome => ({
    status: 'refreshed',
    accessToken: `access-${n}`,
    expiresAt: T0_SECONDS + 3600,
  });

  it('runs one exchange for callers that present the same refresh token at once', async () => {
    let release: (outcome: RefreshOutcome) => void = () => undefined;
    const exchange = vi.fn(
      () =>
        new Promise<RefreshOutcome>((resolve) => {
          release = resolve;
        }),
    );

    const callers = Array.from({ length: 8 }, () => refreshTokens('refresh-1', exchange));
    release(refreshed(2));

    const outcomes = await Promise.all(callers);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(new Set(outcomes.map((o) => JSON.stringify(o)))).toEqual(
      new Set([JSON.stringify(refreshed(2))]),
    );
  });

  it('hands the same outcome to a caller that arrives after the exchange, for a minute', async () => {
    let now = T0;
    let n = 1;
    const exchange = vi.fn(async () => refreshed(++n));

    const clock = { nowMs: () => now };
    const first = await refreshTokens('refresh-1', exchange, clock);
    expect(first).toEqual(refreshed(2));
    now += 59_000;
    const late = await refreshTokens('refresh-1', exchange, clock);
    expect(late).toEqual(first);
    expect(exchange).toHaveBeenCalledTimes(1);

    now += 2_000;
    const next = await refreshTokens('refresh-1', exchange, clock);
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(next).toEqual(refreshed(3));
  });

  it('does not hand out an outcome whose own access token is already due for renewal', async () => {
    // A pool that does not rotate keeps the same refresh token, so the
    // remembered outcome is found again. With a short-lived token it
    // can be stale before the minute is over.
    let now = T0;
    let n = 1;
    const exchange = vi.fn(
      async (): Promise<RefreshOutcome> => ({
        status: 'refreshed',
        accessToken: `access-${++n}`,
        expiresAt: Math.floor(now / 1000) + 30,
      }),
    );
    const clock = { nowMs: () => now, marginSeconds: 10 };

    expect(await refreshTokens('refresh-1', exchange, clock)).toMatchObject({
      accessToken: 'access-2',
    });
    now += 19_000;
    expect(await refreshTokens('refresh-1', exchange, clock)).toMatchObject({
      accessToken: 'access-2',
    });
    now += 2_000;
    expect(await refreshTokens('refresh-1', exchange, clock)).toMatchObject({
      accessToken: 'access-3',
    });
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it('keeps different refresh tokens apart', async () => {
    const exchange = vi.fn(async (token: string) =>
      token === 'refresh-a' ? refreshed(10) : refreshed(20),
    );
    const [a, b] = await Promise.all([
      refreshTokens('refresh-a', exchange),
      refreshTokens('refresh-b', exchange),
    ]);
    expect(a).toEqual(refreshed(10));
    expect(b).toEqual(refreshed(20));
  });

  it('tries again soon after the pool could not be reached', async () => {
    let now = T0;
    const exchange = vi
      .fn<() => Promise<RefreshOutcome>>()
      .mockResolvedValueOnce({ status: 'unavailable' })
      .mockResolvedValueOnce(refreshed(2));

    const clock = { nowMs: () => now };
    expect(await refreshTokens('refresh-1', exchange, clock)).toEqual({
      status: 'unavailable',
    });
    now += 1_000;
    expect(await refreshTokens('refresh-1', exchange, clock)).toEqual({
      status: 'unavailable',
    });
    now += 5_000;
    expect(await refreshTokens('refresh-1', exchange, clock)).toEqual(refreshed(2));
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it('turns an exchange that throws into unavailable', async () => {
    const exchange = vi.fn(async (): Promise<RefreshOutcome> => {
      throw new Error('boom');
    });
    expect(await refreshTokens('refresh-1', exchange)).toEqual({ status: 'unavailable' });
  });

  it('does not reuse an outcome whose access token the API has since refused', async () => {
    let n = 1;
    const exchange = vi.fn(async () => refreshed(++n));

    const clock = { nowMs: () => T0 };
    expect(await refreshTokens('refresh-1', exchange, clock)).toEqual(refreshed(2));
    expect(await refreshTokens('refresh-1', exchange, clock)).toEqual(refreshed(2));
    markAccessTokenRejected('access-2', T0);
    expect(await refreshTokens('refresh-1', exchange, clock)).toEqual(refreshed(3));
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it('stays a single flight even when the pool hands back a token that is already due', async () => {
    // Otherwise every caller that joined would start its own exchange.
    const due: RefreshOutcome = { status: 'refreshed', accessToken: 'short', expiresAt: 1 };
    const exchange = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return due;
    });
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => refreshTokens('refresh-1', exchange)),
    );
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(outcomes.every((o) => o === due)).toBe(true);
  });
});

describe('isRefreshDue', () => {
  it('is due from five minutes before expiry onwards', () => {
    const expiresAt = T0_SECONDS + 3600;
    const at = (secondsBeforeExpiry: number) => (expiresAt - secondsBeforeExpiry) * 1000;
    expect(isRefreshDue(expiresAt, at(301), DEFAULT_REFRESH_MARGIN_SECONDS)).toBe(false);
    expect(isRefreshDue(expiresAt, at(300), DEFAULT_REFRESH_MARGIN_SECONDS)).toBe(true);
    expect(isRefreshDue(expiresAt, at(-1), DEFAULT_REFRESH_MARGIN_SECONDS)).toBe(true);
  });

  it('is never due for a session without an expiry (local dev)', () => {
    expect(isRefreshDue(undefined, T0, DEFAULT_REFRESH_MARGIN_SECONDS)).toBe(false);
  });
});

describe('sessionTokensAfterRefresh', () => {
  const session = (overrides: Partial<SessionTokens> = {}): SessionTokens & { sub: string } => ({
    sub: 'user-1',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: T0_SECONDS + 3600,
    ...overrides,
  });
  const deps = (
    nowMs: number,
    refresh: ((refreshToken: string) => Promise<RefreshOutcome>) | null,
  ) => ({ nowMs: () => nowMs, marginSeconds: DEFAULT_REFRESH_MARGIN_SECONDS, refresh });
  const minutes = (n: number) => T0 + n * 60_000;

  it('leaves a token with more than five minutes left alone', async () => {
    const refresh = vi.fn();
    const token = session();
    expect(await sessionTokensAfterRefresh(token, deps(minutes(54), refresh))).toBe(token);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes within five minutes of expiry and keeps the rest of the session', async () => {
    const refresh = vi.fn(
      async (): Promise<RefreshOutcome> => ({
        status: 'refreshed',
        accessToken: 'access-2',
        expiresAt: T0_SECONDS + 7200,
      }),
    );
    const next = await sessionTokensAfterRefresh(session(), deps(minutes(56), refresh));
    expect(refresh).toHaveBeenCalledWith('refresh-1');
    expect(next).toEqual({
      sub: 'user-1',
      accessToken: 'access-2',
      refreshToken: 'refresh-1',
      expiresAt: T0_SECONDS + 7200,
    });
  });

  it('refreshes a token that expired while the user was idle for 90 minutes', async () => {
    const refresh = vi.fn(
      async (): Promise<RefreshOutcome> => ({
        status: 'refreshed',
        accessToken: 'access-2',
        expiresAt: T0_SECONDS + 90 * 60 + 3600,
      }),
    );
    const next = await sessionTokensAfterRefresh(session(), deps(minutes(90), refresh));
    expect(next?.accessToken).toBe('access-2');
  });

  it('replaces the stored refresh token when the pool rotates it', async () => {
    const refresh = async (): Promise<RefreshOutcome> => ({
      status: 'refreshed',
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresAt: T0_SECONDS + 7200,
    });
    const next = await sessionTokensAfterRefresh(session(), deps(minutes(56), refresh));
    expect(next?.refreshToken).toBe('refresh-2');
  });

  it('ends the session when the pool refuses the refresh token', async () => {
    const refresh = async (): Promise<RefreshOutcome> => ({ status: 'rejected' });
    expect(await sessionTokensAfterRefresh(session(), deps(minutes(56), refresh))).toBeNull();
  });

  it('keeps the session when the pool cannot be reached', async () => {
    const refresh = async (): Promise<RefreshOutcome> => ({ status: 'unavailable' });
    const token = session();
    expect(await sessionTokensAfterRefresh(token, deps(minutes(56), refresh))).toBe(token);
  });

  it('refreshes a token the API refused, whatever its expiry says', async () => {
    markAccessTokenRejected('access-1', minutes(10));
    const refresh = vi.fn(
      async (): Promise<RefreshOutcome> => ({
        status: 'refreshed',
        accessToken: 'access-2',
        expiresAt: T0_SECONDS + 4200,
      }),
    );
    const next = await sessionTokensAfterRefresh(session(), deps(minutes(10), refresh));
    expect(next?.accessToken).toBe('access-2');
  });

  it('ends a session that expired and has no refresh token', async () => {
    const legacy = session({ refreshToken: undefined });
    expect(await sessionTokensAfterRefresh(legacy, deps(minutes(59), vi.fn()))).toBe(legacy);
    expect(await sessionTokensAfterRefresh(legacy, deps(minutes(61), vi.fn()))).toBeNull();
  });

  it('never touches the local-dev session, which has no expiry and no pool', async () => {
    const local: SessionTokens = { accessToken: 'dev:local-dev@oci.ai4h.net:host,admin' };
    expect(await sessionTokensAfterRefresh(local, deps(minutes(600), null))).toBe(local);
  });

  it('picks up a role granted during the session at the next refresh', async () => {
    const before = accessTokenWith({ sub: 'user-1', 'cognito:groups': ['participant'] });
    const after = accessTokenWith({ sub: 'user-1', 'cognito:groups': ['participant', 'host'] });
    const refresh = async (): Promise<RefreshOutcome> => ({
      status: 'refreshed',
      accessToken: after,
      expiresAt: T0_SECONDS + 7200,
    });

    // The session callback describes the caller from whatever token is
    // stored (`describeCaller` in auth.ts → `groupsFromAccessToken`).
    const stored = session({ accessToken: before });
    expect(groupsFromAccessToken(stored.accessToken)).toEqual(['participant']);

    const next = await sessionTokensAfterRefresh(stored, deps(minutes(56), refresh));
    expect(groupsFromAccessToken(next?.accessToken)).toEqual(['participant', 'host']);
  });
});

describe('parallel requests against a pool that rotates refresh tokens', () => {
  /**
   * A pool at its strictest: every refresh token works exactly once,
   * with no grace period. A second use is `invalid_grant`.
   */
  function rotatingPool() {
    let generation = 1;
    const spent = new Set<string>();
    const exchange = vi.fn(async (refreshToken: string): Promise<RefreshOutcome> => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (spent.has(refreshToken) || refreshToken !== `refresh-${generation}`) {
        return { status: 'rejected' };
      }
      spent.add(refreshToken);
      generation += 1;
      return {
        status: 'refreshed',
        accessToken: `access-${generation}`,
        refreshToken: `refresh-${generation}`,
        // An hour from the moment the test's requests arrive.
        expiresAt: T0_SECONDS + 58 * 60 + 3600,
      };
    });
    return { exchange };
  }

  it('signs nobody out: every request carrying the old cookie gets the same new tokens', async () => {
    const { exchange } = rotatingPool();
    const stale: SessionTokens = {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: T0_SECONDS + 3600,
    };
    const nowMs = () => T0 + 58 * 60_000;
    const deps = {
      nowMs,
      marginSeconds: DEFAULT_REFRESH_MARGIN_SECONDS,
      refresh: (refreshToken: string) => refreshTokens(refreshToken, exchange, { nowMs }),
    };

    // Twelve requests in flight with the same cookie, then four more
    // that were sent before the browser stored the renewed one.
    const parallel = await Promise.all(
      Array.from({ length: 12 }, () => sessionTokensAfterRefresh({ ...stale }, deps)),
    );
    const late = await Promise.all(
      Array.from({ length: 4 }, () => sessionTokensAfterRefresh({ ...stale }, deps)),
    );

    expect(exchange).toHaveBeenCalledTimes(1);
    for (const result of [...parallel, ...late]) {
      expect(result).toEqual({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        expiresAt: T0_SECONDS + 58 * 60 + 3600,
      });
    }
  });

  it('without the shared outcome the second request would have been signed out', async () => {
    // The control: the same pool, called directly by two requests.
    const { exchange } = rotatingPool();
    const [first, second] = [await exchange('refresh-1'), await exchange('refresh-1')];
    expect(first.status).toBe('refreshed');
    expect(second.status).toBe('rejected');
  });
});

describe('the idle limit', () => {
  const TWO_HOURS = 2 * 60 * 60;
  const refreshed = (expiresAt: number): RefreshOutcome => ({
    status: 'refreshed',
    accessToken: `access-until-${expiresAt}`,
    expiresAt,
  });
  /** A pool that always renews for another hour. */
  const deps = (nowMs: number) => ({
    nowMs: () => nowMs,
    marginSeconds: DEFAULT_REFRESH_MARGIN_SECONDS,
    idleSeconds: TWO_HOURS,
    refresh: vi.fn(async () => refreshed(Math.floor(nowMs / 1000) + 3600)),
  });
  const signedInAt = (seconds: number): SessionTokens => ({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: seconds + 3600,
    lastActivityAt: seconds,
  });
  const at = (seconds: number) => seconds * 1000;

  it('records each request as activity', async () => {
    const next = await sessionTokensAfterRefresh(
      signedInAt(T0_SECONDS),
      deps(at(T0_SECONDS + 600)),
    );
    expect(next?.lastActivityAt).toBe(T0_SECONDS + 600);
    expect(next?.accessToken).toBe('access-1');
  });

  it('keeps a session whose user comes back just inside the limit, and renews its token', async () => {
    const next = await sessionTokensAfterRefresh(
      signedInAt(T0_SECONDS),
      deps(at(T0_SECONDS + TWO_HOURS)),
    );
    expect(next).toMatchObject({
      accessToken: `access-until-${T0_SECONDS + TWO_HOURS + 3600}`,
      lastActivityAt: T0_SECONDS + TWO_HOURS,
    });
  });

  it('ends a session left idle past the limit, without spending the refresh token', async () => {
    const d = deps(at(T0_SECONDS + TWO_HOURS + 1));
    expect(await sessionTokensAfterRefresh(signedInAt(T0_SECONDS), d)).toBeNull();
    expect(d.refresh).not.toHaveBeenCalled();
  });

  it('a request accepted just inside the limit is not refused by a later read of the same request', async () => {
    // The proxy reads the session at limit − 0.2 s and lets the request
    // in. The page reads the same cookie half a second later, past the
    // limit. It must get the session too, and the refresh token must
    // not be revoked under a browser that was just told it is signed in.
    const stored = signedInAt(T0_SECONDS);
    const revoke = vi.fn(async () => true);
    const proxyRead = { ...deps((T0_SECONDS + TWO_HOURS) * 1000 - 200), revoke };
    const pageRead = { ...deps((T0_SECONDS + TWO_HOURS) * 1000 + 300), revoke };

    expect(await sessionTokensAfterRefresh(stored, proxyRead)).not.toBeNull();
    expect(await sessionTokensAfterRefresh(stored, pageRead)).not.toBeNull();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('but the same cookie presented again a minute later is refused', async () => {
    const stored = signedInAt(T0_SECONDS);
    const proxyRead = deps((T0_SECONDS + TWO_HOURS) * 1000 - 200);
    const replay = deps((T0_SECONDS + TWO_HOURS + 60) * 1000);

    expect(await sessionTokensAfterRefresh(stored, proxyRead)).not.toBeNull();
    expect(await sessionTokensAfterRefresh(stored, replay)).toBeNull();
  });

  it('revokes the refresh token of a session it ends for idleness', async () => {
    const revoke = vi.fn(async () => true);
    const d = { ...deps(at(T0_SECONDS + TWO_HOURS + 1)), revoke };
    expect(await sessionTokensAfterRefresh(signedInAt(T0_SECONDS), d)).toBeNull();
    expect(revoke).toHaveBeenCalledWith('refresh-1');
  });

  it('still ends the idle session when the revocation fails', async () => {
    const revoke = vi.fn(async () => {
      throw new Error('pool unreachable');
    });
    const d = { ...deps(at(T0_SECONDS + TWO_HOURS + 1)), revoke };
    expect(await sessionTokensAfterRefresh(signedInAt(T0_SECONDS), d)).toBeNull();
  });

  it('never ends an active session for its age: ten hours of work, a request every 90 minutes', async () => {
    let stored = signedInAt(T0_SECONDS);
    for (let elapsed = 5400; elapsed <= 36_000; elapsed += 5400) {
      const next = await sessionTokensAfterRefresh(stored, deps(at(T0_SECONDS + elapsed)));
      expect(next, `still signed in after ${elapsed / 3600} h`).not.toBeNull();
      stored = next ?? stored;
    }
    expect(stored.lastActivityAt).toBe(T0_SECONDS + 32_400);
  });

  it('starts the clock for a session that predates the limit instead of ending it', async () => {
    const legacy: SessionTokens = { accessToken: 'access-1', expiresAt: T0_SECONDS + 3600 };
    const next = await sessionTokensAfterRefresh(legacy, deps(at(T0_SECONDS + 60)));
    expect(next?.lastActivityAt).toBe(T0_SECONDS + 60);
  });

  it('applies no limit and records nothing when none is set (local dev)', async () => {
    const local: SessionTokens = { accessToken: 'dev:reader:annotator', lastActivityAt: 1 };
    const next = await sessionTokensAfterRefresh(local, {
      nowMs: () => T0,
      marginSeconds: DEFAULT_REFRESH_MARGIN_SECONDS,
      idleSeconds: null,
      refresh: null,
    });
    expect(next).toBe(local);
  });

  it('comes from the environment; a deployed environment without one gets the strictest', () => {
    expect(sessionIdleSeconds({ OCI_ENV: 'dev', OCI_SESSION_IDLE_SECONDS: '7200' })).toBe(7200);
    expect(sessionIdleSeconds({ OCI_ENV: 'prod' })).toBe(DEFAULT_IDLE_SECONDS);
    for (const bad of ['', '0', '-1', '1.5', 'never', '999999']) {
      expect(sessionIdleSeconds({ OCI_ENV: 'dev', OCI_SESSION_IDLE_SECONDS: bad })).toBe(1800);
    }
    expect(sessionIdleSeconds({ OCI_ENV: 'local' })).toBeNull();
    expect(sessionIdleSeconds({ NEXT_PUBLIC_OCI_ENV: 'local' })).toBeNull();
    expect(sessionIdleSeconds({ OCI_ENV: 'local', OCI_SESSION_IDLE_SECONDS: '60' })).toBe(60);
  });

  it('lets an open page report use a quarter of the limit apart, five minutes at most', () => {
    expect(activityReportSeconds(7200)).toBe(300);
    expect(activityReportSeconds(1800)).toBe(300);
    expect(activityReportSeconds(600)).toBe(150);
    expect(activityReportSeconds(25)).toBe(6);
    expect(activityReportSeconds(4)).toBe(5);
  });
});

describe('configuration', () => {
  it('reads the pool from the web task environment, or nothing in local dev', () => {
    expect(
      refreshConfigFromEnv({
        AUTH_COGNITO_ISSUER: ISSUER,
        AUTH_COGNITO_ID: 'client-abc',
        AUTH_COGNITO_SECRET: 'secret-xyz',
      }),
    ).toEqual(CONFIG);
    expect(refreshConfigFromEnv({ AUTH_COGNITO_ISSUER: ISSUER })).toBeNull();
    expect(refreshConfigFromEnv({})).toBeNull();
  });

  it('refreshes five minutes before expiry unless a whole number of seconds says otherwise', () => {
    expect(refreshMarginSeconds({})).toBe(300);
    expect(refreshMarginSeconds({ OCI_SESSION_REFRESH_MARGIN_SECONDS: '2' })).toBe(2);
    expect(refreshMarginSeconds({ OCI_SESSION_REFRESH_MARGIN_SECONDS: '0' })).toBe(0);
    for (const bad of ['', '-5', '2.5', '9999', 'soon', '3001']) {
      expect(refreshMarginSeconds({ OCI_SESSION_REFRESH_MARGIN_SECONDS: bad })).toBe(300);
    }
  });
});

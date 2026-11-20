import {
  createHash,
  createSign,
  createVerify,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * A stand-in for the Cognito user pool and for the OCI API, for the
 * session-refresh end-to-end test (#643).
 *
 * Locally the stack runs with stubbed sign-in and an API that ignores
 * tokens, so nothing there can expire. This server gives the web app,
 * running in its deployed (non-local) mode, the two things it talks to:
 *
 *   - an OpenID Connect issuer: discovery, an authorization endpoint
 *     that signs the one test user in without a form, a token endpoint
 *     with the authorization-code and refresh-token grants, and a JWKS.
 *     Access tokens are real RS256 JWTs that live a few seconds.
 *   - an API under `/api` that checks the bearer token's signature and
 *     expiry on every call and answers 401 to an expired one, as the
 *     real API does. It serves the two preference endpoints the
 *     `/settings` form uses and nothing else.
 *
 * What it is not: Cognito. It proves what the web app does when tokens
 * expire and are renewed; it proves nothing about how the real pool or
 * the real API behave.
 *
 * It runs inside the Playwright worker, so the test reads its counters
 * and changes its behaviour directly.
 */

export interface StandInPoolOptions {
  port: number;
  clientId: string;
  clientSecret: string;
  /** Origin of the web app under test; the only place a code is sent. */
  appOrigin: string;
  /** Lifetime of each access token. */
  accessTokenSeconds: number;
}

export type ApiCallOutcome = 'accepted' | 'expired' | 'refused' | 'missing' | 'invalid';

export interface ApiCall {
  method: string;
  path: string;
  outcome: ApiCallOutcome;
}

export interface StandInPool {
  readonly issuer: string;
  readonly apiBaseUrl: string;
  readonly user: { sub: string; email: string };
  /**
   * `true`: every refresh token works once and there is no grace
   * period, the strictest a pool can be. `false`: the refresh token
   * stays valid and is not reissued, which is how the pool is
   * configured today.
   */
  rotateRefreshTokens: boolean;
  /** The user's groups, as the next token issued will carry them. */
  setGroups(groups: readonly string[]): void;
  /** Refuse every refresh token issued so far, as if they had expired. */
  revokeRefreshTokens(): void;
  /**
   * Make the API answer 401 to every access token issued so far, though
   * none has expired: what a caller sees when a token is revoked or the
   * clocks disagree.
   */
  refuseAccessTokensIssuedSoFar(): void;
  /** Every access, id and refresh token issued so far, verbatim. */
  issuedTokens(): readonly string[];
  /** Expiry of the most recently issued access token, ms since the epoch. */
  latestAccessTokenExpiryMs(): number;
  readonly counts: {
    codeGrants: number;
    refreshGrants: number;
    /** Refresh-token grants answered `invalid_grant`. */
    refusedRefreshGrants: number;
    /** Live refresh tokens the app revoked at `/oauth2/revoke`. */
    revokedRefreshTokens: number;
  };
  /** How many refresh tokens the pool would still honour. */
  liveRefreshTokenCount(): number;
  readonly apiCalls: readonly ApiCall[];
  close(): Promise<void>;
}

interface PendingCode {
  redirectUri: string;
  nonce: string | null;
  codeChallenge: string | null;
}

interface Preferences {
  darkMode: string;
  density: string;
  locale: string | null;
  updatedAt: string;
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startStandInPool(options: StandInPoolOptions): Promise<StandInPool> {
  const issuer = `http://127.0.0.1:${options.port}`;
  const callbackUrl = `${options.appOrigin}/api/auth/callback/cognito`;
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyId = randomUUID();

  const user = { sub: randomUUID(), email: 'reader@example.org' };
  let groups: readonly string[] = ['participant'];
  let latestAccessTokenExpiryMs = 0;
  let preferences: Preferences = {
    darkMode: 'system',
    density: 'comfortable',
    locale: null,
    updatedAt: new Date(0).toISOString(),
  };

  const codes = new Map<string, PendingCode>();
  const liveRefreshTokens = new Set<string>();
  const accessTokens: string[] = [];
  const refusedAccessTokens = new Set<string>();
  const issued: string[] = [];
  const counts = {
    codeGrants: 0,
    refreshGrants: 0,
    refusedRefreshGrants: 0,
    revokedRefreshTokens: 0,
  };
  const apiCalls: ApiCall[] = [];

  function signJwt(claims: Record<string, unknown>): string {
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: keyId }));
    const payload = base64url(JSON.stringify(claims));
    const signature = createSign('RSA-SHA256')
      .update(`${header}.${payload}`)
      .sign(privateKey)
      .toString('base64url');
    return `${header}.${payload}.${signature}`;
  }

  /** The claims a pool access token carries, so the token has a realistic size. */
  function issueAccessToken(): { token: string; expiresIn: number } {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + options.accessTokenSeconds;
    latestAccessTokenExpiryMs = exp * 1000;
    const token = signJwt({
      sub: user.sub,
      'cognito:groups': groups,
      iss: issuer,
      version: 2,
      client_id: options.clientId,
      origin_jti: randomUUID(),
      event_id: randomUUID(),
      token_use: 'access',
      scope: 'openid profile email',
      auth_time: now,
      exp,
      iat: now,
      jti: randomUUID(),
      username: user.sub,
    });
    issued.push(token);
    accessTokens.push(token);
    return { token, expiresIn: options.accessTokenSeconds };
  }

  function issueIdToken(nonce: string | null): string {
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt({
      sub: user.sub,
      'cognito:groups': groups,
      email_verified: true,
      iss: issuer,
      'cognito:username': user.sub,
      origin_jti: randomUUID(),
      aud: options.clientId,
      event_id: randomUUID(),
      token_use: 'id',
      auth_time: now,
      exp: now + options.accessTokenSeconds,
      iat: now,
      jti: randomUUID(),
      email: user.email,
      ...(nonce === null ? {} : { nonce }),
    });
    issued.push(token);
    return token;
  }

  /**
   * Opaque, and 2,048 characters long: pool refresh tokens are large,
   * and the point is to store one in the session cookie at a size that
   * forces the cookie to be split.
   */
  function issueRefreshToken(): string {
    const token = randomBytes(1536).toString('base64url');
    liveRefreshTokens.add(token);
    issued.push(token);
    return token;
  }

  function clientAuthenticated(req: IncomingMessage, form: URLSearchParams): boolean {
    const header = req.headers.authorization;
    if (header?.startsWith('Basic ')) {
      const [id, ...secret] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
      return (
        decodeURIComponent(id ?? '') === options.clientId &&
        decodeURIComponent(secret.join(':')) === options.clientSecret
      );
    }
    return (
      form.get('client_id') === options.clientId &&
      form.get('client_secret') === options.clientSecret
    );
  }

  function authorize(url: URL, res: ServerResponse): void {
    const redirectUri = url.searchParams.get('redirect_uri');
    if (
      url.searchParams.get('client_id') !== options.clientId ||
      url.searchParams.get('response_type') !== 'code' ||
      redirectUri !== callbackUrl
    ) {
      send(res, 400, { error: 'invalid_request' });
      return;
    }
    const code = randomBytes(24).toString('base64url');
    codes.set(code, {
      redirectUri,
      nonce: url.searchParams.get('nonce'),
      codeChallenge: url.searchParams.get('code_challenge'),
    });
    const back = new URL(redirectUri);
    back.searchParams.set('code', code);
    const state = url.searchParams.get('state');
    if (state !== null) back.searchParams.set('state', state);
    res.writeHead(302, { Location: back.toString() });
    res.end();
  }

  async function token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = new URLSearchParams(await readBody(req));
    if (!clientAuthenticated(req, form)) {
      send(res, 401, { error: 'invalid_client' });
      return;
    }

    if (form.get('grant_type') === 'authorization_code') {
      const code = form.get('code') ?? '';
      const pending = codes.get(code);
      codes.delete(code);
      const verifier = form.get('code_verifier') ?? '';
      const pkceHolds =
        pending?.codeChallenge == null ||
        createHash('sha256').update(verifier).digest('base64url') === pending.codeChallenge;
      if (!pending || form.get('redirect_uri') !== pending.redirectUri || !pkceHolds) {
        send(res, 400, { error: 'invalid_grant' });
        return;
      }
      counts.codeGrants += 1;
      const access = issueAccessToken();
      send(res, 200, {
        access_token: access.token,
        id_token: issueIdToken(pending.nonce),
        refresh_token: issueRefreshToken(),
        token_type: 'Bearer',
        expires_in: access.expiresIn,
      });
      return;
    }

    if (form.get('grant_type') === 'refresh_token') {
      const presented = form.get('refresh_token') ?? '';
      if (!liveRefreshTokens.has(presented)) {
        counts.refusedRefreshGrants += 1;
        send(res, 400, { error: 'invalid_grant' });
        return;
      }
      counts.refreshGrants += 1;
      if (pool.rotateRefreshTokens) liveRefreshTokens.delete(presented);
      const access = issueAccessToken();
      send(res, 200, {
        access_token: access.token,
        id_token: issueIdToken(null),
        ...(pool.rotateRefreshTokens ? { refresh_token: issueRefreshToken() } : {}),
        token_type: 'Bearer',
        expires_in: access.expiresIn,
      });
      return;
    }

    send(res, 400, { error: 'unsupported_grant_type' });
  }

  /** Signature and expiry, with no leeway: an expired token is a 401. */
  function checkBearer(req: IncomingMessage): ApiCallOutcome {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return 'missing';
    if (refusedAccessTokens.has(header.slice(7))) return 'refused';
    const [head, payload, signature, ...rest] = header.slice(7).split('.');
    if (!head || !payload || !signature || rest.length > 0) return 'invalid';
    const genuine = createVerify('RSA-SHA256')
      .update(`${head}.${payload}`)
      .verify(publicKey, Buffer.from(signature, 'base64url'));
    if (!genuine) return 'invalid';
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
      token_use?: unknown;
    };
    if (claims.token_use !== 'access' || typeof claims.exp !== 'number') return 'invalid';
    return Date.now() >= claims.exp * 1000 ? 'expired' : 'accepted';
  }

  async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const method = req.method ?? 'GET';
    if (path === '/v2/platform-settings/banner') {
      send(res, 200, { banner: null });
      return;
    }
    if (path !== '/v2/preferences/me' || (method !== 'GET' && method !== 'PUT')) {
      send(res, 404, { status: 404, title: 'Not Found' });
      return;
    }
    const outcome = checkBearer(req);
    apiCalls.push({ method, path, outcome });
    if (outcome !== 'accepted') {
      send(res, 401, { status: 401, title: 'Unauthorized', detail: `token ${outcome}` });
      return;
    }
    if (method === 'PUT') {
      const body = JSON.parse(await readBody(req)) as Partial<Preferences>;
      preferences = {
        darkMode: body.darkMode ?? preferences.darkMode,
        density: body.density ?? preferences.density,
        locale: body.locale ?? null,
        updatedAt: new Date().toISOString(),
      };
    }
    send(res, 200, preferences);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', issuer);
    if (url.pathname === '/.well-known/openid-configuration') {
      send(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/oauth2/authorize`,
        token_endpoint: `${issuer}/oauth2/token`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        userinfo_endpoint: `${issuer}/oauth2/userInfo`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['openid', 'email', 'profile'],
      });
    } else if (url.pathname === '/.well-known/jwks.json') {
      send(res, 200, {
        keys: [{ ...publicKey.export({ format: 'jwk' }), kid: keyId, alg: 'RS256', use: 'sig' }],
      });
    } else if (url.pathname === '/oauth2/authorize' && req.method === 'GET') {
      authorize(url, res);
    } else if (url.pathname === '/oauth2/token' && req.method === 'POST') {
      await token(req, res);
    } else if (url.pathname === '/oauth2/revoke' && req.method === 'POST') {
      // As the pool's revocation endpoint: client credentials, a
      // `token` field, an empty 200 whether or not the token was live.
      const form = new URLSearchParams(await readBody(req));
      if (!clientAuthenticated(req, form)) {
        send(res, 401, { error: 'invalid_client' });
        return;
      }
      if (liveRefreshTokens.delete(form.get('token') ?? '')) counts.revokedRefreshTokens += 1;
      res.writeHead(200).end();
    } else if (url.pathname === '/oauth2/userInfo') {
      if (checkBearer(req) === 'accepted') {
        send(res, 200, { sub: user.sub, email: user.email, email_verified: true });
      } else {
        send(res, 401, { error: 'invalid_token' });
      }
    } else if (url.pathname.startsWith('/api/')) {
      await api(req, res, url.pathname.slice('/api'.length));
    } else {
      send(res, 404, { status: 404, title: 'Not Found' });
    }
  }

  const server: Server = createServer((req, res) => {
    route(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { status: 500, title: 'Stand-in pool error' });
    });
  });

  const pool: StandInPool = {
    issuer,
    apiBaseUrl: `${issuer}/api`,
    user,
    rotateRefreshTokens: true,
    setGroups: (next) => {
      groups = [...next];
    },
    revokeRefreshTokens: () => liveRefreshTokens.clear(),
    liveRefreshTokenCount: () => liveRefreshTokens.size,
    refuseAccessTokensIssuedSoFar: () => {
      for (const accessToken of accessTokens) refusedAccessTokens.add(accessToken);
    },
    issuedTokens: () => issued,
    latestAccessTokenExpiryMs: () => latestAccessTokenExpiryMs,
    counts,
    apiCalls,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', resolve);
  });
  return pool;
}

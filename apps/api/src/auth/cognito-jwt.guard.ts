import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { CognitoJwtVerifierSingleUserPool } from 'aws-jwt-verify/cognito-verifier';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';

export const COGNITO_VERIFIER = Symbol('CognitoAccessTokenVerifier');

const isLocal = process.env.OCI_ENV === 'local';

/**
 * NestJS guard that verifies a Cognito access token from the
 * `Authorization: Bearer <token>` header. On success, attaches the
 * decoded payload to `request.user`. The `@CurrentUser()` decorator
 * (below) reads it back out.
 *
 * Throws 401 on missing/invalid/expired tokens.
 *
 * Local-dev bypass: when `OCI_ENV=local` (CDK never sets this), the
 * guard skips JWT verification and fabricates `request.user` from one of:
 *
 *   1. `Authorization: Bearer dev:<user>:<roles>` — sentinel stamped by
 *      the local-mode NextAuth Credentials provider in apps/web. Roles
 *      is comma-separated.
 *   2. `X-Dev-User` / `X-Dev-Roles` headers — for curl/Postman testing.
 *   3. Defaults: user `local-dev@oci.ai4h.net`, roles `host,admin`.
 *
 * The provider in `auth.module.ts` registers a no-op verifier in local
 * mode, so the constructor still resolves but its dependency is never
 * called. We branch in `canActivate` rather than swapping the guard
 * class because `@UseGuards(CognitoJwtGuard)` resolves the guard by
 * literal class reference — a `provide: CognitoJwtGuard, useClass:
 * Other` override does not consistently intercept across module
 * boundaries.
 */
@Injectable()
export class CognitoJwtGuard implements CanActivate {
  private readonly logger = new Logger(CognitoJwtGuard.name);

  constructor(
    @Optional()
    @Inject(COGNITO_VERIFIER)
    private readonly verifier:
      | CognitoJwtVerifierSingleUserPool<{
          userPoolId: string;
          tokenUse: 'access';
          clientId: string;
        }>
      | undefined,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: CognitoAccessTokenPayload;
    }>();
    const header = req.headers.authorization;
    const auth = Array.isArray(header) ? header[0] : header;

    if (isLocal) {
      const fromBearer = parseBearerSentinel(auth);
      const userValue =
        fromBearer?.user ?? pickHeader(req.headers['x-dev-user']) ?? 'local-dev@oci.ai4h.net';
      const rolesValue =
        fromBearer?.roles ?? pickHeader(req.headers['x-dev-roles']) ?? 'host,admin';
      const groups = rolesValue
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const now = Math.floor(Date.now() / 1000);
      req.user = {
        sub: userValue,
        username: userValue,
        'cognito:groups': groups,
        scope: 'aws.cognito.signin.user.admin',
        token_use: 'access',
        iat: now,
        exp: now + 3600,
        auth_time: now,
        iss: 'dev-stub',
        jti: 'dev-stub',
        origin_jti: 'dev-stub',
        client_id: 'dev-stub',
        version: 2,
      } as unknown as CognitoAccessTokenPayload;
      this.logger.debug(`stub user=${userValue} groups=[${groups.join(',')}]`);
      return true;
    }

    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    const token = auth.slice('Bearer '.length).trim();
    if (!this.verifier) {
      throw new UnauthorizedException('cognito verifier not configured');
    }
    try {
      req.user = await this.verifier.verify(token);
      return true;
    } catch (err) {
      throw new UnauthorizedException(
        err instanceof Error ? `invalid token: ${err.message}` : 'invalid token',
      );
    }
  }
}

/**
 * Param decorator: `@CurrentUser() user: CognitoAccessTokenPayload`.
 * Returns the verified token payload attached by `CognitoJwtGuard`.
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CognitoAccessTokenPayload | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: CognitoAccessTokenPayload }>();
    return req.user;
  },
);

function pickHeader(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function parseBearerSentinel(
  authHeader: string | undefined,
): { user: string; roles: string } | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token.startsWith('dev:')) return null;
  // Format: dev:<user>:<roles>. Split into 2 parts max — emails don't
  // contain ':' so the last colon separates user from roles.
  const rest = token.slice('dev:'.length);
  const lastColon = rest.lastIndexOf(':');
  if (lastColon < 0) return null;
  const user = rest.slice(0, lastColon);
  const roles = rest.slice(lastColon + 1);
  if (!user || !roles) return null;
  return { user, roles };
}

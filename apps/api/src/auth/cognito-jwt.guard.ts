import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { CognitoJwtVerifierSingleUserPool } from 'aws-jwt-verify/cognito-verifier';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';

export const COGNITO_VERIFIER = Symbol('CognitoAccessTokenVerifier');

/**
 * NestJS guard that verifies a Cognito access token from the
 * `Authorization: Bearer <token>` header. On success, attaches the
 * decoded payload to `request.user`. The `@CurrentUser()` decorator
 * (below) reads it back out.
 *
 * Throws 401 on missing/invalid/expired tokens.
 */
@Injectable()
export class CognitoJwtGuard implements CanActivate {
  constructor(
    @Inject(COGNITO_VERIFIER)
    private readonly verifier: CognitoJwtVerifierSingleUserPool<{
      userPoolId: string;
      tokenUse: 'access';
      clientId: string;
    }>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: CognitoAccessTokenPayload;
    }>();
    const header = req.headers.authorization;
    const auth = Array.isArray(header) ? header[0] : header;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    const token = auth.slice('Bearer '.length).trim();
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

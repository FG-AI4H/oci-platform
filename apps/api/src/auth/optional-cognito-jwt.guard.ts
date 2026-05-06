import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { CognitoJwtGuard } from './cognito-jwt.guard.js';

/**
 * Lenient companion to `CognitoJwtGuard` for endpoints that are
 * anonymous-friendly but want to use the caller's identity for
 * visibility filtering when a token IS supplied (e.g. the catalog
 * GETs: anonymous → PUBLIC only; authenticated → +RESTRICTED).
 *
 * Behaviour:
 *   - No `Authorization` header   → allow, `req.user` stays undefined.
 *   - Header present but invalid  → 401 (strict — caller sent something
 *                                   we can't verify, fail loudly).
 *   - Header present and valid    → allow, `req.user` populated.
 *
 * Composition: delegates to the strict guard so the verification path
 * (and the local-mode stub) stay in one place.
 */
@Injectable()
export class OptionalCognitoJwtGuard implements CanActivate {
  // Same `@Inject` workaround as the catalog module (#77): tsx's
  // esbuild transform doesn't preserve constructor-param metadata
  // for type-based DI, so the explicit token is needed for the dev
  // path. tsc-built CI/prod accept either form.
  constructor(@Inject(CognitoJwtGuard) private readonly strict: CognitoJwtGuard) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const header = req.headers.authorization;
    const auth = Array.isArray(header) ? header[0] : header;
    if (!auth) return true;
    return this.strict.canActivate(ctx) as Promise<boolean>;
  }
}

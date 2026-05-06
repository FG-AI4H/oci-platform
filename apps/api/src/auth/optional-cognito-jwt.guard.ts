import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
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
  constructor(private readonly strict: CognitoJwtGuard) {}

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

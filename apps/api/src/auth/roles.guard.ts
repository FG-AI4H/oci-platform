import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import type { Role } from '@oci/shared-types';

const ROLES_KEY = 'oci:requiredRoles';

/**
 * Decorator: `@Roles('host')` or `@Roles('admin', 'host')`.
 * Reads the user's `cognito:groups` claim and 403s if none of the
 * required roles match. Use AFTER `CognitoJwtGuard` in the guard chain
 * so the request has been authenticated.
 *
 * Works as both a method and class decorator (Nest's reflector reads
 * up the chain via `getAllAndOverride([handler, class])`).
 *
 * Annotation-specific roles use the parallel `AnnotationRoles` /
 * `AnnotationRolesGuard` in `apps/api/src/modules/annotation/` —
 * keep them separate so the annotation surface can swap to a Visa-
 * backed check (ADR-0006 Decision 2) without disturbing the platform-
 * wide group check here.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  // `Reflector` is stateless. Instantiating it directly (rather than
  // constructor-inject) sidesteps a Nest 11 DI quirk where guards
  // referenced via `@UseGuards(RolesGuard)` were occasionally created
  // before the InternalCoreModule's Reflector singleton was bound,
  // surfacing as `Cannot read properties of undefined (reading
  // 'getAllAndOverride')` at the first request.
  private readonly reflector = new Reflector();

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: CognitoAccessTokenPayload }>();
    const groups = (req.user?.['cognito:groups'] ?? []) as string[];

    // `admin` is the operator override — always satisfies any role
    // check. Mirrors `isCampaignManager` / `isHost` on the web side.
    const hasAny = required.some((r) => groups.includes(r) || groups.includes('admin'));
    if (!hasAny) {
      throw new ForbiddenException(`requires one of: ${required.join(', ')}`);
    }
    return true;
  }
}

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
 */
export const Roles = (...roles: Role[]): MethodDecorator => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: CognitoAccessTokenPayload }>();
    const groups = (req.user?.['cognito:groups'] ?? []) as string[];

    const hasAny = required.some((r) => groups.includes(r) || groups.includes('admin'));
    if (!hasAny) {
      throw new ForbiddenException(`requires one of: ${required.join(', ')}`);
    }
    return true;
  }
}

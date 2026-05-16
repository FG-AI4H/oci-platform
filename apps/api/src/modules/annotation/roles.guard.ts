import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';

/**
 * Annotation roles per ADR-0006 Decision 2. Issued as time-bounded
 * GA4GH Visas, but for the Phase B.A.1 scaffold we check the Cognito
 * group claim directly. Visa-based check lands when the identity
 * module's Visa issuer surface is wired into the annotation queues
 * (sub-epic #215 + the Visa work under ADR-0003).
 */
export type AnnotationRole =
  | 'campaign-manager'
  | 'task-supervisor'
  | 'annotator'
  | 'reviewer'
  | 'arbitration-annotator'
  | 'expert-reviewer';

const ANN_ROLES_KEY = 'oci:requiredAnnotationRoles';

export const AnnotationRoles = (...roles: AnnotationRole[]) => SetMetadata(ANN_ROLES_KEY, roles);

@Injectable()
export class AnnotationRolesGuard implements CanActivate {
  private readonly reflector = new Reflector();

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AnnotationRole[] | undefined>(ANN_ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: CognitoAccessTokenPayload }>();
    const groups = (req.user?.['cognito:groups'] ?? []) as string[];

    // `admin` overrides every annotation role for operator convenience.
    const hasAny = required.some((r) => groups.includes(r) || groups.includes('admin'));
    if (!hasAny) {
      throw new ForbiddenException(`requires one of: ${required.join(', ')}`);
    }
    return true;
  }
}

import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { PrismaService } from '../../prisma.service.js';
import { CognitoAdminClient } from './cognito-admin.client.js';
import { IdentityAdminController } from './identity-admin.controller.js';
import { IdentityAdminRepository } from './identity-admin.repository.js';
import { IdentityAdminService } from './identity-admin.service.js';

/**
 * Identity-admin module (#241). Operator surface for Cognito user
 * management — list users, view detail + audit, grant / revoke groups.
 *
 * The long-term plan (ADR-0006 Decision 2) replaces the underlying
 * Cognito-group check with a GA4GH Passport Visa lifecycle; the UI
 * keeps its shape, the service swaps its backing store.
 */
@Module({
  imports: [AuthModule],
  controllers: [IdentityAdminController],
  providers: [
    PrismaService,
    RolesGuard,
    CognitoAdminClient,
    IdentityAdminRepository,
    IdentityAdminService,
  ],
  exports: [IdentityAdminService],
})
export class IdentityAdminModule {}

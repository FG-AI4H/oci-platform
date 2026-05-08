import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CertificationModule } from '../certification/certification.module.js';
import { AccessRequestController } from './access-request.controller.js';
import { AccessRequestRepository } from './access-request.repository.js';
import { AccessRequestService } from './access-request.service.js';

/**
 * Access requests for RESTRICTED datasets (PR F, #75).
 *
 * Imports CatalogModule for `CatalogService.findOwnerBySlug` — the
 * cross-module seam that keeps this module from reaching directly
 * into the catalog repository (orchestrator's anti-pattern guidance).
 *
 * Imports CertificationModule (#117 follow-up) so the identity-context
 * normalizer can query the caller's active-certification status to
 * lift the score to `QUIZ_PASSED`.
 */
@Module({
  imports: [AuthModule, CatalogModule, CertificationModule],
  controllers: [AccessRequestController],
  providers: [PrismaService, AccessRequestService, AccessRequestRepository],
  exports: [AccessRequestService],
})
export class AccessRequestModule {}

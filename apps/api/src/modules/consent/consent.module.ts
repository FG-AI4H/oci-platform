import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { ConsentController } from './consent.controller.js';
import { ConsentRepository } from './consent.repository.js';
import { ConsentService } from './consent.service.js';

/**
 * Dataset consent management (#224, ADR-0012 Decision 2 + 5).
 *
 * Owns `/v2/consent` (grant, revoke, per-dataset audit trail). Persists
 * in `catalog.consent_records`. Signed receipts via optional KMS (same
 * pattern as click-wrap #118). Exports `ConsentService` so the
 * annotation workflow can read the `isDatasetAnnotationConsented` gate
 * predicate (revoked consent halts dataset use).
 */
@Module({
  imports: [AuthModule],
  controllers: [ConsentController],
  providers: [PrismaService, ConsentService, ConsentRepository],
  exports: [ConsentService],
})
export class ConsentModule {}

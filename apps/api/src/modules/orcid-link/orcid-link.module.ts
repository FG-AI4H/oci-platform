import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { MyOrcidLinkController, OrcidLinkController } from './orcid-link.controller.js';
import { OrcidLinkRepository } from './orcid-link.repository.js';
import { OrcidLinkService } from './orcid-link.service.js';

/**
 * ORCID iD link (#125, ADR-0003 Phase 2).
 *
 * Owns: `GET /v2/identity/orcid/authorize`, `POST /v2/identity/orcid/callback`,
 * `GET /v2/me/orcid`, `DELETE /v2/me/orcid`.
 *
 * Exports `OrcidLinkService` so the access-request module can read
 * `hasActiveOrcidLink(user)` to lift the requester's identity score
 * to `ORCID_LINKED` (rank 2).
 */
@Module({
  imports: [AuthModule],
  controllers: [OrcidLinkController, MyOrcidLinkController],
  providers: [PrismaService, OrcidLinkService, OrcidLinkRepository],
  exports: [OrcidLinkService],
})
export class OrcidLinkModule {}

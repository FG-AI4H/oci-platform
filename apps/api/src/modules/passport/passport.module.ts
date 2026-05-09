import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { MyPassportController, PassportController } from './passport.controller.js';
import { PassportRepository } from './passport.repository.js';
import { PassportService } from './passport.service.js';

/**
 * GA4GH Passport relying party (#126, ADR-0003 Phase 2).
 *
 * Owns: `GET /v2/identity/passport/issuers`,
 * `POST /v2/identity/passport/visas`, `GET /v2/me/passport/visas`,
 * `DELETE /v2/me/passport/visas/:id`.
 *
 * Exports `PassportService` so the access-request module can read
 * `listActiveVisaTypesForUser(user)` to lift the requester's identity
 * score to `PASSPORT_VERIFIED` (rank 5) on a `ResearcherStatus` or
 * `AffiliationAndRole` visa per ADR-0003 Decision 3.
 */
@Module({
  imports: [AuthModule],
  controllers: [PassportController, MyPassportController],
  providers: [PrismaService, PassportService, PassportRepository],
  exports: [PassportService],
})
export class PassportModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { PassportIssuerModule } from '../passport-issuer/passport-issuer.module.js';
import { CertificationController, MyCertificationsController } from './certification.controller.js';
import { CertificationRepository } from './certification.repository.js';
import { CertificationService } from './certification.service.js';

/**
 * Certification quiz (#117, ADR-0003 Phase 1).
 *
 * Required to lift the requester identity score to QUIZ_PASSED, which
 * is the minimum for the CONTROLLED access tier (#115). The quiz bank
 * is hardcoded in `quiz-bank.ts`; bumping versions is a code change.
 *
 * Exports `CertificationService` so the access-request module's
 * identity-context normalizer can ask "does this user have an active
 * cert?" — wired in a future PR (see PR description).
 */
@Module({
  imports: [AuthModule, PassportIssuerModule],
  controllers: [CertificationController, MyCertificationsController],
  providers: [PrismaService, CertificationService, CertificationRepository],
  exports: [CertificationService],
})
export class CertificationModule {}

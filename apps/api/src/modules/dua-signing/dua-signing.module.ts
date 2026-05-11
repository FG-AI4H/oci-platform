import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { AccessRequestRepository } from '../access-request/access-request.repository.js';
import { DuaTemplateModule } from '../dua-template/dua-template.module.js';
import { PassportIssuerModule } from '../passport-issuer/passport-issuer.module.js';
import { DuaSigningController, MyDuaSignaturesController } from './dua-signing.controller.js';
import { DuaSigningRepository } from './dua-signing.repository.js';
import { DuaSigningService } from './dua-signing.service.js';

/**
 * AdES DUA signing (#128, ADR-0003 Decision 5).
 *
 * Owns `POST /v2/dua/sign-requests`, `POST /v2/dua/webhook/docuseal`,
 * `GET /v2/me/dua-signatures`, `GET /v2/me/dua-signatures/:id`.
 *
 * Depends on:
 *   - DuaTemplateModule — renders the DUA body to hash + sign.
 *   - PassportIssuerModule — mints AcceptedTermsAndPolicies visa on
 *     completion.
 *   - AccessRequestRepository — read AR shape for envelope context;
 *     re-uses the repo binding rather than importing the full AR
 *     module (which would create a cycle).
 */
@Module({
  imports: [AuthModule, DuaTemplateModule, PassportIssuerModule],
  controllers: [DuaSigningController, MyDuaSignaturesController],
  providers: [PrismaService, DuaSigningService, DuaSigningRepository, AccessRequestRepository],
  exports: [DuaSigningService],
})
export class DuaSigningModule {}

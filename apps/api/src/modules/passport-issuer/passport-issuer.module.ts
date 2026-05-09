import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { JwksController, MyIssuedVisasController } from './passport-issuer.controller.js';
import { PassportIssuerRepository } from './passport-issuer.repository.js';
import { PassportIssuerService } from './passport-issuer.service.js';
import { PassportKeyService } from './passport-key.service.js';

/**
 * OCI as GA4GH Passport issuer (#127, ADR-0003 Phase 2).
 *
 * Owns: `GET /.well-known/jwks.json`, `GET /v2/me/passport/issued`,
 * `GET /v2/me/passport/issued/:id/jwt`.
 *
 * Exports `PassportIssuerService` so other modules (certification,
 * policy-acceptance, access-request) can mint visas when their
 * domain events warrant assertion. Each consumer wires the auto-mint
 * call directly; this module doesn't subscribe to events.
 */
@Module({
  imports: [AuthModule],
  controllers: [JwksController, MyIssuedVisasController],
  providers: [PrismaService, PassportIssuerService, PassportIssuerRepository, PassportKeyService],
  exports: [PassportIssuerService],
})
export class PassportIssuerModule {}

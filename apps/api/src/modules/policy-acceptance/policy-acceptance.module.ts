import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { PassportIssuerModule } from '../passport-issuer/passport-issuer.module.js';
import {
  MyPolicyAcceptancesController,
  PolicyAcceptanceController,
} from './policy-acceptance.controller.js';
import { PolicyAcceptanceRepository } from './policy-acceptance.repository.js';
import { PolicyAcceptanceService } from './policy-acceptance.service.js';

/**
 * Click-wrap policy acceptance (#118, ADR-0003 Decision 4).
 *
 * Owns `POST /v2/identity/policy-acceptances` and
 * `GET /v2/me/policy-acceptances`. Persists in `identity.policy_acceptances`
 * keyed by the UUIDv5-derived user id. Optional KMS receipt signing
 * activated when `OCI_KMS_SIGNING_KEY_ARN` is set; otherwise the hash
 * alone (legally sufficient under SES) is the binding artifact.
 */
@Module({
  imports: [AuthModule, PassportIssuerModule],
  controllers: [PolicyAcceptanceController, MyPolicyAcceptancesController],
  providers: [PrismaService, PolicyAcceptanceService, PolicyAcceptanceRepository],
  exports: [PolicyAcceptanceService],
})
export class PolicyAcceptanceModule {}

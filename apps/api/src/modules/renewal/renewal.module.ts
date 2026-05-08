import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { AccessRequestRepository } from '../access-request/access-request.repository.js';
import { LogEmailNotifier } from './email-notifier.js';
import { EMAIL_NOTIFIER, RenewalService } from './renewal.service.js';
import { RenewalScheduler } from './renewal.scheduler.js';

/**
 * Renewal cron (#130, ADR-0003 Phase 2).
 *
 * Wires:
 *   - `RenewalService` — pure business logic; testable without BullMQ.
 *   - `RenewalScheduler` — BullMQ glue; env-gated so it can be off in
 *     local-dev / tests / Redis-less staging.
 *   - `LogEmailNotifier` — stub email surface; swap to a SES-backed
 *     notifier once the SES CDK construct lands (env-gated similarly).
 *
 * Re-uses `AccessRequestRepository` rather than reaching directly into
 * Prisma, so the renewal flow benefits from any future schema changes
 * (e.g. column renames, pre-update hooks) the access-request module
 * picks up.
 */
@Module({
  providers: [
    PrismaService,
    AccessRequestRepository,
    RenewalService,
    RenewalScheduler,
    {
      provide: EMAIL_NOTIFIER,
      useClass: LogEmailNotifier,
    },
  ],
  exports: [RenewalService, RenewalScheduler],
})
export class RenewalModule {}

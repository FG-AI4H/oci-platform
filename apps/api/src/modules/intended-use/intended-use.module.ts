import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { IntendedUseController } from './intended-use.controller.js';
import { IntendedUseService } from './intended-use.service.js';

/**
 * `IntendedUseModule` — owns the Intended-Use Statement vocabulary
 * (ADR-0013). Provides the validator + risk-tier derivation surfaces
 * that the future `prediction` module (Phase C) will consume on
 * model-card submission. Today's only consumer is the
 * regulator-facing `POST /v2/intended-use/derive-risk-tier`
 * endpoint — pure derivation, no persistence.
 *
 * The IUS attaches to AI submissions, never to datasets — see ADR-0013
 * amendment 2026-05-17. No repository / audit emitter is needed here;
 * the persistence + audit hooks land alongside `ModelCard` in Phase C.
 */
@Module({
  imports: [AuthModule],
  controllers: [IntendedUseController],
  providers: [IntendedUseService],
  exports: [IntendedUseService],
})
export class IntendedUseModule {}

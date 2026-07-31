import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { IntendedUseModule } from '../intended-use/intended-use.module.js';
import { PredictionController } from './prediction.controller.js';
import { PredictionRepository } from './prediction.repository.js';
import { PredictionService } from './prediction.service.js';

/**
 * Prediction module (#260, Phase C — ADR-0013 amended + ADR-0015).
 *
 * The AI-submission carrier: owns `ModelCard` (prediction schema), the
 * IUS-on-submission contract, `model_class` discrimination and semver
 * versioning. Imports `IntendedUseModule` to validate the embedded IUS;
 * `AUDIT_EMITTER` comes from the global `AuditModule`. Exports
 * `PredictionService` so the future `evaluation` module (#262) can
 * resolve the submissions it evaluates.
 */
@Module({
  imports: [AuthModule, IntendedUseModule],
  controllers: [PredictionController],
  providers: [PrismaService, PredictionService, PredictionRepository],
  exports: [PredictionService],
})
export class PredictionModule {}

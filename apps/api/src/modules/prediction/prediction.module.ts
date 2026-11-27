import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { EvaluationModule } from '../evaluation/evaluation.module.js';
import { IntendedUseModule } from '../intended-use/intended-use.module.js';
import { PredictionController, PredictionDatasetsController } from './prediction.controller.js';
import { PredictionRepository } from './prediction.repository.js';
import { PredictionService } from './prediction.service.js';

/**
 * Prediction module (#260, Phase C — ADR-0013 amended + ADR-0015).
 *
 * The AI-submission carrier: owns `ModelCard` (prediction schema), the
 * IUS-on-submission contract, `model_class` discrimination and semver
 * versioning. Imports `IntendedUseModule` to validate the embedded IUS, and
 * `EvaluationModule` for `ModelCardEvidenceService`, the read of the results
 * linked to a card that fills the Model Facts performance rows (#587). The
 * dependency runs one way: the evaluation module does not import this one.
 * `CatalogModule` gives `CatalogService.referenceFacts`: what a card may say
 * about the datasets it declares, by the catalogue's own visibility rule (#820).
 * `AUDIT_EMITTER` comes from the global `AuditModule`.
 */
@Module({
  imports: [AuthModule, IntendedUseModule, EvaluationModule, CatalogModule],
  controllers: [PredictionController, PredictionDatasetsController],
  providers: [PrismaService, PredictionService, PredictionRepository],
  exports: [PredictionService],
})
export class PredictionModule {}

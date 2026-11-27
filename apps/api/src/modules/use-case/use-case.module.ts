import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { EvaluationModule } from '../evaluation/evaluation.module.js';
import { PredictionModule } from '../prediction/prediction.module.js';
import { UseCaseController } from './use-case.controller.js';
import { UseCaseService } from './use-case.service.js';

/**
 * Use-case module (#829): reads the three catalogues (datasets, evaluation
 * tasks, models) through their own services and holds nothing itself. The
 * access matcher it applies is the pure function of the access-request
 * module, imported as a function, not re-implemented.
 */
@Module({
  imports: [AuthModule, CatalogModule, EvaluationModule, PredictionModule],
  controllers: [UseCaseController],
  providers: [UseCaseService],
})
export class UseCaseModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { PredictionModule } from '../prediction/prediction.module.js';
import { ToolsetController } from './toolset.controller.js';
import { ToolsetRepository } from './toolset.repository.js';
import { ToolsetService } from './toolset.service.js';

/**
 * Toolset module (ADR-0031, #830): a fourth catalogue, listed by reference.
 * Imports `CatalogModule` and `PredictionModule` to ask them which datasets
 * and model cards a caller may see; neither imports this module.
 * `AUDIT_EMITTER` comes from the global `AuditModule`.
 */
@Module({
  imports: [AuthModule, CatalogModule, PredictionModule],
  controllers: [ToolsetController],
  providers: [PrismaService, ToolsetService, ToolsetRepository],
})
export class ToolsetModule {}

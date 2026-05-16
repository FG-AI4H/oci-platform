import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { CampaignController } from './campaign.controller.js';
import { CampaignService } from './campaign.service.js';
import { CampaignRepository } from './campaign.repository.js';
import { AnnotationRolesGuard } from './roles.guard.js';
import { ToolIntegrationController } from './tool-integration.controller.js';

/**
 * Annotation module — Phase B.A.1 surface (Campaign CRUD + stub
 * AnnotationToolIntegration registry seeded in the migration).
 *
 * Future controllers landing in this module per ADR-0006…0012:
 *   - TaskController (sub-epic #215)
 *   - AnnotationController (sub-epic #215 + #218)
 *   - ToolIntegrationController (sub-epic #214 — replaces the seed stub)
 *   - SupervisorController (sub-epic #215 — rejection-review queue per ADR-0011)
 */
@Module({
  imports: [AuthModule],
  controllers: [CampaignController, ToolIntegrationController],
  providers: [PrismaService, CampaignService, CampaignRepository, AnnotationRolesGuard],
  exports: [CampaignService],
})
export class AnnotationModule {}

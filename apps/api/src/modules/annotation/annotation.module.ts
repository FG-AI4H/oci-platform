import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { CalibrationController } from './calibration.controller.js';
import { CalibrationRepository } from './calibration.repository.js';
import { CalibrationScheduler } from './calibration.scheduler.js';
import { CalibrationService } from './calibration.service.js';
import { CampaignController } from './campaign.controller.js';
import { CampaignService } from './campaign.service.js';
import { CampaignRepository } from './campaign.repository.js';
import { InstructionsController } from './instructions.controller.js';
import { InstructionsService } from './instructions.service.js';
import { MetadataVisibilityController } from './metadata-visibility.controller.js';
import { MetadataVisibilityService } from './metadata-visibility.service.js';
import { AnnotationRolesGuard } from './roles.guard.js';
import { TaskAbandonmentScheduler } from './task-abandonment.scheduler.js';
import { TaskAbandonmentService } from './task-abandonment.service.js';
import { TaskController } from './task.controller.js';
import { TaskRepository } from './task.repository.js';
import { TaskService } from './task.service.js';
import { ToolIntegrationController } from './tool-integration.controller.js';

/**
 * Annotation module — Phase B.A.1 + #215 slice 2 surface.
 *
 *   - Phase B.A.1: Campaign CRUD + stub AnnotationToolIntegration registry
 *   - #215 slice 1: Campaign lifecycle state machine (transitions)
 *   - #215 slice 2: Task seed + router (pull-next) + submit, gate state machine
 *
 * Future controllers landing in this module per ADR-0006…0012:
 *   - AnnotationController (sub-epic #215 slice 3 + #218 persistence outputs)
 *   - ToolIntegrationController (sub-epic #214 — replaces the seed stub)
 *   - SupervisorController (sub-epic #215 — rejection-review queue per ADR-0011)
 */
@Module({
  imports: [AuthModule],
  controllers: [
    CalibrationController,
    CampaignController,
    InstructionsController,
    MetadataVisibilityController,
    TaskController,
    ToolIntegrationController,
  ],
  providers: [
    PrismaService,
    CalibrationRepository,
    CalibrationScheduler,
    CalibrationService,
    CampaignService,
    CampaignRepository,
    InstructionsService,
    MetadataVisibilityService,
    TaskService,
    TaskRepository,
    TaskAbandonmentService,
    TaskAbandonmentScheduler,
    AnnotationRolesGuard,
  ],
  exports: [
    CalibrationService,
    CampaignService,
    InstructionsService,
    MetadataVisibilityService,
    TaskService,
    TaskAbandonmentService,
  ],
})
export class AnnotationModule {}

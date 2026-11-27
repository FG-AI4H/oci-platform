import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { PrismaService } from '../../prisma.service.js';
import { AnnotationModule } from '../annotation/annotation.module.js';
import { EvaluationModule } from '../evaluation/evaluation.module.js';
import { ReportingController } from './reporting.controller.js';
import { ReportingRepository } from './reporting.repository.js';
import { ReportingService } from './reporting.service.js';

/**
 * Reporting module (#828): the periodic activity report. Counts rows itself
 * and asks the evaluation, annotation and audit modules for what takes their
 * rules. Stores nothing. `AuditReaderService` comes from the global
 * `AuditModule`.
 */
@Module({
  imports: [AuthModule, EvaluationModule, AnnotationModule],
  controllers: [ReportingController],
  providers: [PrismaService, ReportingService, ReportingRepository, RolesGuard],
})
export class ReportingModule {}

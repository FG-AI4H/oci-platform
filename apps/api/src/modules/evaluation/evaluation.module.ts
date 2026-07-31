import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { EvaluationController } from './evaluation.controller.js';
import { EvaluationService } from './evaluation.service.js';
import { EvaluationRepository } from './evaluation.repository.js';

@Module({
  imports: [AuthModule],
  controllers: [EvaluationController],
  providers: [PrismaService, EvaluationService, EvaluationRepository, RolesGuard],
  exports: [EvaluationService],
})
export class EvaluationModule {}

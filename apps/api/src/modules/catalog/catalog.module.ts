import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { CatalogRepository } from './catalog.repository.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  imports: [AuthModule],
  controllers: [CatalogController],
  providers: [PrismaService, CatalogService, CatalogRepository, RolesGuard],
  exports: [CatalogService],
})
export class CatalogModule {}

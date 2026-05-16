import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { RemoteCatalogController } from './remote-catalog.controller.js';
import { RemoteCatalogRepository } from './remote-catalog.repository.js';
import { RemoteCatalogService } from './remote-catalog.service.js';

/**
 * Admin-only management of peer Croissant catalogues. The harvest
 * job lives in `apps/worker-ingest` (PR E.3); this module exposes the
 * HTTP surface for managing what the worker reads.
 *
 * Reuses `RolesGuard` from the catalog module — both modules gate on
 * `cognito:groups`, no need for two separate guards.
 */
@Module({
  imports: [AuthModule],
  controllers: [RemoteCatalogController],
  providers: [PrismaService, RemoteCatalogService, RemoteCatalogRepository, RolesGuard],
  exports: [RemoteCatalogService],
})
export class RemoteCatalogModule {}

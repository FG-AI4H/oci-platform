import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { PrismaService } from '../../prisma.service.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AccessRequestModule } from '../access-request/access-request.module.js';
import { S3ClientProvider } from './s3-client.js';
import { StorageController } from './storage.controller.js';
import { StorageService } from './storage.service.js';

/**
 * Self-hosted dataset distributions (PR I, #87): multipart S3 upload
 * + access-controlled download. Imports CatalogModule for the
 * `findOwnerBySlug` accessor and AccessRequestModule for the
 * approval check on the gated download path.
 */
@Module({
  imports: [AuthModule, CatalogModule, AccessRequestModule],
  controllers: [StorageController],
  providers: [PrismaService, S3ClientProvider, StorageService],
  exports: [StorageService],
})
export class StorageModule {}

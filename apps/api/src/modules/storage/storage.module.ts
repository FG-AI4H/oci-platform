import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { PrismaService } from '../../prisma.service.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AccessRequestModule } from '../access-request/access-request.module.js';
import { BulkDownloadService } from './bulk-download.service.js';
import { DicomIndexRepository } from './dicom-index.repository.js';
import { DicomIndexService } from './dicom-index.service.js';
import { DicomReviewController } from './dicom-review.controller.js';
import { DicomReviewRepository } from './dicom-review.repository.js';
import { DicomReviewService } from './dicom-review.service.js';
import { DicomSeriesController } from './dicom-series.controller.js';
import { DicomSeriesRepository } from './dicom-series.repository.js';
import { DicomSeriesService } from './dicom-series.service.js';
import { S3ClientProvider } from './s3-client.js';
import { StorageController } from './storage.controller.js';
import { StorageService } from './storage.service.js';

/**
 * Self-hosted dataset distributions (PR I, #87): multipart S3 upload
 * + access-controlled download. Imports CatalogModule for the
 * `findOwnerBySlug` accessor and AccessRequestModule for the
 * approval check on the gated download path.
 *
 * The whole-dataset ZIP route (`GET /v2/catalog/datasets/:slug/download`)
 * lives here rather than in CatalogModule: it needs both the S3 client
 * and `StorageService.authoriseDatasetBytes`, and CatalogModule
 * importing StorageModule would close a dependency cycle
 * (StorageModule → CatalogModule already).
 *
 * The DICOM series index is here too (ADR-0026): it is written when an
 * upload completes and read by `/v2/storage/...`, under the same gate
 * as a download.
 */
@Module({
  imports: [AuthModule, CatalogModule, AccessRequestModule],
  controllers: [StorageController, DicomSeriesController, DicomReviewController],
  providers: [
    PrismaService,
    S3ClientProvider,
    DicomIndexRepository,
    DicomIndexService,
    StorageService,
    BulkDownloadService,
    DicomSeriesRepository,
    DicomSeriesService,
    DicomReviewRepository,
    DicomReviewService,
    RolesGuard,
  ],
  // DicomSeriesService for the annotation module: a task on a DICOM
  // series reads its candidates and its sample through it (#646, #674).
  exports: [StorageService, BulkDownloadService, DicomSeriesService],
})
export class StorageModule {}

-- Self-hosted dataset uploads (Phase B, PR I, #87) — distributions can
-- now live in `oci-datasets-<env>` rather than only on upstream URLs.
-- The `search_vector` no-op drift Prisma keeps emitting on every
-- migration is stripped here as elsewhere; the column is a tsvector
-- GENERATED column declared `Unsupported` in schema.prisma.

-- CreateEnum
CREATE TYPE "catalog"."DistributionStorageBackend" AS ENUM ('EXTERNAL', 'S3', 'EXTERNAL_S3');

-- CreateEnum
CREATE TYPE "catalog"."DistributionUploadStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "catalog"."distributions" ADD COLUMN     "s3_bucket" TEXT,
ADD COLUMN     "s3_key" TEXT,
ADD COLUMN     "storage_backend" "catalog"."DistributionStorageBackend" NOT NULL DEFAULT 'EXTERNAL',
ADD COLUMN     "upload_status" "catalog"."DistributionUploadStatus";

-- CreateIndex
CREATE INDEX "distributions_storage_backend_upload_status_idx" ON "catalog"."distributions"("storage_backend", "upload_status");

-- Phase B PR A — catalog v1: Dataset / DatasetVersion / Distribution /
-- AccessRequest with enums for visibility / status / access-request status.
-- Drops the placeholder `catalog.datasets` (created by 20260505000000_init,
-- zero rows in any environment) and rebuilds with the full shape.

-- DropTable
DROP TABLE "catalog"."datasets";

-- CreateEnum
CREATE TYPE "catalog"."DatasetVisibility" AS ENUM ('PRIVATE', 'RESTRICTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "catalog"."DatasetStatus" AS ENUM ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "catalog"."AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'REVOKED');

-- CreateTable
CREATE TABLE "catalog"."datasets" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "host_id" UUID NOT NULL,
    "visibility" "catalog"."DatasetVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "catalog"."DatasetStatus" NOT NULL DEFAULT 'DRAFT',
    "conformance_version" TEXT,
    "croissant" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "datasets_slug_key" ON "catalog"."datasets"("slug");

-- CreateIndex
CREATE INDEX "datasets_visibility_status_idx" ON "catalog"."datasets"("visibility", "status");

-- CreateIndex
CREATE INDEX "datasets_host_id_idx" ON "catalog"."datasets"("host_id");

-- CreateTable
CREATE TABLE "catalog"."dataset_versions" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "croissant" JSONB NOT NULL,
    "croissant_hash" TEXT,
    "notes" TEXT,
    "published_by_id" UUID NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dataset_versions_dataset_id_version_key" ON "catalog"."dataset_versions"("dataset_id", "version");

-- CreateIndex
CREATE INDEX "dataset_versions_dataset_id_published_at_idx" ON "catalog"."dataset_versions"("dataset_id", "published_at");

-- CreateTable
CREATE TABLE "catalog"."distributions" (
    "id" UUID NOT NULL,
    "dataset_version_id" UUID NOT NULL,
    "croissant_id" TEXT NOT NULL,
    "content_url" TEXT,
    "content_type" TEXT NOT NULL,
    "content_size_bytes" BIGINT,
    "content_hash_sha256" TEXT,
    "requires_access" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "distributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "distributions_dataset_version_id_croissant_id_key" ON "catalog"."distributions"("dataset_version_id", "croissant_id");

-- CreateTable
CREATE TABLE "catalog"."access_requests" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "justification" TEXT NOT NULL,
    "status" "catalog"."AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMP(3),
    "decided_by_id" UUID,
    "decision_note" TEXT,
    "attestations" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_requests_dataset_id_status_idx" ON "catalog"."access_requests"("dataset_id", "status");

-- CreateIndex
CREATE INDEX "access_requests_requester_id_status_idx" ON "catalog"."access_requests"("requester_id", "status");

-- AddForeignKey
ALTER TABLE "catalog"."dataset_versions" ADD CONSTRAINT "dataset_versions_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "catalog"."datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."distributions" ADD CONSTRAINT "distributions_dataset_version_id_fkey" FOREIGN KEY ("dataset_version_id") REFERENCES "catalog"."dataset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."access_requests" ADD CONSTRAINT "access_requests_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "catalog"."datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

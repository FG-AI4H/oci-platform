-- Federation (Phase E down-payment, PR E.1) — admin-managed peer
-- catalog rows. The actual harvest job lands in PR E.3.
--
-- The unrelated `search_vector` drift Prisma initially included in
-- this migration was stripped — that column is a tsvector GENERATED
-- column declared as `Unsupported` in schema.prisma; Prisma can't
-- reconcile it and would otherwise emit no-op DEFAULT/INDEX changes
-- on every migrate.

-- CreateEnum
CREATE TYPE "catalog"."HarvestStatus" AS ENUM ('IDLE', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "catalog"."remote_catalogs" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpoint_url" TEXT NOT NULL,
    "description" TEXT,
    "harvest_status" "catalog"."HarvestStatus" NOT NULL DEFAULT 'IDLE',
    "last_harvested_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remote_catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "remote_catalogs_slug_key" ON "catalog"."remote_catalogs"("slug");

-- CreateIndex
CREATE INDEX "remote_catalogs_harvest_status_idx" ON "catalog"."remote_catalogs"("harvest_status");

-- Federation read-path (Phase E down-payment, PR E.2) — mirrors of
-- datasets harvested from peer catalogues. The harvest worker that
-- populates rows in this table lands in PR E.3.
--
-- The unrelated `search_vector` drift Prisma initially emitted has
-- been stripped (it's a tsvector GENERATED column declared as
-- `Unsupported` in schema.prisma; Prisma can't reconcile it).

-- CreateTable
CREATE TABLE "catalog"."remote_datasets" (
    "id" UUID NOT NULL,
    "source_catalog_id" UUID NOT NULL,
    "origin_url" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "conformance_version" TEXT,
    "version" TEXT,
    "croissant" JSONB NOT NULL,
    "harvested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remote_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "remote_datasets_source_catalog_id_harvested_at_idx" ON "catalog"."remote_datasets"("source_catalog_id", "harvested_at");

-- CreateIndex
CREATE UNIQUE INDEX "remote_datasets_source_catalog_id_origin_url_key" ON "catalog"."remote_datasets"("source_catalog_id", "origin_url");

-- AddForeignKey
ALTER TABLE "catalog"."remote_datasets" ADD CONSTRAINT "remote_datasets_source_catalog_id_fkey" FOREIGN KEY ("source_catalog_id") REFERENCES "catalog"."remote_catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

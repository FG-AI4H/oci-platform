-- Toolsets, a fourth catalogue listed by reference (ADR-0031, #830).
--
-- WHY. The platform lists datasets, models and evaluation tasks. It had no
-- way to list a notebook, a simulator or a library that works with them, so
-- such a link lived in free text where nobody finds it and nothing links
-- back.
--
-- ADDITIVE ONLY: two enums, one table, five indexes. No existing table is
-- altered and no row is backfilled.
--
--   1. `ToolsetKind`, `ToolsetStatus`.
--
--   2. `catalog.toolsets`: a description and a web address. The platform
--      hosts no code and executes nothing. `dataset_slugs` and
--      `model_card_slugs` are soft references with no foreign key, like
--      `evaluation.evaluation_tasks.dataset_slug`: a toolset survives a
--      dataset or a model being retired.
--
--   3. Indexes: the public list (status, most recently changed first), the
--      declarer's own list, and a GIN index on each array for "which toolsets
--      work with this dataset" and "with this model".

-- CreateEnum
CREATE TYPE "catalog"."ToolsetKind" AS ENUM ('NOTEBOOK', 'SIMULATOR', 'LIBRARY', 'PIPELINE', 'OTHER');

-- CreateEnum
CREATE TYPE "catalog"."ToolsetStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "catalog"."toolsets" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "catalog"."ToolsetKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "licence" TEXT,
    "version" TEXT,
    "maintainer" TEXT NOT NULL,
    "contact" TEXT,
    "dataset_slugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model_card_slugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "catalog"."ToolsetStatus" NOT NULL DEFAULT 'DRAFT',
    "submitter_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "toolsets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "toolsets_slug_key" ON "catalog"."toolsets"("slug");

-- CreateIndex
CREATE INDEX "toolsets_status_updated_at_idx" ON "catalog"."toolsets"("status", "updated_at");

-- CreateIndex
CREATE INDEX "toolsets_submitter_user_id_idx" ON "catalog"."toolsets"("submitter_user_id");

-- CreateIndex
CREATE INDEX "toolsets_dataset_slugs_idx" ON "catalog"."toolsets" USING GIN ("dataset_slugs");

-- CreateIndex
CREATE INDEX "toolsets_model_card_slugs_idx" ON "catalog"."toolsets" USING GIN ("model_card_slugs");

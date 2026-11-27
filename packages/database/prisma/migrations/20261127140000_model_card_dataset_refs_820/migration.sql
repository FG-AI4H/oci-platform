-- Datasets declared on a model card (#820).
--
-- WHY. A model card said in which countries its training data was collected
-- and held a free-text lineage note that is not published. It could not name
-- the datasets the model was trained and evaluated on, so a reader could not
-- go from a model to its data, nor from a dataset to the models that use it.
--
-- ADDITIVE ONLY: one enum, one table, two indexes, one foreign key. No
-- existing table is altered and no row is backfilled: which datasets an
-- existing card used was never recorded.
--
--   1. `ModelCardDatasetRole`: the part the dataset played.
--
--   2. `model_card_dataset_refs`: one row per declared dataset. Exactly one
--      target per row, by a CHECK constraint: a dataset of this catalogue
--      (`dataset_slug`, a soft reference with no foreign key, like
--      `evaluation.tasks.dataset_slug`, so a card survives the dataset being
--      retired) or one held elsewhere (`external_url` with `external_name`).
--
--   3. The foreign key to the card, ON DELETE CASCADE: a reference is part of
--      the card's content, replaced as a whole when the card is edited. It is
--      not evidence about the card, unlike a linked submission (#587).
--
--   4. Indexes: by card in display order, and by dataset slug for the dataset
--      page ("models that declare this dataset").

-- CreateEnum
CREATE TYPE "prediction"."ModelCardDatasetRole" AS ENUM ('TRAINING', 'TUNING', 'VALIDATION', 'EVALUATION');

-- CreateTable
CREATE TABLE "prediction"."model_card_dataset_refs" (
    "id" UUID NOT NULL,
    "model_card_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "role" "prediction"."ModelCardDatasetRole" NOT NULL,
    "dataset_slug" TEXT,
    "manifest_version" TEXT,
    "manifest_sha256" TEXT,
    "external_url" TEXT,
    "external_name" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_card_dataset_refs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "model_card_dataset_refs_one_target" CHECK (
        ("dataset_slug" IS NOT NULL AND "external_url" IS NULL AND "external_name" IS NULL)
        OR ("dataset_slug" IS NULL AND "external_url" IS NOT NULL AND "external_name" IS NOT NULL)
    )
);

-- CreateIndex
CREATE INDEX "model_card_dataset_refs_model_card_id_position_idx" ON "prediction"."model_card_dataset_refs"("model_card_id", "position");

-- CreateIndex
CREATE INDEX "model_card_dataset_refs_dataset_slug_idx" ON "prediction"."model_card_dataset_refs"("dataset_slug");

-- AddForeignKey
ALTER TABLE "prediction"."model_card_dataset_refs" ADD CONSTRAINT "model_card_dataset_refs_model_card_id_fkey" FOREIGN KEY ("model_card_id") REFERENCES "prediction"."model_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

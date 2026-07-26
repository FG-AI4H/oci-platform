-- Prediction module — Model Card, the AI-submission carrier (#260, ADR-0013 amended + ADR-0015).
--
-- The Intended-Use Statement attaches HERE, on the model submission — never on
-- a dataset (ADR-0013 amendment 2026-05-17). A model card is a semver-versioned
-- submission; `parent_model_card_id` self-links a new version to the one it
-- supersedes (ON DELETE RESTRICT). The `prediction` schema already exists
-- (created by the initial multi-schema migration). Additive: no existing table
-- is touched.

-- CreateTable
CREATE TABLE "prediction"."model_cards" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "submitter_user_id" UUID,
    "intended_use" JSONB NOT NULL,
    "model_class" VARCHAR(64) NOT NULL,
    "architecture_summary" TEXT NOT NULL,
    "training_data_lineage" JSONB NOT NULL DEFAULT '{}',
    "parent_model_card_id" UUID,
    "version_major_minor_patch" VARCHAR(32) NOT NULL,
    "change_justification" TEXT,
    "material_change" BOOLEAN NOT NULL DEFAULT false,
    "training_data_jurisdictions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "generative_ai" BOOLEAN NOT NULL DEFAULT false,
    "lmm_specific_limitations" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "model_cards_slug_key" ON "prediction"."model_cards"("slug");

-- AddForeignKey
ALTER TABLE "prediction"."model_cards" ADD CONSTRAINT "model_cards_parent_model_card_id_fkey" FOREIGN KEY ("parent_model_card_id") REFERENCES "prediction"."model_cards"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

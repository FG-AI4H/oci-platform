-- ModelCard gap fields (#432, ADR-0019 Decision 3).
--
-- Additive only: one new enum + nine nullable/defaulted columns on an existing
-- table. No data migration — `status` defaults to DRAFT for any existing row,
-- and the developer-identity columns are nullable at the DB level (the create
-- request requires them, so new submissions always carry them).

-- CreateEnum
CREATE TYPE "prediction"."ModelCardStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PUBLISHED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "prediction"."model_cards"
    ADD COLUMN "status" "prediction"."ModelCardStatus" NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN "model_developer" TEXT,
    ADD COLUMN "developer_contact" TEXT,
    ADD COLUMN "clinical_summary" TEXT,
    ADD COLUMN "regulatory_approval" JSONB,
    ADD COLUMN "known_biases_or_ethical_considerations" TEXT,
    ADD COLUMN "bias_mitigation_approaches" TEXT,
    ADD COLUMN "ongoing_maintenance" TEXT,
    ADD COLUMN "security_posture" TEXT;

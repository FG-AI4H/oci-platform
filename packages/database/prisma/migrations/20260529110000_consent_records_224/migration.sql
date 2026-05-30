-- Consent records for annotation datasets (#224, ADR-0012 Decision 2 + 5).
--
-- Grant + revocation are signed-receipt events (KMS-CMK, same pattern as
-- click-wrap #118). A REVOKED consent halts the dataset's use in active
-- campaigns via the ConsentService gate predicate. Soft FK to
-- catalog.datasets.id (no hard FK — cross-schema soft-FK convention).
-- Additive: no existing table touched.

-- CreateEnum
CREATE TYPE "catalog"."ConsentType" AS ENUM ('ANNOTATION_USE', 'REDISTRIBUTION', 'SENSITIVE_FACETS');

-- CreateEnum
CREATE TYPE "catalog"."ConsentStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "catalog"."consent_records" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "consenter_sub" TEXT NOT NULL,
    "consenter_user_id" UUID,
    "consent_type" "catalog"."ConsentType" NOT NULL,
    "status" "catalog"."ConsentStatus" NOT NULL DEFAULT 'ACTIVE',
    "scope" JSONB NOT NULL,
    "disclosure_text" TEXT NOT NULL,
    "text_sha256" CHAR(64) NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMP(3),
    "signed_receipt_arn" TEXT,
    "receipt_signature" TEXT,
    "receipt_key_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revocation_reason" TEXT,
    "revocation_signature" TEXT,
    "revocation_key_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_records_dataset_id_status_idx"
    ON "catalog"."consent_records" ("dataset_id", "status");
CREATE INDEX "consent_records_dataset_id_consent_type_status_idx"
    ON "catalog"."consent_records" ("dataset_id", "consent_type", "status");

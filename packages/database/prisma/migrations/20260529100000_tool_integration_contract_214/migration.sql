-- Annotation tool-integration contract + registry (#214, ADR-0007).
--
-- Extends the stub `annotation_tool_integrations` registry with the
-- ADR-0007 capability matrix + auth/launch posture, adds the versioned
-- adapter contract (`annotation_tool_integration_versions`), the
-- callback idempotency/audit table (`annotation_tool_callback_receipts`),
-- and pins campaigns to a tool version (`tool_version_id`, immutable once
-- RUNNING — enforced in the service).
--
-- All columns are additive with safe defaults; existing rows backfill to
-- empty capability arrays, RFC8693/REDIRECT posture, and a null pinned
-- version (legacy campaigns resolve the current version at handoff).

-- CreateEnum
CREATE TYPE "annotation"."AnnotationToolAuthMode" AS ENUM ('RFC8693', 'API_KEY', 'IFRAME_POSTMESSAGE');

-- CreateEnum
CREATE TYPE "annotation"."AnnotationToolLaunchMode" AS ENUM ('REDIRECT', 'IFRAME', 'POPUP', 'DESKTOP_HANDOFF');

-- AlterTable: capability matrix + auth/launch posture (ADR-0007)
ALTER TABLE "annotation"."annotation_tool_integrations"
    ADD COLUMN "homepage_url" TEXT,
    ADD COLUMN "modalities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "annotation_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "supports_pre_annotation" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "supports_active_learning" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "auth_mode" "annotation"."AnnotationToolAuthMode" NOT NULL DEFAULT 'RFC8693',
    ADD COLUMN "launch_mode" "annotation"."AnnotationToolLaunchMode" NOT NULL DEFAULT 'REDIRECT';

-- AlterTable: pin campaigns to a tool version (immutable once RUNNING)
ALTER TABLE "annotation"."annotation_campaigns"
    ADD COLUMN "tool_version_id" UUID;

-- CreateTable: versioned adapter contract
CREATE TABLE "annotation"."annotation_tool_integration_versions" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "schema_profile" TEXT NOT NULL,
    "launch_url_template" TEXT NOT NULL,
    "callback_url_path" TEXT NOT NULL,
    "output_formats" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "release_notes" TEXT,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annotation_tool_integration_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: callback idempotency + audit
CREATE TABLE "annotation"."annotation_tool_callback_receipts" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "integration_id" UUID NOT NULL,
    "version_id" UUID,
    "payload_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annotation_tool_callback_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "annotation_tool_integration_versions_integration_id_version_key"
    ON "annotation"."annotation_tool_integration_versions" ("integration_id", "version");
CREATE INDEX "annotation_tool_integration_versions_integration_id_is_current_idx"
    ON "annotation"."annotation_tool_integration_versions" ("integration_id", "is_current");
CREATE UNIQUE INDEX "annotation_tool_callback_receipts_integration_id_idempotency_key"
    ON "annotation"."annotation_tool_callback_receipts" ("integration_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "annotation"."annotation_tool_integration_versions"
    ADD CONSTRAINT "annotation_tool_integration_versions_integration_id_fkey"
    FOREIGN KEY ("integration_id") REFERENCES "annotation"."annotation_tool_integrations" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "annotation"."annotation_tool_callback_receipts"
    ADD CONSTRAINT "annotation_tool_callback_receipts_integration_id_fkey"
    FOREIGN KEY ("integration_id") REFERENCES "annotation"."annotation_tool_integrations" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "annotation"."annotation_campaigns"
    ADD CONSTRAINT "annotation_campaigns_tool_version_id_fkey"
    FOREIGN KEY ("tool_version_id") REFERENCES "annotation"."annotation_tool_integration_versions" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

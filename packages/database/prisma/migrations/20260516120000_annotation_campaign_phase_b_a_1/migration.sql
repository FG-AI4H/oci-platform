-- Annotation module Phase B.A.1 — Campaign entity + stub
-- AnnotationToolIntegration registry (ADR-0006 / 0007 / 0012,
-- sub-epics #213 + #214-stub + #215-DRAFT + #235).
--
-- Lands the foundation for the 3-gate SOP workflow. Phase B.A.2 adds
-- Task / TaskAssignment / Annotation; Phase B.A.3 adds the audit event
-- log. Hard FK to catalog.datasets lands when manifest-version pinning
-- ships in B.A.2 (currently a soft FK).

CREATE SCHEMA IF NOT EXISTS "annotation";

-- ----------------------------------------------------------------------------
-- AnnotationToolIntegration — stub registry per ADR-0007.
-- Sub-epic #214 will replace this minimal shape with the full typed
-- capability matrix + versioned schemaProfile.
-- ----------------------------------------------------------------------------

CREATE TABLE "annotation"."annotation_tool_integrations" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "slug"       TEXT         NOT NULL,
    "name"       TEXT         NOT NULL,
    "vendor"     TEXT         NOT NULL,
    "version"    TEXT         NOT NULL,
    "is_active"  BOOLEAN      NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "annotation_tool_integrations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "annotation_tool_integrations_slug_key" UNIQUE ("slug")
);

-- Seed two stub rows so the campaign-create form has options to pick
-- (full registry per #214 / ADR-0007 lands as a separate sub-epic).
INSERT INTO "annotation"."annotation_tool_integrations"
    ("id", "slug", "name", "vendor", "version", "updated_at")
VALUES
    (gen_random_uuid(), 'monai-label',  'MONAI Label',  'NVIDIA / MONAI Consortium', '0.8.0', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'ohif-viewer',  'OHIF Viewer',  'OHIF Consortium',            '3.9.0', CURRENT_TIMESTAMP);

-- ----------------------------------------------------------------------------
-- AnnotationCampaign — the orchestration unit for the 3-gate SOP
-- (ADR-0006). Phase B.A.1 only writes DRAFT status; the state machine
-- per ADR-0006 + ADR-0011 lands with sub-epic #215.
-- ----------------------------------------------------------------------------

CREATE TYPE "annotation"."CampaignStatus" AS ENUM (
    'DRAFT',
    'READY',
    'RUNNING',
    'COMPLETED',
    'ARCHIVED'
);

CREATE TYPE "annotation"."CampaignTaskKind" AS ENUM (
    'CLASSIFICATION',
    'DETECTION',
    'SEGMENTATION',
    'LOCALIZATION',
    'MULTI_MODAL'
);

-- SPDX identifiers per ADR-0012 Decision 3. CUSTOM_RESTRICTED maps
-- to the SPDX-equivalent 'custom-restricted' marker via Prisma's
-- @map; downstream consumers read the SPDX form.
CREATE TYPE "annotation"."CampaignOutputLicense" AS ENUM (
    'CC-BY-4.0',
    'CC-BY-NC-4.0',
    'CC-BY-SA-4.0',
    'CC0-1.0',
    'custom-restricted'
);

CREATE TABLE "annotation"."annotation_campaigns" (
    "id"                  UUID                              NOT NULL DEFAULT gen_random_uuid(),
    "slug"                TEXT                              NOT NULL,
    "name"                TEXT                              NOT NULL,
    "description"         TEXT,
    "status"              "annotation"."CampaignStatus"     NOT NULL DEFAULT 'DRAFT',
    "task_kind"           "annotation"."CampaignTaskKind"   NOT NULL,
    "dataset_id"          UUID                              NOT NULL,
    "tool_integration_id" UUID                              NOT NULL,
    "output_license"      "annotation"."CampaignOutputLicense" NOT NULL,
    "workflow_config"     JSONB                             NOT NULL,
    "created_by_id"       UUID                              NOT NULL,
    "created_at"          TIMESTAMP(3)                      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3)                      NOT NULL,
    "completed_at"        TIMESTAMP(3),

    CONSTRAINT "annotation_campaigns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "annotation_campaigns_slug_key" UNIQUE ("slug"),

    CONSTRAINT "annotation_campaigns_tool_integration_fk"
        FOREIGN KEY ("tool_integration_id")
        REFERENCES "annotation"."annotation_tool_integrations" ("id")
        ON DELETE RESTRICT
);

CREATE INDEX "annotation_campaigns_status_idx"        ON "annotation"."annotation_campaigns" ("status");
CREATE INDEX "annotation_campaigns_dataset_id_idx"    ON "annotation"."annotation_campaigns" ("dataset_id");
CREATE INDEX "annotation_campaigns_created_by_id_idx" ON "annotation"."annotation_campaigns" ("created_by_id");

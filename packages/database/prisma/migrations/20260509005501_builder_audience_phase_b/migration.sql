-- Builder-vs-researcher audience (Phase B · DAP, #120, ADR-0003
-- Decision 8) — `AccessRequest` gains an `audience` enum + a
-- `builder_context` JSONB payload populated only for BUILDER rows.
--
-- Backfill: existing rows are derived from `attestations.intendedUseCategory`.
-- `COMMERCIAL_RESEARCH` and `CLINICAL_CARE` go to BUILDER (product /
-- deployment intent); everything else goes to RESEARCHER (publication
-- intent).

-- CreateEnum
CREATE TYPE "catalog"."AccessRequestAudience" AS ENUM ('RESEARCHER', 'BUILDER');

-- AlterTable
ALTER TABLE "catalog"."access_requests"
ADD COLUMN "audience"        "catalog"."AccessRequestAudience" NOT NULL DEFAULT 'RESEARCHER',
ADD COLUMN "builder_context" JSONB;

-- Backfill audience from existing intended-use category. We read the
-- value out of the v1 attestations JSON (PR J.1's shape).
UPDATE "catalog"."access_requests"
SET "audience" = 'BUILDER'
WHERE attestations->>'intendedUseCategory' IN ('COMMERCIAL_RESEARCH', 'CLINICAL_CARE');

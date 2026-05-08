-- Tiered access model (Phase B · DAP, #115, ADR-0003 Decisions 1-2).
--
-- Adds `Dataset.accessTier` decoupled from `visibility`, and extends
-- `AccessRequest` with the identity-assurance machinery the DUO matcher
-- now consumes:
--   - requester_identity_score (computed at create time)
--   - idu_statement (replaces `justification`; backfilled below)
--   - ai_tool_disclosure (populated by #120; null on existing rows)
--   - signing_official_email (populated by countersign flow; null today)
--   - pledge_accepted_at (populated by #118 click-wrap; null today)
--
-- All additions are nullable or have a NOT NULL DEFAULT so the migration
-- is fully additive — legacy rows stay valid, the API contract for
-- existing callers is unchanged, and a rollback is just a column drop.

-- ==== Enums ===============================================================

-- CreateEnum
CREATE TYPE "catalog"."AccessTier" AS ENUM ('OPEN', 'REGISTERED', 'CONTROLLED', 'SENSITIVE');

-- CreateEnum
CREATE TYPE "catalog"."RequesterIdentityScore" AS ENUM (
  'EMAIL_ONLY',
  'EMAIL_DOMAIN_VERIFIED',
  'ORCID_LINKED',
  'QUIZ_PASSED',
  'PI_COUNTERSIGNED',
  'PASSPORT_VERIFIED'
);

-- ==== Dataset.accessTier =================================================

-- AlterTable
ALTER TABLE "catalog"."datasets"
ADD COLUMN "access_tier" "catalog"."AccessTier" NOT NULL DEFAULT 'OPEN';

-- ==== AccessRequest extensions ===========================================

-- AlterTable
ALTER TABLE "catalog"."access_requests"
ADD COLUMN "requester_identity_score" "catalog"."RequesterIdentityScore" NOT NULL DEFAULT 'EMAIL_ONLY',
ADD COLUMN "idu_statement"           TEXT,
ADD COLUMN "ai_tool_disclosure"      JSONB,
ADD COLUMN "signing_official_email"  TEXT,
ADD COLUMN "pledge_accepted_at"      TIMESTAMP(3);

-- Backfill: populate `idu_statement` from the existing `justification`
-- so consumers reading the new field immediately see content for
-- legacy rows. `justification` stays NOT NULL during the transition;
-- a follow-up PR will deprecate / drop it once all readers migrate.
UPDATE "catalog"."access_requests"
SET "idu_statement" = "justification"
WHERE "idu_statement" IS NULL;

-- Index supporting host-inbox queries that filter by tier of the parent
-- dataset + sort by score (e.g. "show me CONTROLLED-tier requests where
-- the requester is below QUIZ_PASSED"). Cheap to add now, expensive to
-- add later when access_requests grows.
CREATE INDEX "access_requests_dataset_id_requester_score_idx"
  ON "catalog"."access_requests" ("dataset_id", "requester_identity_score");

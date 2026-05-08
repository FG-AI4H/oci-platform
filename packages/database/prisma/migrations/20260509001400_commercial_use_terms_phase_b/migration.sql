-- Commercial-use terms (Phase B · DAP, #119, ADR-0003 Decision 9).
--
-- Adds `Dataset.commercialUseTerms` + `Dataset.commercialClauses` so
-- the matcher has a single source of truth for the commercial-use
-- decision (instead of inferring from DUO_0000046 / NCU). The catalog
-- list also gains a "Commercial use" filter on this column.
--
-- Backfill: existing rows that already declare DUO_0000046 (NCU) get
-- `NON_COMMERCIAL_ONLY` so the matcher's verdict stays consistent
-- post-migration. Rows without NCU keep the conservative
-- `CASE_BY_CASE` default until the host explicitly opts up.

-- CreateEnum
CREATE TYPE "catalog"."CommercialUseTerms" AS ENUM ('OK', 'NON_COMMERCIAL_ONLY', 'CASE_BY_CASE');

-- AlterTable
ALTER TABLE "catalog"."datasets"
ADD COLUMN "commercial_use_terms" "catalog"."CommercialUseTerms" NOT NULL DEFAULT 'CASE_BY_CASE',
ADD COLUMN "commercial_clauses"   TEXT;

-- Backfill from NCU presence. `duo_terms` is a TEXT[]; ANY(...) checks
-- membership of the literal id in the array.
UPDATE "catalog"."datasets"
SET "commercial_use_terms" = 'NON_COMMERCIAL_ONLY'
WHERE 'DUO_0000046' = ANY ("duo_terms");

-- Index supports the catalog "Commercial use" facet filter so
-- `WHERE commercial_use_terms = 'OK'` doesn't sequentially scan.
CREATE INDEX "datasets_commercial_use_terms_idx"
  ON "catalog"."datasets" ("commercial_use_terms");

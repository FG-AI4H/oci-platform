-- Access requests with DUO matching (Phase B, PR J.1, #93) — auto-match
-- the requester's intended use against the dataset's DUO permission
-- terms. The `match_status` enum drives the host-inbox badge; the
-- `duo_terms` column on `datasets` denormalises the manifest's
-- `consentCode` for fast read on the detail page + matcher input.

-- CreateEnum
CREATE TYPE "catalog"."AccessRequestMatchStatus" AS ENUM ('MATCHED', 'CONFLICT', 'UNCLEAR');

-- AlterTable
ALTER TABLE "catalog"."datasets" ADD COLUMN "duo_terms" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "catalog"."access_requests" ADD COLUMN     "match_status" "catalog"."AccessRequestMatchStatus",
ADD COLUMN     "match_explanations" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "access_requests_dataset_id_status_match_status_idx" ON "catalog"."access_requests"("dataset_id", "status", "match_status");

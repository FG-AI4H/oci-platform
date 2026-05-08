-- Access-request renewal lifecycle (Phase B · DAP, #130, ADR-0003 Phase 2).
-- Adds `expires_at` + `expiry_notice_sent_at` to `access_requests` so a
-- daily BullMQ cron can:
--   1. Email the requester 30 days pre-expiry (de-duped via `expiry_notice_sent_at`).
--   2. Auto-revoke APPROVED rows whose `expires_at` has passed.
--
-- Backfill: existing APPROVED rows get `expires_at = decided_at + interval '1 year'`
-- so the cron's first run treats already-granted access correctly. The
-- 1-year window mirrors Synapse's default and ADR-0003 Phase 2 spec.

-- AlterTable
ALTER TABLE "catalog"."access_requests"
ADD COLUMN "expires_at"            TIMESTAMP(3),
ADD COLUMN "expiry_notice_sent_at" TIMESTAMP(3);

-- Backfill expires_at for APPROVED rows from existing decided_at.
UPDATE "catalog"."access_requests"
SET "expires_at" = "decided_at" + interval '1 year'
WHERE "status" = 'APPROVED' AND "decided_at" IS NOT NULL;

-- Index for the renewal cron's primary read paths:
--   * "approaching expiry" — WHERE status='APPROVED' AND expires_at BETWEEN now AND now+30d
--   * "expired" —             WHERE status='APPROVED' AND expires_at < now
CREATE INDEX "access_requests_status_expires_at_idx"
    ON "catalog"."access_requests" ("status", "expires_at");

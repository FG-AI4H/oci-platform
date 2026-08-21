-- EvalAI seam reconciliation state (WP4, #408, evalai-integration §4).
--
-- Additive, all nullable or defaulted. These columns exist so that a result
-- which is persisted in the OCI but not yet acknowledged by EvalAI is a
-- RECOVERABLE state rather than a lost one: persist first, publish second.
ALTER TABLE "evaluation"."submissions"
    ADD COLUMN "external_submission_id" TEXT,
    ADD COLUMN "external_challenge_id" TEXT,
    ADD COLUMN "result_published_at" TIMESTAMP(3),
    ADD COLUMN "result_publish_attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "result_publish_error" TEXT;

-- The reconciliation sweep asks: which seam-originated submissions are terminal
-- but unacknowledged? Partial index so it stays cheap as the table grows.
CREATE INDEX "submissions_owed_writeback_idx"
    ON "evaluation"."submissions"("result_received_at")
    WHERE "external_submission_id" IS NOT NULL AND "result_published_at" IS NULL;

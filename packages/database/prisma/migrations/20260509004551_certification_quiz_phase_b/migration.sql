-- Certification quiz (Phase B · DAP, #117, ADR-0003 Phase 1) — required
-- to reach the CONTROLLED access tier (#115). One row per attempt;
-- "active certification" is the most recent passed attempt within
-- `OCI_QUIZ_VALIDITY_DAYS` (default 365).
--
-- Greenfield table; no backfill. The identity-context normalizer
-- (`apps/api/src/modules/access-request/identity-context.ts`) will
-- query this table to lift the requester score to QUIZ_PASSED when an
-- active row exists.

-- CreateTable
CREATE TABLE "identity"."quiz_attempts" (
    "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"             UUID         NOT NULL,
    "certification_type"  TEXT         NOT NULL,
    "started_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at"        TIMESTAMP(3),
    "score"               INTEGER,
    "passed"              BOOLEAN,
    "answers"             JSONB,

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- Index supporting the "active certification?" lookup:
-- WHERE user_id = $1 AND certification_type = $2 AND passed = true
-- ORDER BY submitted_at DESC LIMIT 1.
CREATE INDEX "quiz_attempts_user_id_certification_type_submitted_at_idx"
    ON "identity"."quiz_attempts"
    ("user_id", "certification_type", "submitted_at" DESC);

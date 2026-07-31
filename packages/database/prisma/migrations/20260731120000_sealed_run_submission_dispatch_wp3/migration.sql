-- Sealed execution (Mode 2 / CONTAINER) dispatch + result outbox — WP3 of the
-- GI-AI4H benchmarking-challenge plan (ADR-0017, ADR-0018).
--
-- ADDITIVE ONLY. Every column below is nullable with no default, so the
-- statement is a metadata-only catalog update on PostgreSQL (no table
-- rewrite, no lock beyond ACCESS EXCLUSIVE for the duration of the DDL) and
-- existing Mode 1 (PREDICTIONS) rows keep NULL for all of them. No enum
-- value, column or constraint is altered or dropped.
--
-- What they carry:
--   image_ref / image_digest  the digest-pinned participant image the run was
--                             dispatched with (tags are refused at the API
--                             boundary — a tag can be repointed after review)
--   route_id / route_version  the route + version that produced the score
--                             (ADR-0018). Stays NULL until the
--                             `EvaluationRoute` registry lands (WP5); the
--                             outbox only enforces a routeVersion match when
--                             route_version is NON-null.
--   duration_ms               wall-clock run duration reported by the worker
--   failure_code              classified failure taxonomy member
--                             (SealedRunFailureCodeSchema in
--                             @oci/shared-types). Text, not a PostgreSQL
--                             enum, so a new execution mode can extend the
--                             taxonomy without a migration.
--   result_fingerprint        idempotency key for
--                             POST /v2/submissions/:id/result — sha256 over
--                             the outcome-determining content of the applied
--                             result. A replay matching it is a 200 no-op; a
--                             different result for a terminal submission is a
--                             409.
--   result_received_at        when the outbox applied a result
--
-- Ground truth is untouched: it stays in evaluation_tasks.ground_truth and is
-- never dispatched to the worker, never serialised to a DTO, never logged.

-- AlterTable
ALTER TABLE "evaluation"."submissions"
    ADD COLUMN "image_ref" TEXT,
    ADD COLUMN "image_digest" TEXT,
    ADD COLUMN "route_id" UUID,
    ADD COLUMN "route_version" TEXT,
    ADD COLUMN "duration_ms" INTEGER,
    ADD COLUMN "failure_code" TEXT,
    ADD COLUMN "result_fingerprint" TEXT,
    ADD COLUMN "result_received_at" TIMESTAMP(3);

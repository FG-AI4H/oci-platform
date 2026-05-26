-- Annotator calibration drift flags (#292, ADR-0009 Decision 4 + 5).
-- One ACTIVE row per (campaign, annotator, flagType); CLEARED rows
-- accumulate for audit. Partial unique index enforces the ACTIVE
-- exclusivity without blocking historical rows.

CREATE TABLE "annotation"."annotator_calibration_flags" (
    "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id"        UUID         NOT NULL,
    "annotator_user_id"  UUID         NOT NULL,
    "flag_type"          TEXT         NOT NULL,
    "metric"             TEXT         NOT NULL,
    "score"              DOUBLE PRECISION NOT NULL,
    "threshold"          DOUBLE PRECISION NOT NULL,
    "sample_size"        INTEGER      NOT NULL,
    "status"             TEXT         NOT NULL DEFAULT 'ACTIVE',
    "window_meta"        JSONB        NOT NULL,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleared_at"         TIMESTAMP(3),
    CONSTRAINT "annotator_calibration_flags_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "annotator_calibration_flags_campaign_status_idx"
    ON "annotation"."annotator_calibration_flags" ("campaign_id", "status");

CREATE INDEX "annotator_calibration_flags_annotator_status_idx"
    ON "annotation"."annotator_calibration_flags" ("annotator_user_id", "status");

CREATE UNIQUE INDEX "annotator_calibration_flags_active_unique"
    ON "annotation"."annotator_calibration_flags" (
        "campaign_id", "annotator_user_id", "flag_type"
    )
    WHERE "status" = 'ACTIVE';

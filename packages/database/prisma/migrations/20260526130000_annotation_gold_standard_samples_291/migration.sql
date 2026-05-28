-- Gold-standard sample handling (#291, ADR-0009 Decision 4).
--
-- Adds two columns to `annotation.annotation_tasks` + a partial
-- composite index that supports the supervisor query
-- "all gold samples in this campaign".
--
-- Backfill: existing tasks default to `is_gold_standard = false`,
-- `gold_standard_label = NULL` — no campaign manager has flagged
-- any sample yet. The IRR-vs-gold computation simply finds zero
-- gold rows on legacy campaigns.

ALTER TABLE "annotation"."annotation_tasks"
    ADD COLUMN "is_gold_standard" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "gold_standard_label" JSONB;

CREATE INDEX "annotation_tasks_gold_idx"
    ON "annotation"."annotation_tasks" ("campaign_id", "is_gold_standard");

COMMENT ON COLUMN "annotation"."annotation_tasks"."is_gold_standard" IS
    'Gold-standard sample (ADR-0009 Decision 4). Supervisor scores annotator submissions against `gold_standard_label`.';
COMMENT ON COLUMN "annotation"."annotation_tasks"."gold_standard_label" IS
    'Expected submission JSON for a gold sample. Same shape as AnnotationTaskAssignment.submission.';

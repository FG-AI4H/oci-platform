-- Per-campaign annotation instructions (#230). Markdown body + media
-- URLs versioned by content hash; per-assignment ack version captured
-- into provenance; per-task instructions note for special-attention
-- overrides.

CREATE TABLE "annotation"."annotation_campaign_instructions" (
    "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id"    UUID         NOT NULL,
    "version"        TEXT         NOT NULL,
    "markdown_body"  TEXT         NOT NULL,
    "media_urls"     JSONB        NOT NULL,
    "created_by_id"  UUID         NOT NULL,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "annotation_campaign_instructions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "annotation_campaign_instructions_campaign_id_version_key"
    ON "annotation"."annotation_campaign_instructions" ("campaign_id", "version");

CREATE INDEX "annotation_campaign_instructions_campaign_id_created_at_idx"
    ON "annotation"."annotation_campaign_instructions" ("campaign_id", "created_at");

ALTER TABLE "annotation"."annotation_campaign_instructions"
    ADD CONSTRAINT "annotation_campaign_instructions_campaign_id_fkey"
    FOREIGN KEY ("campaign_id")
    REFERENCES "annotation"."annotation_campaigns" ("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "annotation"."annotation_campaigns"
    ADD COLUMN "current_instructions_version" TEXT;

ALTER TABLE "annotation"."annotation_tasks"
    ADD COLUMN "instructions_note" TEXT;

ALTER TABLE "annotation"."annotation_task_assignments"
    ADD COLUMN "acknowledged_instructions_version" TEXT;

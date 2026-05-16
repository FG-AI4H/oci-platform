-- Campaign lifecycle (#215, slice 1). Adds the `started_at`
-- denormalised column so completed campaigns retain the moment work
-- began. `completed_at` already existed; this migration only adds the
-- one missing field.

ALTER TABLE "annotation"."annotation_campaigns"
    ADD COLUMN "started_at" TIMESTAMP(3);

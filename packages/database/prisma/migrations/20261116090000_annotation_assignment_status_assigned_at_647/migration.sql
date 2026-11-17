-- Index for the abandonment scans (#647, PR #669 review).
--
-- Pull-next and the BullMQ sweep both look for assignments still
-- PENDING / IN_PROGRESS that were handed out before a cut-off, oldest
-- first. No existing index leads with (status, assigned_at), so each
-- scan read every assignment row. Additive; no data change.

-- CreateIndex
CREATE INDEX "annotation_task_assignments_status_assigned_at_idx"
    ON "annotation"."annotation_task_assignments" ("status", "assigned_at");

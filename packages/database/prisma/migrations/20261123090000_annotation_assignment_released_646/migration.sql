-- An annotator can give a task back unread ("Skip", #646).
--
-- WHY. Opening the annotate page used to reserve a task, and nothing could
-- give one back short of the abandonment timeout. A released assignment is
-- kept as its own status rather than folded into EXPIRED so abandonment and
-- deliberate skips stay separable, and so the router can offer the caller
-- other tasks before the one they skipped.
--
-- ADDITIVE ONLY. `ALTER TYPE ... ADD VALUE` is catalog-only on PostgreSQL 12+.
-- The new value is not used in this migration (a value added in a transaction
-- cannot be used in that same transaction). The active-assignment unique index
-- is already restricted to `status IN ('PENDING', 'IN_PROGRESS')`, so RELEASED
-- rows fall outside it with no index change. The new column is nullable.

ALTER TYPE "annotation"."AnnotationAssignmentStatus" ADD VALUE 'RELEASED';

ALTER TABLE "annotation"."annotation_task_assignments"
    ADD COLUMN "released_at" TIMESTAMP(3);

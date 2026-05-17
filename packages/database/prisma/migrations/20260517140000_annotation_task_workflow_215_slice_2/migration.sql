-- Annotation task workflow (#215 slice 2, ADR-0006 Decision 3 +
-- ADR-0008 §gate semantics + ADR-0009 Decision 1).
--
-- Adds AnnotationTask (per-sample work unit) + AnnotationTaskAssignment
-- (per-annotator handoff) + the gate-state + assignment-status enums
-- the service layer consumes.

CREATE TYPE "annotation"."AnnotationGateState" AS ENUM (
    'INDEPENDENT',
    'AWAITING_ARBITRATION',
    'AWAITING_EXPERT',
    'COMPLETED',
    'SKIPPED'
);

CREATE TYPE "annotation"."AnnotationAssignmentStatus" AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'SUBMITTED',
    'EXPIRED'
);

CREATE TABLE "annotation"."annotation_tasks" (
    "id"                    UUID         NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id"           UUID         NOT NULL,
    "sample_ref"            TEXT         NOT NULL,
    "n_annotators_required" INTEGER      NOT NULL,
    "gate_state"            "annotation"."AnnotationGateState" NOT NULL DEFAULT 'INDEPENDENT',
    "skip_reason"           TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,
    "completed_at"          TIMESTAMP(3),

    CONSTRAINT "annotation_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "annotation_tasks_campaign_sample_key"
    ON "annotation"."annotation_tasks" ("campaign_id", "sample_ref");
CREATE INDEX "annotation_tasks_campaign_gate_idx"
    ON "annotation"."annotation_tasks" ("campaign_id", "gate_state");

CREATE TABLE "annotation"."annotation_task_assignments" (
    "id"                   UUID         NOT NULL DEFAULT gen_random_uuid(),
    "task_id"              UUID         NOT NULL,
    "assignee_user_id"     UUID         NOT NULL,
    "assignee_role"        TEXT         NOT NULL,
    "gate_at_assignment"   "annotation"."AnnotationGateState" NOT NULL,
    "status"               "annotation"."AnnotationAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "submission"           JSONB,
    "assigned_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at"           TIMESTAMP(3),
    "submitted_at"         TIMESTAMP(3),
    "expired_at"           TIMESTAMP(3),

    CONSTRAINT "annotation_task_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "annotation_task_assignments_task_fk"
        FOREIGN KEY ("task_id") REFERENCES "annotation"."annotation_tasks"("id") ON DELETE CASCADE
);

CREATE INDEX "annotation_task_assignments_task_status_idx"
    ON "annotation"."annotation_task_assignments" ("task_id", "status");
CREATE INDEX "annotation_task_assignments_user_status_idx"
    ON "annotation"."annotation_task_assignments" ("assignee_user_id", "status");
CREATE INDEX "annotation_task_assignments_task_gate_status_idx"
    ON "annotation"."annotation_task_assignments" ("task_id", "gate_at_assignment", "status");

-- An annotator should not hold two active assignments (PENDING /
-- IN_PROGRESS) for the same (task, gate). SUBMITTED + EXPIRED are
-- excluded so re-assignment after abandonment isn't blocked.
CREATE UNIQUE INDEX "annotation_task_assignments_active_unique_idx"
    ON "annotation"."annotation_task_assignments" ("task_id", "assignee_user_id", "gate_at_assignment")
    WHERE "status" IN ('PENDING', 'IN_PROGRESS');

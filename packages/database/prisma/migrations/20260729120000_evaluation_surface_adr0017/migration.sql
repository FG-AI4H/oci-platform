-- Minimal evaluation surface (Phase C-lite, ADR-0017). Two tables in the
-- `evaluation` schema: `evaluation_tasks` (binds a dataset slug + task kind
-- + metric config + the HIDDEN ground-truth labels) and `submissions`
-- (one scored/failed run per task). Mode 1 (predictions-file, in-process
-- scoring) only — the models also carry the Mode 2 (sealed container) door
-- (`SubmissionMode.CONTAINER`) so Mode 2 is an execution-path upgrade.
--
-- Ground truth lives in `evaluation_tasks.ground_truth` (JSONB) and is
-- never exposed by any read endpoint or dataset distribution.

-- The `evaluation` schema already exists (20260505000000_init); re-assert
-- defensively so this migration is safe to run against a cluster that was
-- provisioned before that schema was seeded.
CREATE SCHEMA IF NOT EXISTS "evaluation";

-- CreateEnum
CREATE TYPE "evaluation"."EvaluationTaskKind" AS ENUM ('GRADING');

-- CreateEnum
CREATE TYPE "evaluation"."SubmissionMode" AS ENUM ('PREDICTIONS', 'CONTAINER');

-- CreateEnum
CREATE TYPE "evaluation"."SubmissionStatus" AS ENUM ('PENDING', 'SCORED', 'FAILED');

-- CreateTable
CREATE TABLE "evaluation"."evaluation_tasks" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dataset_slug" TEXT NOT NULL,
    "task_kind" "evaluation"."EvaluationTaskKind" NOT NULL DEFAULT 'GRADING',
    "num_classes" INTEGER NOT NULL DEFAULT 5,
    "referable_threshold" INTEGER NOT NULL DEFAULT 2,
    "ground_truth" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_tasks_slug_key" ON "evaluation"."evaluation_tasks"("slug");

-- CreateTable
CREATE TABLE "evaluation"."submissions" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "method_name" TEXT NOT NULL,
    "submitted_by" UUID,
    "mode" "evaluation"."SubmissionMode" NOT NULL DEFAULT 'PREDICTIONS',
    "status" "evaluation"."SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "scores" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submissions_task_id_idx" ON "evaluation"."submissions"("task_id");

-- AddForeignKey
ALTER TABLE "evaluation"."submissions" ADD CONSTRAINT "submissions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "evaluation"."evaluation_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

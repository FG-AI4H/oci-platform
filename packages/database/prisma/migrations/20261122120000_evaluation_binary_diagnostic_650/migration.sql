-- Diagnostic-accuracy scoring for one binary finding (issue #650, ADR-0020
-- amendment of 2026-11-22).
--
-- WHY. Clinicians and health authorities read a diagnostic model through
-- sensitivity, specificity and the two predictive values, each with an
-- interval. `CLASSIFICATION` reports macro F1 and per-class precision/recall,
-- which carry the same counts but not in the terms, or with the intervals,
-- that a diagnostic-accuracy reader expects. `BINARY_DIAGNOSTIC` is a scoring
-- family of its own in the registry, so it needs an enum value of its own.
--
-- ADDITIVE ONLY, two statements:
--
--   1. `ALTER TYPE ... ADD VALUE` is a catalog-only change on PostgreSQL 12+:
--      no table rewrite, no scan, existing rows untouched. The new value is NOT
--      referenced anywhere in this migration, which is what makes it safe
--      inside Prisma's transaction (a value added in a transaction cannot be
--      used in that same transaction). IF NOT EXISTS keeps a re-run a no-op.
--
--   2. A NULLABLE column with no default: also catalog-only, no rewrite. It
--      holds what label 1 means, in words, for a binary task, so the task's
--      published configuration can say which class is "positive". Null for
--      every existing task, which keeps their behaviour and their published
--      scores exactly as they were.
--
-- Nothing is altered or dropped.

ALTER TYPE "evaluation"."EvaluationTaskKind" ADD VALUE IF NOT EXISTS 'BINARY_DIAGNOSTIC';

ALTER TABLE "evaluation"."evaluation_tasks" ADD COLUMN "positive_class_name" VARCHAR(200);

-- Subgroup-stratified reporting with small-cell suppression (issue #410,
-- ADR-0030).
--
-- WHY. One aggregate number hides a model that is worse for some patients.
-- A task now declares subgroup fields (for example sex and age band), holds
-- each item's value for them beside its answer key, and every submission
-- stores its results per subgroup next to its aggregate scores.
--
-- ADDITIVE ONLY, three columns, nothing altered or dropped:
--
--   1. `evaluation_tasks.subgroup_fields`: the declared fields with their
--      labels and allowed values. Public configuration. NOT NULL with a
--      constant default, which PostgreSQL 11+ records in the catalog without
--      rewriting the table. Every existing task reads `[]`: no field.
--
--   2. `evaluation_tasks.subgroup_values`: `{ itemId: { field: value } }`.
--      Held server-side like the answer key; the API never returns it.
--      Nullable, no default: catalog-only.
--
--   3. `submissions.subgroup_scores`: the subgroup results computed at
--      scoring time, already suppressed. Nullable, no default: catalog-only.
--      Null for every existing submission, whose published results are
--      unchanged.

ALTER TABLE "evaluation"."evaluation_tasks"
  ADD COLUMN "subgroup_fields" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "evaluation"."evaluation_tasks"
  ADD COLUMN "subgroup_values" JSONB;

ALTER TABLE "evaluation"."submissions"
  ADD COLUMN "subgroup_scores" JSONB;

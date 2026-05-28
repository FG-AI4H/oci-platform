-- Metadata-exposure + blinding engine (ADR-0010 Decisions 1 + 2 + 4).
--
-- Additive, nullable JSONB columns — safe to deploy ahead of the
-- engine wiring (the columns stay null until a campaign manager
-- configures visibility / the handoff persists an exposure profile):
--
--   annotation_campaigns.visibility_config
--     The four-bucket field overrides (required/optional/hidden/never)
--     + per-gate promotions + training-grade flag, versioned by hash.
--
--   annotation_task_assignments.metadata_exposure_profile
--     What the annotator actually saw at annotation time
--     ({ visibilityConfigHash, visibilityConfigVersion, deliveredFields }).

ALTER TABLE "annotation"."annotation_campaigns"
    ADD COLUMN "visibility_config" JSONB;

ALTER TABLE "annotation"."annotation_task_assignments"
    ADD COLUMN "metadata_exposure_profile" JSONB;

-- Add `supported_task_kinds` to the annotation-tool registry so the
-- campaign-create form can filter the tool picker after the user
-- selects a task kind (#247 spawned this feedback from the slice-A
-- form redesign).
--
-- Backfill the seeded rows:
--   monai-label  → SEGMENTATION + CLASSIFICATION
--   ohif-viewer  → CLASSIFICATION + DETECTION + LOCALIZATION
-- These line up with the two integrations' actual real-world coverage:
-- MONAI Label is geared toward pixel-level annotation + image
-- classification; OHIF Viewer is 2D image viewing with measurement /
-- detection overlays. The full per-task capability matrix from
-- ADR-0007 (containers, signed-handoff routes, schemaProfiles) lands
-- with #214.

ALTER TABLE "annotation"."annotation_tool_integrations"
    ADD COLUMN "supported_task_kinds" "annotation"."CampaignTaskKind"[] NOT NULL DEFAULT ARRAY[]::"annotation"."CampaignTaskKind"[];

UPDATE "annotation"."annotation_tool_integrations"
SET "supported_task_kinds" = ARRAY['SEGMENTATION', 'CLASSIFICATION']::"annotation"."CampaignTaskKind"[]
WHERE "slug" = 'monai-label';

UPDATE "annotation"."annotation_tool_integrations"
SET "supported_task_kinds" = ARRAY['CLASSIFICATION', 'DETECTION', 'LOCALIZATION']::"annotation"."CampaignTaskKind"[]
WHERE "slug" = 'ohif-viewer';

-- Drop the temporary default so new rows must declare their support
-- explicitly. The seed above + ADR-0007 expectations make "default to
-- empty array" a foot-gun (a tool that supports nothing should never
-- be queryable by the form).
ALTER TABLE "annotation"."annotation_tool_integrations"
    ALTER COLUMN "supported_task_kinds" DROP DEFAULT;

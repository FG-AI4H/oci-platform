-- ============================================================================
-- OCI Platform — demo-data seed.
--
-- This file is replayed against every non-prod environment on each
-- deploy (apps/migrate runs it after `prisma migrate deploy` when
-- `OCI_ENV != 'prod'`). Re-runs are safe — every INSERT uses ON
-- CONFLICT DO NOTHING.
--
-- New demo entities go here. Conventions:
--
--   - One section per resource type, comment block at the top.
--   - Slug-keyed UPSERTs. Never reference UUIDs literally — let the
--     row's existing id flow via slug lookup.
--   - Reference data (datasets / tool integrations) lands before the
--     campaigns / annotations that depend on it. Order matters when
--     this file is first-applied against an empty DB.
--   - When a row's *shape* changes (e.g. add a column with a sensible
--     default), the migration handles backfill — this file just keeps
--     the row alive.
--
-- Where this file does NOT belong:
--
--   - Production. The migrate entrypoint skips this file when
--     OCI_ENV=prod. Production seed data goes through the
--     business-rule path (apps/api/scripts/seed-catalog.ts at the
--     HTTP layer).
--   - Reference data the application needs to function (e.g. the
--     stub tool-integration registry). That belongs in the
--     migration SQL (already there for `monai-label` + `ohif-viewer`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Section 1 — Datasets.
--
-- Real Croissant manifests are loaded via the existing
-- `scripts/seed-catalog.ts` flow (operator-driven, HTTP-layer). The
-- rows here are minimal placeholders so the catalog list page on dev
-- always has something visible without depending on the operator.
--
-- `rsna-pneumonia-2018` is the anchor dataset the demo campaigns
-- below attach to. Marked PUBLIC so unauthenticated callers can see
-- it; admins on dev still publish the real RSNA manifest via the
-- operator-driven flow when they want the full payload.
-- ----------------------------------------------------------------------------

INSERT INTO "catalog"."datasets"
    (id, slug, name, description, host_id, visibility, status, access_tier, commercial_use_terms, updated_at)
VALUES
    (gen_random_uuid(),
     'rsna-pneumonia-2018',
     'RSNA Pneumonia Detection 2018 — OCI Mirror',
     'Demo placeholder for the RSNA Pneumonia Detection 2018 chest-XR dataset. Real manifest loads via scripts/seed-catalog.ts.',
     '00000000-0000-4000-8000-000000000099',
     'PUBLIC',
     'PUBLISHED',
     'OPEN',
     'OK',
     CURRENT_TIMESTAMP),
    (gen_random_uuid(),
     'isic-2019-melanoma',
     'ISIC 2019 Skin Lesion Classification — OCI Restricted Mirror',
     'Demo placeholder for the ISIC 2019 dermoscopy dataset. RESTRICTED tier — gated on access request.',
     '00000000-0000-4000-8000-000000000099',
     'RESTRICTED',
     'PUBLISHED',
     'REGISTERED',
     'NON_COMMERCIAL_ONLY',
     CURRENT_TIMESTAMP),
    (gen_random_uuid(),
     'uhz-cardiac-mri-2024',
     'UHZ Cardiac MRI Arrhythmia Cohort 2024',
     'Demo placeholder for the UHZ Cardiac MRI cohort. PRIVATE tier — host + admin only.',
     '00000000-0000-4000-8000-000000000099',
     'PRIVATE',
     'PUBLISHED',
     'CONTROLLED',
     'CASE_BY_CASE',
     CURRENT_TIMESTAMP)
ON CONFLICT (slug) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Section 2 — Annotation campaigns.
--
-- Both campaigns target the RSNA dataset + MONAI Label tool. The pair
-- gives operators an immediate starting point for the lifecycle UI:
--
--   - demo-rsna-classification → DRAFT (testbed for mark-ready → start)
--   - demo-rsna-segmentation   → RUNNING (testbed for complete / archive)
--
-- These attach via slug lookups against the rows seeded above so the
-- file is order-independent on re-runs.
--
-- `created_by_id` references a stable v5 UUID of the dev-stub "alice"
-- user. In prod the FK is the real admin's Cognito sub — this row is
-- intentionally fake on non-prod and never written in prod.
-- ----------------------------------------------------------------------------

INSERT INTO "annotation"."annotation_campaigns"
    (id, slug, name, description, status, task_kind, dataset_id, tool_integration_id,
     output_license, workflow_config, created_by_id,
     created_at, updated_at, started_at, completed_at)
SELECT
    gen_random_uuid(),
    'demo-rsna-classification',
    'Demo: RSNA pneumonia classification',
    'Pre-seeded DRAFT for manual testing. Move it through the lifecycle.',
    'DRAFT'::"annotation"."CampaignStatus",
    'CLASSIFICATION'::"annotation"."CampaignTaskKind",
    ds.id,
    tool.id,
    'CC-BY-4.0'::"annotation"."CampaignOutputLicense",
    '{"nAnnotators": 3}'::jsonb,
    '00000000-0000-4000-8000-000000000099',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL
FROM "catalog"."datasets" ds,
     "annotation"."annotation_tool_integrations" tool
WHERE ds.slug = 'rsna-pneumonia-2018'
  AND tool.slug = 'monai-label'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO "annotation"."annotation_campaigns"
    (id, slug, name, description, status, task_kind, dataset_id, tool_integration_id,
     output_license, workflow_config, created_by_id,
     created_at, updated_at, started_at, completed_at)
SELECT
    gen_random_uuid(),
    'demo-rsna-segmentation',
    'Demo: RSNA pneumonia segmentation',
    'Pre-seeded RUNNING for manual testing. Try Complete or Archive.',
    'RUNNING'::"annotation"."CampaignStatus",
    'SEGMENTATION'::"annotation"."CampaignTaskKind",
    ds.id,
    tool.id,
    'CC-BY-4.0'::"annotation"."CampaignOutputLicense",
    '{"nAnnotators": 3}'::jsonb,
    '00000000-0000-4000-8000-000000000099',
    CURRENT_TIMESTAMP - INTERVAL '2 days',
    CURRENT_TIMESTAMP - INTERVAL '1 day',
    CURRENT_TIMESTAMP - INTERVAL '1 day',
    NULL
FROM "catalog"."datasets" ds,
     "annotation"."annotation_tool_integrations" tool
WHERE ds.slug = 'rsna-pneumonia-2018'
  AND tool.slug = 'monai-label'
ON CONFLICT (slug) DO NOTHING;

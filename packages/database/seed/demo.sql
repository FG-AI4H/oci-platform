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

-- ----------------------------------------------------------------------------
-- Section 3 — OCI-owned demo dataset WITH REAL S3 BYTES (#251).
--
-- Unlike the placeholders in Section 1, this dataset is end-to-end live:
-- the migrate entrypoint uploads the bundled PNGs to S3 (via
-- `apps/migrate/upload-fixtures.mjs`) BEFORE this seed runs, and the
-- rows here reference the exact keys that were uploaded. Click any
-- distribution's download link and the API streams the bytes back via
-- a short-lived presigned URL.
--
-- All UUIDs in this section are stable so the section is idempotent
-- (`ON CONFLICT (slug|id|...) DO NOTHING`) and the manifest's
-- contentUrl paths match the distribution row ids.
--
-- The `s3_bucket` column is parameterised via a Postgres GUC the
-- entrypoint sets before invoking this file:
--     SET app.datasets_bucket = '<bucket-name>';
-- Falls back to `oci-datasets-local` for direct `pnpm db:seed:demo`
-- runs (the local MinIO bucket).
-- ----------------------------------------------------------------------------

DO $oci_demo$
DECLARE
  ds_id     uuid := '00000000-0000-4000-8000-deadbeef0d00';
  ver_id    uuid := '00000000-0000-4000-8000-deadbeef0d01';
  bucket    text := COALESCE(current_setting('app.datasets_bucket', true), 'oci-datasets-local');
  payload   jsonb := $manifest$
{
  "@context": {
    "@vocab": "https://schema.org/",
    "sc": "https://schema.org/",
    "cr": "http://mlcommons.org/croissant/",
    "rai": "http://mlcommons.org/croissant/RAI/",
    "prov": "http://www.w3.org/ns/prov#",
    "dct": "http://purl.org/dc/terms/",
    "bio": "https://oci.ai4h.net/biocroissant/v0.1#"
  },
  "@type": "sc:Dataset",
  "dct:conformsTo": "http://mlcommons.org/croissant/1.1",
  "name": "OCI Demo: Synthetic Chest XR",
  "description": "OCI-curated demo dataset comprising five 256x256 grayscale chest-XR-style synthetic images. Generated procedurally for platform smoke testing - NOT diagnostic content and NOT representative of real patient data.",
  "url": "https://oci.ai4h.net/catalog/oci-demo-chest-xr",
  "creator": [{ "@type": "sc:Organization", "name": "OCI Platform (ITU/WHO/WIPO GI-AI4H)" }],
  "publisher": { "@type": "sc:Organization", "name": "OCI Platform", "url": "https://oci.ai4h.net/" },
  "datePublished": "2026-05-16",
  "version": "1.0.0",
  "license": "https://creativecommons.org/licenses/by/4.0/",
  "keywords": ["synthetic", "chest x-ray", "demo", "smoke test"],
  "bio:modality": [{ "@id": "bio:modality/X-ray", "name": "X-ray" }],
  "bio:bodyRegion": [{ "@id": "bio:bodyRegion/Chest", "name": "Chest" }],
  "bio:synthetic": true,
  "bio:intendedUse": "platform smoke testing",
  "rai:personalSensitiveInformation": "None. All images are synthetic.",
  "distribution": [
    { "@id": "00000000-0000-4000-8000-deadbeef0001", "@type": "cr:FileObject", "name": "sample-001.png", "encodingFormat": "image/png", "contentUrl": "/v2/catalog/datasets/oci-demo-chest-xr/distributions/00000000-0000-4000-8000-deadbeef0001/download", "contentSize": "43281 B", "sha256": "6b7f2715baa0e978bf87622767891df18b05e93d57331b10da758b89d816b538" },
    { "@id": "00000000-0000-4000-8000-deadbeef0002", "@type": "cr:FileObject", "name": "sample-002.png", "encodingFormat": "image/png", "contentUrl": "/v2/catalog/datasets/oci-demo-chest-xr/distributions/00000000-0000-4000-8000-deadbeef0002/download", "contentSize": "43352 B", "sha256": "f60d9f613946419a4ed038f678e2765443237475ca8155c94cab2b58a244c1da" },
    { "@id": "00000000-0000-4000-8000-deadbeef0003", "@type": "cr:FileObject", "name": "sample-003.png", "encodingFormat": "image/png", "contentUrl": "/v2/catalog/datasets/oci-demo-chest-xr/distributions/00000000-0000-4000-8000-deadbeef0003/download", "contentSize": "43358 B", "sha256": "917b7533b46b029f6620cf5d4d44f1940fac4c8710e9ce4ad865964b9712a19c" },
    { "@id": "00000000-0000-4000-8000-deadbeef0004", "@type": "cr:FileObject", "name": "sample-004.png", "encodingFormat": "image/png", "contentUrl": "/v2/catalog/datasets/oci-demo-chest-xr/distributions/00000000-0000-4000-8000-deadbeef0004/download", "contentSize": "43432 B", "sha256": "a6e7c135b89cded45a7c98c063c52a0f537958d47e6705d88d889900fcfe441c" },
    { "@id": "00000000-0000-4000-8000-deadbeef0005", "@type": "cr:FileObject", "name": "sample-005.png", "encodingFormat": "image/png", "contentUrl": "/v2/catalog/datasets/oci-demo-chest-xr/distributions/00000000-0000-4000-8000-deadbeef0005/download", "contentSize": "43436 B", "sha256": "6a92c82cea79a878adb82c6af46b88235a9cb21509a9ae0892b7b92629d0fa7b" }
  ]
}
$manifest$::jsonb;
BEGIN
  -- Dataset row.
  INSERT INTO "catalog"."datasets" (
    id, slug, name, description, host_id, visibility, status,
    access_tier, commercial_use_terms,
    conformance_version, croissant, updated_at
  ) VALUES (
    ds_id,
    'oci-demo-chest-xr',
    'OCI Demo: Synthetic Chest XR',
    'OCI-curated demo dataset. Five synthetic 256x256 grayscale chest-XR-style images generated procedurally for platform smoke testing. NOT diagnostic content.',
    '00000000-0000-4000-8000-000000000099',
    'PUBLIC',
    'PUBLISHED',
    'OPEN',
    'OK',
    '1.1',
    payload,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (slug) DO NOTHING;

  -- Version 1.0.0 row carrying the same manifest.
  INSERT INTO "catalog"."dataset_versions" (
    id, dataset_id, version, croissant, published_by_id, published_at
  ) VALUES (
    ver_id, ds_id, '1.0.0', payload,
    '00000000-0000-4000-8000-000000000099',
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (dataset_id, version) DO NOTHING;

  -- Five distribution rows. Their ids match the manifest's @id values
  -- so the contentUrl paths resolve. Stamped READY because the
  -- entrypoint already uploaded the bytes by the time this section
  -- runs.
  INSERT INTO "catalog"."distributions" (
    id, dataset_version_id, croissant_id, content_url, content_type,
    content_size_bytes, content_hash_sha256, requires_access,
    storage_backend, s3_bucket, s3_key, upload_status
  ) VALUES
    ('00000000-0000-4000-8000-deadbeef0001'::uuid, ver_id,
     '00000000-0000-4000-8000-deadbeef0001',
     '/v2/catalog/datasets/oci-demo-chest-xr/distributions/00000000-0000-4000-8000-deadbeef0001/download',
     'image/png', 43281,
     '6b7f2715baa0e978bf87622767891df18b05e93d57331b10da758b89d816b538',
     false, 'S3'::"catalog"."DistributionStorageBackend",
     bucket,
     'oci-demo-chest-xr/00000000-0000-4000-8000-deadbeef0001/sample-001.png',
     'READY'::"catalog"."DistributionUploadStatus"),
    ('00000000-0000-4000-8000-deadbeef0002'::uuid, ver_id,
     '00000000-0000-4000-8000-deadbeef0002',
     '/v2/catalog/datasets/oci-demo-chest-xr/distributions/00000000-0000-4000-8000-deadbeef0002/download',
     'image/png', 43352,
     'f60d9f613946419a4ed038f678e2765443237475ca8155c94cab2b58a244c1da',
     false, 'S3'::"catalog"."DistributionStorageBackend",
     bucket,
     'oci-demo-chest-xr/00000000-0000-4000-8000-deadbeef0002/sample-002.png',
     'READY'::"catalog"."DistributionUploadStatus"),
    ('00000000-0000-4000-8000-deadbeef0003'::uuid, ver_id,
     '00000000-0000-4000-8000-deadbeef0003',
     '/v2/catalog/datasets/oci-demo-chest-xr/distributions/00000000-0000-4000-8000-deadbeef0003/download',
     'image/png', 43358,
     '917b7533b46b029f6620cf5d4d44f1940fac4c8710e9ce4ad865964b9712a19c',
     false, 'S3'::"catalog"."DistributionStorageBackend",
     bucket,
     'oci-demo-chest-xr/00000000-0000-4000-8000-deadbeef0003/sample-003.png',
     'READY'::"catalog"."DistributionUploadStatus"),
    ('00000000-0000-4000-8000-deadbeef0004'::uuid, ver_id,
     '00000000-0000-4000-8000-deadbeef0004',
     '/v2/catalog/datasets/oci-demo-chest-xr/distributions/00000000-0000-4000-8000-deadbeef0004/download',
     'image/png', 43432,
     'a6e7c135b89cded45a7c98c063c52a0f537958d47e6705d88d889900fcfe441c',
     false, 'S3'::"catalog"."DistributionStorageBackend",
     bucket,
     'oci-demo-chest-xr/00000000-0000-4000-8000-deadbeef0004/sample-004.png',
     'READY'::"catalog"."DistributionUploadStatus"),
    ('00000000-0000-4000-8000-deadbeef0005'::uuid, ver_id,
     '00000000-0000-4000-8000-deadbeef0005',
     '/v2/catalog/datasets/oci-demo-chest-xr/distributions/00000000-0000-4000-8000-deadbeef0005/download',
     'image/png', 43436,
     '6a92c82cea79a878adb82c6af46b88235a9cb21509a9ae0892b7b92629d0fa7b',
     false, 'S3'::"catalog"."DistributionStorageBackend",
     bucket,
     'oci-demo-chest-xr/00000000-0000-4000-8000-deadbeef0005/sample-005.png',
     'READY'::"catalog"."DistributionUploadStatus")
  ON CONFLICT (id) DO NOTHING;
END
$oci_demo$;

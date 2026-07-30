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
    (id, slug, name, description, host_id, visibility, status, access_tier, commercial_use_terms, modalities, updated_at)
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
     ARRAY['X-ray'],
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
     ARRAY['Pathology'],
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
     ARRAY['MRI'],
     CURRENT_TIMESTAMP),
    -- Text-only dataset (#247). The campaign-create form must disable
    -- the spatial task-kind radios (DETECTION / SEGMENTATION /
    -- LOCALIZATION) when this dataset is picked; CLASSIFICATION and
    -- MULTI_MODAL stay enabled. E2E coverage in
    -- apps/web/e2e/annotation-campaign.spec.ts.
    (gen_random_uuid(),
     'demo-clinical-notes-2024',
     'Demo Clinical Notes 2024 — Text-Only Modality',
     'Demo placeholder for a text-only clinical-notes dataset. Used to exercise the campaign-create modality → task-kind constraint (#247).',
     '00000000-0000-4000-8000-000000000099',
     'PUBLIC',
     'PUBLISHED',
     'OPEN',
     'OK',
     ARRAY['Text'],
     CURRENT_TIMESTAMP)
ON CONFLICT (slug) DO NOTHING;

-- Idempotent backfill: existing dev clusters created before #247 hold
-- rows with empty `modalities`. Top them up so the constraint E2E and
-- the dataset-detail badge work without requiring a destroy-recreate.
UPDATE "catalog"."datasets"
SET "modalities" = ARRAY['X-ray']
WHERE slug = 'rsna-pneumonia-2018' AND cardinality("modalities") = 0;
UPDATE "catalog"."datasets"
SET "modalities" = ARRAY['Pathology']
WHERE slug = 'isic-2019-melanoma' AND cardinality("modalities") = 0;
UPDATE "catalog"."datasets"
SET "modalities" = ARRAY['MRI']
WHERE slug = 'uhz-cardiac-mri-2024' AND cardinality("modalities") = 0;

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
-- Section 2b — Annotation tasks for the RUNNING demo campaign (#215 slice 2).
--
-- Seeds 8 AnnotationTask rows against `demo-rsna-segmentation` so the
-- annotator UI has work to hand out the moment a dev signs in with
-- the annotator role. The campaign has nAnnotators=3, so each task
-- needs three independent submissions before it escalates to
-- arbitration.
--
-- Sample refs are opaque pointers (`<dataset-slug>/sample-NNN`); the
-- catalog ↔ annotation linkage that turns them into real S3 keys
-- lands with #223 (E11). Until then they're just stable strings.
--
-- ON CONFLICT (campaign_id, sample_ref) matches the unique index in
-- the migration, so re-runs are no-ops.
-- ----------------------------------------------------------------------------

INSERT INTO "annotation"."annotation_tasks"
    (campaign_id, sample_ref, n_annotators_required, gate_state, updated_at)
SELECT
    c.id,
    'rsna-pneumonia-2018/sample-' || lpad(s::text, 3, '0'),
    3,
    'INDEPENDENT'::"annotation"."AnnotationGateState",
    CURRENT_TIMESTAMP
FROM "annotation"."annotation_campaigns" c,
     generate_series(1, 8) s
WHERE c.slug = 'demo-rsna-segmentation'
ON CONFLICT (campaign_id, sample_ref) DO NOTHING;

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

-- ----------------------------------------------------------------------------
-- Section 4 — IDRiD DR-grading demo slice WITH REAL S3 BYTES.
-- 30-image CC BY 4.0 slice; bytes uploaded by upload-fixtures.mjs before this
-- runs. Generated by fixtures/idrid-grading-demo/generate.mjs. Ground truth is
-- held by the evaluation service and is NOT seeded here.
-- ----------------------------------------------------------------------------

DO $idrid_demo$
DECLARE
  ds_id   uuid := 'a4cbf01a-993d-5879-849a-075706a9a8d1';
  ver_id  uuid := '0c5626ec-d6f0-5f53-9954-83ca17c619e8';
  bucket  text := COALESCE(current_setting('app.datasets_bucket', true), 'oci-datasets-local');
  payload jsonb := $manifest${"@context":{"@vocab":"https://schema.org/","sc":"https://schema.org/","cr":"http://mlcommons.org/croissant/","rai":"http://mlcommons.org/croissant/RAI/","prov":"http://www.w3.org/ns/prov#","dct":"http://purl.org/dc/terms/","bio":"https://oci.ai4h.net/biocroissant/v0.1#"},"@type":"sc:Dataset","dct:conformsTo":"http://mlcommons.org/croissant/1.1","name":"IDRiD — DR Grading (OCI demo slice)","description":"A 30-image, downsampled (512px) class-stratified slice of the IDRiD \"Disease Grading\" testing set, hosted in OCI storage to demonstrate the catalogue → gated download → evaluation flow end to end. Ground-truth grades are held by the evaluation service and are never published as a distribution. Derived from IDRiD (CC BY 4.0); see citeAs.","url":"https://idrid.grand-challenge.org/","sameAs":"https://doi.org/10.3390/data3030025","license":"https://creativecommons.org/licenses/by/4.0/","version":"1.0.0","datePublished":"2018-04-24","creator":[{"@type":"sc:Person","name":"Prasanna Porwal"},{"@type":"sc:Person","name":"Samiksha Pachade"},{"@type":"sc:Person","name":"Fabrice Meriaudeau"}],"publisher":{"@type":"sc:Organization","name":"OCI Platform (GI-AI4H) — demo slice of IDRiD"},"keywords":["diabetic retinopathy","fundus photography","disease grading","ophthalmology","demo"],"citeAs":"@article{porwal2018idrid, title={Indian Diabetic Retinopathy Image Dataset (IDRiD)...}, author={Porwal, Prasanna and others}, journal={Data}, volume={3}, number={3}, pages={25}, year={2018}, publisher={MDPI}}","distribution":[{"@id":"03e84220-36b6-548f-8a92-8b070a1f0ad4","@type":"cr:FileObject","name":"IDRiD_001.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/03e84220-36b6-548f-8a92-8b070a1f0ad4/download","contentSize":"16987 B","sha256":"501ba3f2874875e5d4ff33dd3f6b954d47a82c547bf53472efdef61f97e566d9"},{"@id":"2682fef1-21ba-5291-9991-a5476e8e582a","@type":"cr:FileObject","name":"IDRiD_002.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/2682fef1-21ba-5291-9991-a5476e8e582a/download","contentSize":"20530 B","sha256":"b095e0c6cbab4158b241447ada5574d71fec094a2a02972212acae2aa16a186b"},{"@id":"efa3cc6e-372a-54bd-8273-8db3db4f584e","@type":"cr:FileObject","name":"IDRiD_003.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/efa3cc6e-372a-54bd-8273-8db3db4f584e/download","contentSize":"20239 B","sha256":"6729d7ec7daa5304a7a3196f8e31ba126c00f93ad053c3de45932161c7f06b74"},{"@id":"ca381619-0af2-568a-9306-2464ed9d474d","@type":"cr:FileObject","name":"IDRiD_004.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/ca381619-0af2-568a-9306-2464ed9d474d/download","contentSize":"25271 B","sha256":"ff520a0741c7aed4ce6d79da9f98c6a43c4c660c8f9c97d21138ca7574e464c9"},{"@id":"d96cf95d-564e-5972-9956-fde3ebaa6e47","@type":"cr:FileObject","name":"IDRiD_005.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/d96cf95d-564e-5972-9956-fde3ebaa6e47/download","contentSize":"19464 B","sha256":"cb9bd9c344c5572a554da47240e98a2292137eb4feda15e79c487d54f0219a59"},{"@id":"620c5f0a-a00d-55a9-8111-225be9b53233","@type":"cr:FileObject","name":"IDRiD_006.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/620c5f0a-a00d-55a9-8111-225be9b53233/download","contentSize":"24672 B","sha256":"f04e7ebc4860703e151208f7629c4fa62768299cc0b76bc141b774174df8d627"},{"@id":"0a6a540b-9f4a-597e-99fc-b62b447bfaaf","@type":"cr:FileObject","name":"IDRiD_007.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/0a6a540b-9f4a-597e-99fc-b62b447bfaaf/download","contentSize":"22241 B","sha256":"aefcc482fd5fa5f225696a89c57148ecce7bafe5c0fc0b421a990a3de39b05ce"},{"@id":"71c63d39-cf30-5027-a41c-b8dbb7577cbf","@type":"cr:FileObject","name":"IDRiD_008.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/71c63d39-cf30-5027-a41c-b8dbb7577cbf/download","contentSize":"23144 B","sha256":"c7ff2559ef9c528b33c927eed692ec97ff7d5a23c465b9f122ee53c2439d5f29"},{"@id":"98bd2612-ded1-57c5-85f5-3f89511bb39a","@type":"cr:FileObject","name":"IDRiD_009.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/98bd2612-ded1-57c5-85f5-3f89511bb39a/download","contentSize":"22857 B","sha256":"f4c2c449a7c9b8eb594b9cbb399cd353860e59f920b79603520b063b51ab5d74"},{"@id":"4aa85e18-ae88-590d-a680-1e1b3da30bc8","@type":"cr:FileObject","name":"IDRiD_010.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/4aa85e18-ae88-590d-a680-1e1b3da30bc8/download","contentSize":"23742 B","sha256":"33f25841e7a12ae34a31e5429fa41b6ff2b20e0d5cf3d9b0e2796ca8a2886ad0"},{"@id":"a5261cbc-58f5-5869-85c3-96c33c29484b","@type":"cr:FileObject","name":"IDRiD_011.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/a5261cbc-58f5-5869-85c3-96c33c29484b/download","contentSize":"21234 B","sha256":"8c9c6316c0f90faacbe055bc339935c11da3b4232576c79a1126091edd715138"},{"@id":"4539d879-fcbf-5fa7-8e93-0bf3e201dbfc","@type":"cr:FileObject","name":"IDRiD_012.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/4539d879-fcbf-5fa7-8e93-0bf3e201dbfc/download","contentSize":"26673 B","sha256":"a02d567d1b61f88e5441ccafabcfaa94a474e2f350ee9eef0da509650f0c9c88"},{"@id":"afa1e9ec-52d4-5e51-92be-885099943e03","@type":"cr:FileObject","name":"IDRiD_013.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/afa1e9ec-52d4-5e51-92be-885099943e03/download","contentSize":"25643 B","sha256":"fb35245861b17cd168020d550195d68dcfbac4b679f0b83af2fa671045559130"},{"@id":"34eb7aae-6b59-59b8-b969-4f370940775d","@type":"cr:FileObject","name":"IDRiD_014.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/34eb7aae-6b59-59b8-b969-4f370940775d/download","contentSize":"25423 B","sha256":"cb445cb3503d1ecfdcba969fe85bbe6274bb0094a15ed10e6068baa60cb76855"},{"@id":"9b57c473-1608-50d2-a365-29b8815c28b3","@type":"cr:FileObject","name":"IDRiD_015.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/9b57c473-1608-50d2-a365-29b8815c28b3/download","contentSize":"20963 B","sha256":"015ba18d5a65de555f77e83ac932b551c62f9a352e7f1b278a250f2ec62a4136"},{"@id":"d7733038-2d3a-5355-88d2-6bfe58d714ec","@type":"cr:FileObject","name":"IDRiD_016.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/d7733038-2d3a-5355-88d2-6bfe58d714ec/download","contentSize":"21513 B","sha256":"cdfbb9b3b39305d59a6a4e5aa1223d88c75a6f9251105aa11831a46ba9103538"},{"@id":"f5ddeed6-b4fb-5319-a85c-411871da087f","@type":"cr:FileObject","name":"IDRiD_018.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/f5ddeed6-b4fb-5319-a85c-411871da087f/download","contentSize":"28893 B","sha256":"7dbee8de2378d5f81a0edbeb8ad8c73cfdb2b3675c0876b3a9ee431646184632"},{"@id":"1dd39ddb-5757-5558-b526-c718dd2b26ca","@type":"cr:FileObject","name":"IDRiD_029.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/1dd39ddb-5757-5558-b526-c718dd2b26ca/download","contentSize":"24918 B","sha256":"e273628ec184ff1bc610ed612dad8ec6ff7531ae1278dfa8be4ea01f1a74650e"},{"@id":"8b025587-dfcc-53fd-916d-9610479d0f8c","@type":"cr:FileObject","name":"IDRiD_030.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/8b025587-dfcc-53fd-916d-9610479d0f8c/download","contentSize":"25448 B","sha256":"29d98c6da3a4a7810e84c782aa2a841606b32eac1aaa2aaffa4dd67ba66e54c4"},{"@id":"eb22e984-1a21-5a3c-b073-e455ab253876","@type":"cr:FileObject","name":"IDRiD_032.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/eb22e984-1a21-5a3c-b073-e455ab253876/download","contentSize":"23164 B","sha256":"30064dbb85a7200b2b37e8f13d3e564941abd122057006967d1bee540cb11e3a"},{"@id":"bd44bfce-3b12-51b2-a4ca-2d0cac242d6e","@type":"cr:FileObject","name":"IDRiD_037.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/bd44bfce-3b12-51b2-a4ca-2d0cac242d6e/download","contentSize":"25665 B","sha256":"03f5ea7410d119d7256c7251396ed3dc617ff2a997bf33627a898fdbcd6ef571"},{"@id":"67515753-a762-5d08-aa58-d367f9802680","@type":"cr:FileObject","name":"IDRiD_038.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/67515753-a762-5d08-aa58-d367f9802680/download","contentSize":"23450 B","sha256":"a4106ed78b71f848e7fd62279fdf37e55bedfe241abf7264d173b43bbc01ba47"},{"@id":"26dfdb73-3e38-5fdf-be01-6b97fcaf22b7","@type":"cr:FileObject","name":"IDRiD_039.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/26dfdb73-3e38-5fdf-be01-6b97fcaf22b7/download","contentSize":"22911 B","sha256":"8d3ae89bb1f429e1ba69a294da769396897b40f898339c17604b3e3ea7e90ce5"},{"@id":"1145566c-daaa-56de-8add-408616bea564","@type":"cr:FileObject","name":"IDRiD_041.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/1145566c-daaa-56de-8add-408616bea564/download","contentSize":"26568 B","sha256":"d993def49faec44ace249c1cae95d8019c36936aec66a647bcd0cc60015e62ea"},{"@id":"e1c59632-afd7-50b4-a1e3-d9946fd185ce","@type":"cr:FileObject","name":"IDRiD_043.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/e1c59632-afd7-50b4-a1e3-d9946fd185ce/download","contentSize":"25375 B","sha256":"36e6e20344f882a42620fff5e3d154cb8536def6327bef55fe0754fa14c0f7bf"},{"@id":"93b00fd1-3f87-5d9c-892b-33430782b66e","@type":"cr:FileObject","name":"IDRiD_063.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/93b00fd1-3f87-5d9c-892b-33430782b66e/download","contentSize":"27398 B","sha256":"bd5f3458c3cd1d2a502d116a079151400c5ff0da2c92a6ecd98a7fb70785aa9f"},{"@id":"f37fb275-4732-5691-9ffa-b44355c14e9c","@type":"cr:FileObject","name":"IDRiD_073.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/f37fb275-4732-5691-9ffa-b44355c14e9c/download","contentSize":"22903 B","sha256":"36c3435e8a0a857e9ed20e2ca8aaa6d9d3f06ae54574436e1b38466be50f7f1e"},{"@id":"bd48d48e-9568-5519-a3a1-78771859accd","@type":"cr:FileObject","name":"IDRiD_074.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/bd48d48e-9568-5519-a3a1-78771859accd/download","contentSize":"25601 B","sha256":"25c152f10a94887af3d3a7a45039dfa1c18baf75c7b5d6340f0e0a28ce94f524"},{"@id":"5ed6fb1c-2639-55d3-9ba9-47810ea54950","@type":"cr:FileObject","name":"IDRiD_085.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/5ed6fb1c-2639-55d3-9ba9-47810ea54950/download","contentSize":"23223 B","sha256":"f6a4d6ed5e6aa425db337241b2383463d8798ef2df4872b909ad235bddfb979c"},{"@id":"1adb23a5-543b-5fb9-a195-f27eb31bc3e2","@type":"cr:FileObject","name":"IDRiD_101.jpg","encodingFormat":"image/jpeg","contentUrl":"/v2/catalog/datasets/idrid-grading-demo/distributions/1adb23a5-543b-5fb9-a195-f27eb31bc3e2/download","contentSize":"22354 B","sha256":"07eb061a5ac11628f627a8247344e2b385c53ae39f6d62b23f638827cfd0df01"}],"recordSet":[{"@type":"cr:RecordSet","@id":"disease-grading-labels","name":"Disease grading labels (held by the evaluation service)","description":"Per-image DR severity (0-4) and DME risk (0-2). VALUES ARE NOT PUBLISHED — they are the hidden ground truth the evaluation service scores against.","field":[{"@type":"cr:Field","@id":"labels/image_id","name":"image_id","dataType":"sc:Text"},{"@type":"cr:Field","@id":"labels/dr_grade","name":"dr_grade","description":"ICDR scale: 0 No DR; 1 Mild NPDR; 2 Moderate NPDR; 3 Severe NPDR; 4 Proliferative DR. Referable = grade >= 2.","dataType":["sc:Integer","cr:Label"]},{"@type":"cr:Field","@id":"labels/dme_risk","name":"dme_risk","dataType":["sc:Integer","cr:Label"]}]}],"bio:imagingModality":{"@type":"sc:DefinedTerm","name":"Colour fundus photography"},"bio:bodyRegion":{"@type":"sc:DefinedTerm","name":"Retina"},"bio:diseaseCondition":[{"@type":"sc:DefinedTerm","name":"Diabetic retinopathy","termCode":"9B71.0"}],"rai:dataAnnotationProtocol":"Two ophthalmologists (>25 yrs) graded independently; a third adjudicated disagreements (from source IDRiD).","bio:anonymizationLevel":"ANONYMIZED"}$manifest$::jsonb;
BEGIN
  INSERT INTO "catalog"."datasets" (
    id, slug, name, description, host_id, visibility, status,
    access_tier, commercial_use_terms, conformance_version, croissant, updated_at
  ) VALUES (
    ds_id, 'idrid-grading-demo', 'IDRiD — DR Grading (OCI demo slice)',
    'Downsampled 30-image slice of the IDRiD DR-grading testing set, hosted in OCI storage for the Phase C evaluation demo. Ground truth held by the evaluation service.',
    '00000000-0000-4000-8000-000000000099', 'PUBLIC', 'PUBLISHED', 'OPEN', 'OK', '1.1', payload, CURRENT_TIMESTAMP
  ) ON CONFLICT (slug) DO NOTHING;

  INSERT INTO "catalog"."dataset_versions" (
    id, dataset_id, version, croissant, published_by_id, published_at
  ) VALUES (
    ver_id, ds_id, '1.0.0', payload, '00000000-0000-4000-8000-000000000099', CURRENT_TIMESTAMP
  ) ON CONFLICT (dataset_id, version) DO NOTHING;

  INSERT INTO "catalog"."distributions" (
    id, dataset_version_id, croissant_id, content_url, content_type,
    content_size_bytes, content_hash_sha256, requires_access,
    storage_backend, s3_bucket, s3_key, upload_status
  ) VALUES
    ('03e84220-36b6-548f-8a92-8b070a1f0ad4'::uuid, ver_id, '03e84220-36b6-548f-8a92-8b070a1f0ad4',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/03e84220-36b6-548f-8a92-8b070a1f0ad4/download', 'image/jpeg', 16987, '501ba3f2874875e5d4ff33dd3f6b954d47a82c547bf53472efdef61f97e566d9',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/03e84220-36b6-548f-8a92-8b070a1f0ad4/IDRiD_001.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('2682fef1-21ba-5291-9991-a5476e8e582a'::uuid, ver_id, '2682fef1-21ba-5291-9991-a5476e8e582a',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/2682fef1-21ba-5291-9991-a5476e8e582a/download', 'image/jpeg', 20530, 'b095e0c6cbab4158b241447ada5574d71fec094a2a02972212acae2aa16a186b',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/2682fef1-21ba-5291-9991-a5476e8e582a/IDRiD_002.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('efa3cc6e-372a-54bd-8273-8db3db4f584e'::uuid, ver_id, 'efa3cc6e-372a-54bd-8273-8db3db4f584e',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/efa3cc6e-372a-54bd-8273-8db3db4f584e/download', 'image/jpeg', 20239, '6729d7ec7daa5304a7a3196f8e31ba126c00f93ad053c3de45932161c7f06b74',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/efa3cc6e-372a-54bd-8273-8db3db4f584e/IDRiD_003.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('ca381619-0af2-568a-9306-2464ed9d474d'::uuid, ver_id, 'ca381619-0af2-568a-9306-2464ed9d474d',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/ca381619-0af2-568a-9306-2464ed9d474d/download', 'image/jpeg', 25271, 'ff520a0741c7aed4ce6d79da9f98c6a43c4c660c8f9c97d21138ca7574e464c9',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/ca381619-0af2-568a-9306-2464ed9d474d/IDRiD_004.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('d96cf95d-564e-5972-9956-fde3ebaa6e47'::uuid, ver_id, 'd96cf95d-564e-5972-9956-fde3ebaa6e47',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/d96cf95d-564e-5972-9956-fde3ebaa6e47/download', 'image/jpeg', 19464, 'cb9bd9c344c5572a554da47240e98a2292137eb4feda15e79c487d54f0219a59',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/d96cf95d-564e-5972-9956-fde3ebaa6e47/IDRiD_005.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('620c5f0a-a00d-55a9-8111-225be9b53233'::uuid, ver_id, '620c5f0a-a00d-55a9-8111-225be9b53233',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/620c5f0a-a00d-55a9-8111-225be9b53233/download', 'image/jpeg', 24672, 'f04e7ebc4860703e151208f7629c4fa62768299cc0b76bc141b774174df8d627',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/620c5f0a-a00d-55a9-8111-225be9b53233/IDRiD_006.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('0a6a540b-9f4a-597e-99fc-b62b447bfaaf'::uuid, ver_id, '0a6a540b-9f4a-597e-99fc-b62b447bfaaf',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/0a6a540b-9f4a-597e-99fc-b62b447bfaaf/download', 'image/jpeg', 22241, 'aefcc482fd5fa5f225696a89c57148ecce7bafe5c0fc0b421a990a3de39b05ce',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/0a6a540b-9f4a-597e-99fc-b62b447bfaaf/IDRiD_007.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('71c63d39-cf30-5027-a41c-b8dbb7577cbf'::uuid, ver_id, '71c63d39-cf30-5027-a41c-b8dbb7577cbf',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/71c63d39-cf30-5027-a41c-b8dbb7577cbf/download', 'image/jpeg', 23144, 'c7ff2559ef9c528b33c927eed692ec97ff7d5a23c465b9f122ee53c2439d5f29',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/71c63d39-cf30-5027-a41c-b8dbb7577cbf/IDRiD_008.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('98bd2612-ded1-57c5-85f5-3f89511bb39a'::uuid, ver_id, '98bd2612-ded1-57c5-85f5-3f89511bb39a',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/98bd2612-ded1-57c5-85f5-3f89511bb39a/download', 'image/jpeg', 22857, 'f4c2c449a7c9b8eb594b9cbb399cd353860e59f920b79603520b063b51ab5d74',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/98bd2612-ded1-57c5-85f5-3f89511bb39a/IDRiD_009.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('4aa85e18-ae88-590d-a680-1e1b3da30bc8'::uuid, ver_id, '4aa85e18-ae88-590d-a680-1e1b3da30bc8',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/4aa85e18-ae88-590d-a680-1e1b3da30bc8/download', 'image/jpeg', 23742, '33f25841e7a12ae34a31e5429fa41b6ff2b20e0d5cf3d9b0e2796ca8a2886ad0',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/4aa85e18-ae88-590d-a680-1e1b3da30bc8/IDRiD_010.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('a5261cbc-58f5-5869-85c3-96c33c29484b'::uuid, ver_id, 'a5261cbc-58f5-5869-85c3-96c33c29484b',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/a5261cbc-58f5-5869-85c3-96c33c29484b/download', 'image/jpeg', 21234, '8c9c6316c0f90faacbe055bc339935c11da3b4232576c79a1126091edd715138',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/a5261cbc-58f5-5869-85c3-96c33c29484b/IDRiD_011.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('4539d879-fcbf-5fa7-8e93-0bf3e201dbfc'::uuid, ver_id, '4539d879-fcbf-5fa7-8e93-0bf3e201dbfc',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/4539d879-fcbf-5fa7-8e93-0bf3e201dbfc/download', 'image/jpeg', 26673, 'a02d567d1b61f88e5441ccafabcfaa94a474e2f350ee9eef0da509650f0c9c88',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/4539d879-fcbf-5fa7-8e93-0bf3e201dbfc/IDRiD_012.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('afa1e9ec-52d4-5e51-92be-885099943e03'::uuid, ver_id, 'afa1e9ec-52d4-5e51-92be-885099943e03',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/afa1e9ec-52d4-5e51-92be-885099943e03/download', 'image/jpeg', 25643, 'fb35245861b17cd168020d550195d68dcfbac4b679f0b83af2fa671045559130',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/afa1e9ec-52d4-5e51-92be-885099943e03/IDRiD_013.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('34eb7aae-6b59-59b8-b969-4f370940775d'::uuid, ver_id, '34eb7aae-6b59-59b8-b969-4f370940775d',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/34eb7aae-6b59-59b8-b969-4f370940775d/download', 'image/jpeg', 25423, 'cb445cb3503d1ecfdcba969fe85bbe6274bb0094a15ed10e6068baa60cb76855',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/34eb7aae-6b59-59b8-b969-4f370940775d/IDRiD_014.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('9b57c473-1608-50d2-a365-29b8815c28b3'::uuid, ver_id, '9b57c473-1608-50d2-a365-29b8815c28b3',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/9b57c473-1608-50d2-a365-29b8815c28b3/download', 'image/jpeg', 20963, '015ba18d5a65de555f77e83ac932b551c62f9a352e7f1b278a250f2ec62a4136',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/9b57c473-1608-50d2-a365-29b8815c28b3/IDRiD_015.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('d7733038-2d3a-5355-88d2-6bfe58d714ec'::uuid, ver_id, 'd7733038-2d3a-5355-88d2-6bfe58d714ec',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/d7733038-2d3a-5355-88d2-6bfe58d714ec/download', 'image/jpeg', 21513, 'cdfbb9b3b39305d59a6a4e5aa1223d88c75a6f9251105aa11831a46ba9103538',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/d7733038-2d3a-5355-88d2-6bfe58d714ec/IDRiD_016.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('f5ddeed6-b4fb-5319-a85c-411871da087f'::uuid, ver_id, 'f5ddeed6-b4fb-5319-a85c-411871da087f',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/f5ddeed6-b4fb-5319-a85c-411871da087f/download', 'image/jpeg', 28893, '7dbee8de2378d5f81a0edbeb8ad8c73cfdb2b3675c0876b3a9ee431646184632',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/f5ddeed6-b4fb-5319-a85c-411871da087f/IDRiD_018.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('1dd39ddb-5757-5558-b526-c718dd2b26ca'::uuid, ver_id, '1dd39ddb-5757-5558-b526-c718dd2b26ca',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/1dd39ddb-5757-5558-b526-c718dd2b26ca/download', 'image/jpeg', 24918, 'e273628ec184ff1bc610ed612dad8ec6ff7531ae1278dfa8be4ea01f1a74650e',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/1dd39ddb-5757-5558-b526-c718dd2b26ca/IDRiD_029.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('8b025587-dfcc-53fd-916d-9610479d0f8c'::uuid, ver_id, '8b025587-dfcc-53fd-916d-9610479d0f8c',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/8b025587-dfcc-53fd-916d-9610479d0f8c/download', 'image/jpeg', 25448, '29d98c6da3a4a7810e84c782aa2a841606b32eac1aaa2aaffa4dd67ba66e54c4',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/8b025587-dfcc-53fd-916d-9610479d0f8c/IDRiD_030.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('eb22e984-1a21-5a3c-b073-e455ab253876'::uuid, ver_id, 'eb22e984-1a21-5a3c-b073-e455ab253876',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/eb22e984-1a21-5a3c-b073-e455ab253876/download', 'image/jpeg', 23164, '30064dbb85a7200b2b37e8f13d3e564941abd122057006967d1bee540cb11e3a',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/eb22e984-1a21-5a3c-b073-e455ab253876/IDRiD_032.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('bd44bfce-3b12-51b2-a4ca-2d0cac242d6e'::uuid, ver_id, 'bd44bfce-3b12-51b2-a4ca-2d0cac242d6e',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/bd44bfce-3b12-51b2-a4ca-2d0cac242d6e/download', 'image/jpeg', 25665, '03f5ea7410d119d7256c7251396ed3dc617ff2a997bf33627a898fdbcd6ef571',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/bd44bfce-3b12-51b2-a4ca-2d0cac242d6e/IDRiD_037.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('67515753-a762-5d08-aa58-d367f9802680'::uuid, ver_id, '67515753-a762-5d08-aa58-d367f9802680',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/67515753-a762-5d08-aa58-d367f9802680/download', 'image/jpeg', 23450, 'a4106ed78b71f848e7fd62279fdf37e55bedfe241abf7264d173b43bbc01ba47',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/67515753-a762-5d08-aa58-d367f9802680/IDRiD_038.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('26dfdb73-3e38-5fdf-be01-6b97fcaf22b7'::uuid, ver_id, '26dfdb73-3e38-5fdf-be01-6b97fcaf22b7',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/26dfdb73-3e38-5fdf-be01-6b97fcaf22b7/download', 'image/jpeg', 22911, '8d3ae89bb1f429e1ba69a294da769396897b40f898339c17604b3e3ea7e90ce5',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/26dfdb73-3e38-5fdf-be01-6b97fcaf22b7/IDRiD_039.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('1145566c-daaa-56de-8add-408616bea564'::uuid, ver_id, '1145566c-daaa-56de-8add-408616bea564',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/1145566c-daaa-56de-8add-408616bea564/download', 'image/jpeg', 26568, 'd993def49faec44ace249c1cae95d8019c36936aec66a647bcd0cc60015e62ea',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/1145566c-daaa-56de-8add-408616bea564/IDRiD_041.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('e1c59632-afd7-50b4-a1e3-d9946fd185ce'::uuid, ver_id, 'e1c59632-afd7-50b4-a1e3-d9946fd185ce',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/e1c59632-afd7-50b4-a1e3-d9946fd185ce/download', 'image/jpeg', 25375, '36e6e20344f882a42620fff5e3d154cb8536def6327bef55fe0754fa14c0f7bf',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/e1c59632-afd7-50b4-a1e3-d9946fd185ce/IDRiD_043.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('93b00fd1-3f87-5d9c-892b-33430782b66e'::uuid, ver_id, '93b00fd1-3f87-5d9c-892b-33430782b66e',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/93b00fd1-3f87-5d9c-892b-33430782b66e/download', 'image/jpeg', 27398, 'bd5f3458c3cd1d2a502d116a079151400c5ff0da2c92a6ecd98a7fb70785aa9f',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/93b00fd1-3f87-5d9c-892b-33430782b66e/IDRiD_063.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('f37fb275-4732-5691-9ffa-b44355c14e9c'::uuid, ver_id, 'f37fb275-4732-5691-9ffa-b44355c14e9c',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/f37fb275-4732-5691-9ffa-b44355c14e9c/download', 'image/jpeg', 22903, '36c3435e8a0a857e9ed20e2ca8aaa6d9d3f06ae54574436e1b38466be50f7f1e',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/f37fb275-4732-5691-9ffa-b44355c14e9c/IDRiD_073.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('bd48d48e-9568-5519-a3a1-78771859accd'::uuid, ver_id, 'bd48d48e-9568-5519-a3a1-78771859accd',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/bd48d48e-9568-5519-a3a1-78771859accd/download', 'image/jpeg', 25601, '25c152f10a94887af3d3a7a45039dfa1c18baf75c7b5d6340f0e0a28ce94f524',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/bd48d48e-9568-5519-a3a1-78771859accd/IDRiD_074.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('5ed6fb1c-2639-55d3-9ba9-47810ea54950'::uuid, ver_id, '5ed6fb1c-2639-55d3-9ba9-47810ea54950',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/5ed6fb1c-2639-55d3-9ba9-47810ea54950/download', 'image/jpeg', 23223, 'f6a4d6ed5e6aa425db337241b2383463d8798ef2df4872b909ad235bddfb979c',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/5ed6fb1c-2639-55d3-9ba9-47810ea54950/IDRiD_085.jpg', 'READY'::"catalog"."DistributionUploadStatus"),
    ('1adb23a5-543b-5fb9-a195-f27eb31bc3e2'::uuid, ver_id, '1adb23a5-543b-5fb9-a195-f27eb31bc3e2',
     '/v2/catalog/datasets/idrid-grading-demo/distributions/1adb23a5-543b-5fb9-a195-f27eb31bc3e2/download', 'image/jpeg', 22354, '07eb061a5ac11628f627a8247344e2b385c53ae39f6d62b23f638827cfd0df01',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     'idrid-grading-demo/1adb23a5-543b-5fb9-a195-f27eb31bc3e2/IDRiD_101.jpg', 'READY'::"catalog"."DistributionUploadStatus")
  ON CONFLICT (id) DO NOTHING;
END $idrid_demo$;

-- ----------------------------------------------------------------------------
-- Section 5 — IDRiD DR-grading EVALUATION TASK (ADR-0017, Mode 1).
-- Binds the `idrid-grading-demo` dataset to a GRADING task and carries the
-- HIDDEN ground truth (30 images, ICDR grades 0-4; referable = grade >= 2).
-- Seeded here rather than via POST /v2/evaluation/tasks so the demo is
-- reproducible on any non-prod environment without an operator token.
-- Ground truth is never exposed by a read endpoint or a distribution.
-- ----------------------------------------------------------------------------

INSERT INTO "evaluation"."evaluation_tasks"
    (id, slug, name, dataset_slug, task_kind, num_classes, referable_threshold,
     ground_truth, created_at, updated_at)
VALUES (
    'cc3bc9ea-9506-54da-a571-7459684bbbdf'::uuid,
    'idrid-dr-grading',
    'IDRiD — diabetic retinopathy severity grading (demo)',
    'idrid-grading-demo',
    'GRADING'::"evaluation"."EvaluationTaskKind",
    5,
    2,
    '{"IDRiD_001":4,"IDRiD_002":4,"IDRiD_003":4,"IDRiD_004":4,"IDRiD_005":4,"IDRiD_006":3,"IDRiD_007":3,"IDRiD_008":2,"IDRiD_009":2,"IDRiD_010":2,"IDRiD_011":2,"IDRiD_012":2,"IDRiD_013":3,"IDRiD_014":3,"IDRiD_015":2,"IDRiD_016":3,"IDRiD_018":3,"IDRiD_029":0,"IDRiD_030":0,"IDRiD_032":4,"IDRiD_037":0,"IDRiD_038":0,"IDRiD_039":0,"IDRiD_041":0,"IDRiD_043":0,"IDRiD_063":1,"IDRiD_073":1,"IDRiD_074":1,"IDRiD_085":1,"IDRiD_101":1}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT (slug) DO NOTHING;

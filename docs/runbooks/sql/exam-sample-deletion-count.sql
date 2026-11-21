-- Deletion of a hosted sample: what is there (docs/runbooks/exam-sample-deletion.md).
--
-- Reads only. Run it before the deletion (the dry run) and again after
-- it (the proof). One row per kind of record, with what the deletion
-- does to it:
--   deleted  removed by exam-sample-deletion.sql
--   kept     stays, by design; named in the confirmation of deletion
--   blocks   must be 0, or exam-sample-deletion.sql refuses to run
--
-- Before running, replace the two placeholders in this file:
--   __DATASET_ID__    the dataset's id (a UUID)
--   __DATASET_SLUG__  the dataset's slug
--
-- One statement, so it runs the same from psql or any other client.

WITH target AS (
  SELECT '__DATASET_ID__'::uuid AS id, '__DATASET_SLUG__'::text AS slug
),
versions AS (
  SELECT v.id FROM catalog.dataset_versions v, target t WHERE v.dataset_id = t.id
),
campaigns AS (
  SELECT c.id, c.slug
    FROM annotation.annotation_campaigns c, target t
   WHERE c.dataset_id = t.id
      OR c.manifest_version_id IN (SELECT id FROM versions)
),
tasks AS (
  SELECT k.id FROM annotation.annotation_tasks k WHERE k.campaign_id IN (SELECT id FROM campaigns)
),
assignments AS (
  SELECT a.id FROM annotation.annotation_task_assignments a WHERE a.task_id IN (SELECT id FROM tasks)
),
requests AS (
  SELECT r.id FROM catalog.access_requests r, target t WHERE r.dataset_id = t.id
),
signatures AS (
  SELECT s.id FROM identity.dua_signatures s WHERE s.access_request_id IN (SELECT id FROM requests)
)
SELECT * FROM (
  SELECT 1 AS n, 'dataset' AS what, 'deleted' AS on_deletion,
         (SELECT count(*) FROM catalog.datasets d, target t WHERE d.id = t.id AND d.slug = t.slug) AS "rows"
  UNION ALL SELECT 2, 'dataset versions', 'deleted', (SELECT count(*) FROM versions)
  UNION ALL SELECT 3, 'distributions (files)', 'deleted',
         (SELECT count(*) FROM catalog.distributions d WHERE d.dataset_version_id IN (SELECT id FROM versions))
  UNION ALL SELECT 4, 'DICOM index: objects', 'deleted',
         (SELECT count(*) FROM catalog.dicom_objects o, target t WHERE o.dataset_id = t.id)
  UNION ALL SELECT 5, 'DICOM index: findings', 'deleted',
         (SELECT count(*) FROM catalog.dicom_findings f
           WHERE f.dicom_object_id IN (SELECT o.id FROM catalog.dicom_objects o, target t WHERE o.dataset_id = t.id))
  UNION ALL SELECT 6, 'DICOM index: series', 'deleted',
         (SELECT count(*) FROM catalog.dicom_series s, target t WHERE s.dataset_id = t.id)
  UNION ALL SELECT 7, 'annotation campaigns', 'deleted', (SELECT count(*) FROM campaigns)
  UNION ALL SELECT 8, 'annotation campaign instructions', 'deleted',
         (SELECT count(*) FROM annotation.annotation_campaign_instructions i WHERE i.campaign_id IN (SELECT id FROM campaigns))
  UNION ALL SELECT 9, 'annotation tasks', 'deleted', (SELECT count(*) FROM tasks)
  UNION ALL SELECT 10, 'annotation assignments and answers', 'deleted', (SELECT count(*) FROM assignments)
  UNION ALL SELECT 11, 'annotator calibration flags', 'deleted',
         (SELECT count(*) FROM annotation.annotator_calibration_flags f WHERE f.campaign_id IN (SELECT id FROM campaigns))
  UNION ALL SELECT 12, 'annotation tool callback receipts', 'deleted',
         (SELECT count(*) FROM annotation.annotation_tool_callback_receipts r
           WHERE r.response_body ->> 'assignmentId' IN (SELECT id::text FROM assignments))
  UNION ALL SELECT 13, 'access requests', 'deleted', (SELECT count(*) FROM requests)
  UNION ALL SELECT 20, 'signed data use agreements for those requests', 'blocks', (SELECT count(*) FROM signatures)
  UNION ALL SELECT 21, 'visas issued for those requests or for this dataset', 'blocks',
         (SELECT count(*) FROM identity.issued_passport_visas p, target t
           WHERE (p.context_type = 'access_request' AND p.context_ref IN (SELECT id::text FROM requests))
              OR (p.context_type = 'dua_signature' AND p.context_ref IN (SELECT id::text FROM signatures))
              OR (p.visa_type = 'ControlledAccessGrants' AND p.value = t.slug))
  UNION ALL SELECT 22, 'policy acceptances for those requests', 'blocks',
         (SELECT count(*) FROM identity.policy_acceptances p
           WHERE p.context_type = 'access_request' AND p.context_ref IN (SELECT id::text FROM requests))
  UNION ALL SELECT 23, 'files of OTHER datasets stored under this dataset''s prefix', 'blocks',
         (SELECT count(*) FROM catalog.distributions d
            JOIN catalog.dataset_versions v ON v.id = d.dataset_version_id, target t
           WHERE v.dataset_id <> t.id AND starts_with(d.s3_key, t.slug || '/'))
         + (SELECT count(*) FROM catalog.dicom_objects o, target t
             WHERE o.dataset_id <> t.id AND starts_with(o.s3_key, t.slug || '/'))
  UNION ALL SELECT 24, 'evaluation tasks that name this dataset', 'blocks',
         (SELECT count(*) FROM evaluation.evaluation_tasks e, target t WHERE e.dataset_slug = t.slug)
  UNION ALL SELECT 30, 'consent records for this dataset', 'kept',
         (SELECT count(*) FROM catalog.consent_records c, target t WHERE c.dataset_id = t.id)
  -- Found through the campaign rows, so this reads 0 once they are
  -- deleted although the events stay: note the number before, or read
  -- `relatedAuditEventsKept` in the audit record of the deletion.
  UNION ALL SELECT 31, 'audit events that mention the dataset or its campaigns', 'kept',
         (SELECT count(*) FROM platform.audit_events e, target t
           WHERE NOT (e.module = 'catalog' AND e.action = 'dataset.deleted')
             AND (e.subject_id = t.id::text
              OR e.payload ->> 'datasetSlug' = t.slug
              OR e.payload ->> 'campaignSlug' IN (SELECT slug FROM campaigns)
              OR e.subject_id IN (SELECT id::text FROM campaigns)
              OR e.subject_id IN (SELECT id::text FROM assignments)))
  UNION ALL SELECT 32, 'audit record of this deletion', 'kept',
         (SELECT count(*) FROM platform.audit_events e, target t
           WHERE e.module = 'catalog' AND e.action = 'dataset.deleted' AND e.subject_id = t.id::text)
) AS report
ORDER BY n;

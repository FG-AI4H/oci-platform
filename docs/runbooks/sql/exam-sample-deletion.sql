-- Deletion of a hosted sample: the database rows (docs/runbooks/exam-sample-deletion.md).
--
-- Removes one dataset and everything that hangs on it: its versions, its
-- files' rows, the DICOM index and findings, the annotation campaigns run
-- on it with their tasks and answers, and plain access requests. Writes
-- one audit event that records the deletion with counts.
--
-- It does NOT remove the files themselves: that is `pnpm purge-dataset-objects`,
-- an earlier step of the runbook. Rows first would lose the list of
-- what was stored.
--
-- Before running, replace the three placeholders in this file:
--   __DATASET_ID__    the dataset's id (a UUID)
--   __DATASET_SLUG__  the dataset's slug; must match the id, or nothing is done
--   __REFERENCE__     the reference of the signed deletion record, for
--                     example DEL-2026-12-21 (letters, digits, # . _ -)
--
-- One statement, so it is all or nothing: any refusal below leaves the
-- database exactly as it was. Run exam-sample-deletion-count.sql first.

DO $deletion$
DECLARE
  v_dataset_id   uuid := '__DATASET_ID__';
  v_slug         text := '__DATASET_SLUG__';
  v_reference    text := '__REFERENCE__';
  v_found_slug   text;
  v_versions     uuid[];
  v_campaigns    uuid[];
  v_campaign_slugs text[];
  v_tasks        uuid[];
  v_assignments  uuid[];
  v_requests     uuid[];
  v_signatures   uuid[];
  v_blocking     bigint;
  n_receipts     bigint;
  n_assignments  bigint;
  n_tasks        bigint;
  n_flags        bigint;
  n_instructions bigint;
  n_campaigns    bigint;
  n_requests     bigint;
  n_findings     bigint;
  n_objects      bigint;
  n_series       bigint;
  n_distributions bigint;
  n_versions     bigint;
  n_consents     bigint;
  n_audit        bigint;
  v_payload      text;
BEGIN
  -- 1. The right dataset, and nobody else changing it meanwhile.
  SELECT d.slug INTO v_found_slug FROM catalog.datasets d WHERE d.id = v_dataset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no dataset has the id %: nothing was deleted (already deleted? run the count)', v_dataset_id;
  END IF;
  IF v_found_slug <> v_slug THEN
    RAISE EXCEPTION 'dataset % has another slug than the one given: nothing was deleted', v_dataset_id;
  END IF;
  IF v_slug !~ '^[a-z0-9-]{3,80}$' THEN
    RAISE EXCEPTION 'the slug is not one the platform issues: nothing was deleted';
  END IF;
  IF v_reference !~ '^[A-Za-z0-9#._-]{1,80}$' THEN
    RAISE EXCEPTION 'the reference must be 1 to 80 letters, digits or # . _ - : nothing was deleted';
  END IF;

  v_versions := ARRAY(SELECT v.id FROM catalog.dataset_versions v WHERE v.dataset_id = v_dataset_id);
  v_campaigns := ARRAY(
    SELECT c.id FROM annotation.annotation_campaigns c
     WHERE c.dataset_id = v_dataset_id OR c.manifest_version_id = ANY (v_versions));
  v_campaign_slugs := ARRAY(SELECT c.slug FROM annotation.annotation_campaigns c WHERE c.id = ANY (v_campaigns));
  v_tasks := ARRAY(SELECT k.id FROM annotation.annotation_tasks k WHERE k.campaign_id = ANY (v_campaigns));
  v_assignments := ARRAY(SELECT a.id FROM annotation.annotation_task_assignments a WHERE a.task_id = ANY (v_tasks));
  v_requests := ARRAY(SELECT r.id FROM catalog.access_requests r WHERE r.dataset_id = v_dataset_id);
  v_signatures := ARRAY(SELECT s.id FROM identity.dua_signatures s WHERE s.access_request_id = ANY (v_requests));

  -- 2. Refuse what this procedure was not written for. A privately
  --    hosted sample has none of these; if one exists, a person decides.
  SELECT
      (SELECT count(*) FROM identity.dua_signatures s WHERE s.id = ANY (v_signatures))
    + (SELECT count(*) FROM identity.issued_passport_visas p
        WHERE (p.context_type = 'access_request' AND p.context_ref = ANY (v_requests::text[]))
           OR (p.context_type = 'dua_signature' AND p.context_ref = ANY (v_signatures::text[]))
           OR (p.visa_type = 'ControlledAccessGrants' AND p.value = v_slug))
    + (SELECT count(*) FROM identity.policy_acceptances p
        WHERE p.context_type = 'access_request' AND p.context_ref = ANY (v_requests::text[]))
    INTO v_blocking;
  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'access to this dataset was granted or signed for (% signed agreement, visa or acceptance row(s)): those are signed records and are not deleted by this procedure. Nothing was deleted', v_blocking;
  END IF;

  SELECT
      (SELECT count(*) FROM catalog.distributions d
         JOIN catalog.dataset_versions v ON v.id = d.dataset_version_id
        WHERE v.dataset_id <> v_dataset_id AND starts_with(d.s3_key, v_slug || '/'))
    + (SELECT count(*) FROM catalog.dicom_objects o
        WHERE o.dataset_id <> v_dataset_id AND starts_with(o.s3_key, v_slug || '/'))
    INTO v_blocking;
  IF v_blocking > 0 THEN
    RAISE EXCEPTION '% file row(s) of another dataset point into this dataset''s storage prefix: deleting the files would break them. Nothing was deleted', v_blocking;
  END IF;

  SELECT count(*) INTO v_blocking FROM evaluation.evaluation_tasks e WHERE e.dataset_slug = v_slug;
  IF v_blocking > 0 THEN
    RAISE EXCEPTION '% evaluation task(s) name this dataset. Nothing was deleted', v_blocking;
  END IF;

  -- 3. Annotations. A campaign cannot outlive its dataset (the foreign
  --    key refuses), so everything made on the sample goes with it.
  --    Answers the institution wants to keep are exported before this
  --    step; see the runbook.
  DELETE FROM annotation.annotation_tool_callback_receipts r
   WHERE r.response_body ->> 'assignmentId' = ANY (v_assignments::text[]);
  GET DIAGNOSTICS n_receipts = ROW_COUNT;
  DELETE FROM annotation.annotation_task_assignments a WHERE a.id = ANY (v_assignments);
  GET DIAGNOSTICS n_assignments = ROW_COUNT;
  DELETE FROM annotation.annotation_tasks k WHERE k.id = ANY (v_tasks);
  GET DIAGNOSTICS n_tasks = ROW_COUNT;
  DELETE FROM annotation.annotator_calibration_flags f WHERE f.campaign_id = ANY (v_campaigns);
  GET DIAGNOSTICS n_flags = ROW_COUNT;
  DELETE FROM annotation.annotation_campaign_instructions i WHERE i.campaign_id = ANY (v_campaigns);
  GET DIAGNOSTICS n_instructions = ROW_COUNT;
  DELETE FROM annotation.annotation_campaigns c WHERE c.id = ANY (v_campaigns);
  GET DIAGNOSTICS n_campaigns = ROW_COUNT;

  -- 4. The catalogue. Children first, so each count is what was removed.
  DELETE FROM catalog.access_requests r WHERE r.id = ANY (v_requests);
  GET DIAGNOSTICS n_requests = ROW_COUNT;
  DELETE FROM catalog.dicom_findings f
   WHERE f.dicom_object_id IN (SELECT o.id FROM catalog.dicom_objects o WHERE o.dataset_id = v_dataset_id);
  GET DIAGNOSTICS n_findings = ROW_COUNT;
  DELETE FROM catalog.dicom_objects o WHERE o.dataset_id = v_dataset_id;
  GET DIAGNOSTICS n_objects = ROW_COUNT;
  DELETE FROM catalog.dicom_series s WHERE s.dataset_id = v_dataset_id;
  GET DIAGNOSTICS n_series = ROW_COUNT;
  DELETE FROM catalog.distributions d WHERE d.dataset_version_id = ANY (v_versions);
  GET DIAGNOSTICS n_distributions = ROW_COUNT;
  DELETE FROM catalog.dataset_versions v WHERE v.id = ANY (v_versions);
  GET DIAGNOSTICS n_versions = ROW_COUNT;
  DELETE FROM catalog.datasets d WHERE d.id = v_dataset_id;

  -- 5. What stays, counted for the record.
  SELECT count(*) INTO n_consents FROM catalog.consent_records c WHERE c.dataset_id = v_dataset_id;
  SELECT count(*) INTO n_audit FROM platform.audit_events e
   WHERE e.subject_id = v_dataset_id::text
      OR e.payload ->> 'datasetSlug' = v_slug
      OR e.payload ->> 'campaignSlug' = ANY (v_campaign_slugs)
      OR e.subject_id = ANY (v_campaigns::text[])
      OR e.subject_id = ANY (v_assignments::text[]);

  -- 6. The record that the deletion happened: counts, the slug and the
  --    reference of the signed record. No file name, no identifier from a
  --    file, no header value. The payload is written in canonical JSON
  --    (RFC 8785: keys in order, no spaces) so that its hash is the one
  --    the platform's own audit writer would compute; every value below
  --    is a number or was checked above to need no escaping.
  v_payload := format(
    '{"accessRequests":%s,"annotationAssignments":%s,"annotationCampaigns":%s,"annotationTasks":%s,'
    || '"calibrationFlags":%s,"callbackReceipts":%s,"campaignInstructions":%s,"consentRecordsKept":%s,'
    || '"datasetSlug":"%s","datasetVersions":%s,"dicomFindings":%s,"dicomObjects":%s,"dicomSeries":%s,'
    || '"distributions":%s,"reference":"%s","relatedAuditEventsKept":%s,"runbook":"exam-sample-deletion"}',
    n_requests, n_assignments, n_campaigns, n_tasks,
    n_flags, n_receipts, n_instructions, n_consents,
    v_slug, n_versions, n_findings, n_objects, n_series,
    n_distributions, v_reference, n_audit);

  INSERT INTO platform.audit_events
    (module, action, subject_type, subject_id, actor_roles, payload, payload_hash)
  VALUES
    ('catalog', 'dataset.deleted', 'dataset', v_dataset_id::text, ARRAY['operator'],
     v_payload::jsonb, encode(sha256(convert_to(v_payload, 'UTF8')), 'hex'));

  RAISE NOTICE 'deleted dataset %: % version(s), % file row(s), % DICOM object(s), % finding(s), % series, % campaign(s), % task(s), % answer row(s), % access request(s)',
    v_dataset_id, n_versions, n_distributions, n_objects, n_findings, n_series,
    n_campaigns, n_tasks, n_assignments, n_requests;
END
$deletion$;

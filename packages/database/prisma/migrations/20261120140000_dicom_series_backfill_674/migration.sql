-- A row in `dicom_series` for every series indexed before the API
-- wrote them itself (#674, ADR-0026).
--
-- From this change on, indexing a file creates the row of its series.
-- Files indexed earlier have none, and a series without a row is not
-- listed. A deploy runs migrations after the new API is live, so by the
-- time this runs nothing is indexing without writing its series row.
--
-- Data only, and safe to run again: it inserts what is missing. If the
-- API is ever rolled back to a build older than this change and files
-- are indexed meanwhile, running this statement again repairs it.

INSERT INTO "catalog"."dicom_series" ("id", "dataset_id", "series_instance_uid")
SELECT gen_random_uuid(), s."dataset_id", s."series_instance_uid"
FROM (
    SELECT DISTINCT "dataset_id", "series_instance_uid"
    FROM "catalog"."dicom_objects"
    WHERE "series_instance_uid" IS NOT NULL
) AS s
ON CONFLICT ("dataset_id", "series_instance_uid") DO NOTHING;

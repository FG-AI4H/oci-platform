-- Add `modalities` (denormalised modality labels) to the Dataset row
-- so the campaign-create form can constrain task-kind picks against
-- the host-declared modality (#247).
--
-- Authoritative source remains the Croissant manifest (`croissant`
-- JSONB). This column is a read-cache, the same pattern as `duo_terms`
-- (PR J.1, #93). Re-extracted on every publish via the catalog
-- service's `publishVersion` path.
--
-- The mapping from these free-text labels to the curated canonical
-- modality set lives in `@oci/shared-types/modality-task-kinds`. Empty
-- arrays are treated as "host hasn't declared" — the form then allows
-- all task kinds and the API logs a warning rather than blocking the
-- campaign manager.

ALTER TABLE "catalog"."datasets"
    ADD COLUMN "modalities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill from the stored Croissant manifest's `bio:imagingModality`
-- / `imagingModality` (post-normalise form) / `bio:dataModality` /
-- `dataModality` slots. Each slot may be:
--   - an array of DefinedTerm objects (`[{name: "X-ray"}, ...]`)
--   - a single DefinedTerm object (`{name: "X-ray"}`)
--   - an array of plain strings (`["X-ray"]`)
-- We coerce each into a JSONB array, then extract `name` (preferred)
-- or `termCode` (fallback) — matching the runtime extractor in
-- `@oci/croissant/biocroissant/extract.ts`.
UPDATE "catalog"."datasets" d
SET "modalities" = sub.labels
FROM (
    SELECT
        d.id,
        ARRAY(
            SELECT DISTINCT label
            FROM (
                SELECT key
                FROM (VALUES
                    ('bio:imagingModality'),
                    ('imagingModality'),
                    ('bio:dataModality'),
                    ('dataModality')
                ) AS k(key)
            ) AS keys
            CROSS JOIN LATERAL (
                SELECT CASE
                    WHEN jsonb_typeof(d.croissant -> keys.key) = 'array'
                        THEN d.croissant -> keys.key
                    WHEN jsonb_typeof(d.croissant -> keys.key) = 'object'
                        THEN jsonb_build_array(d.croissant -> keys.key)
                    ELSE '[]'::jsonb
                END AS arr
            ) AS coerce
            CROSS JOIN LATERAL jsonb_array_elements(coerce.arr) AS elem
            CROSS JOIN LATERAL (
                SELECT
                    NULLIF(
                        TRIM(
                            COALESCE(
                                elem ->> 'name',
                                elem ->> 'termCode',
                                CASE
                                    WHEN jsonb_typeof(elem) = 'string'
                                        THEN elem #>> '{}'
                                    ELSE NULL
                                END
                            )
                        ),
                        ''
                    ) AS label
            ) AS extract
            WHERE extract.label IS NOT NULL
        ) AS labels
    FROM "catalog"."datasets" d
    WHERE d.croissant IS NOT NULL
) AS sub
WHERE d.id = sub.id
  AND cardinality(sub.labels) > 0;

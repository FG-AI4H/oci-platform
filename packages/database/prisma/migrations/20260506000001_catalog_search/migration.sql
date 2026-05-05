-- catalog v1.1 — full-text search index on `catalog.datasets`.
--
-- STORED tsvector column populated from name + slug + description, with
-- weighting:
--   A = name, slug    (highest match weight)
--   B = description
-- Plus a GIN index for sub-millisecond `@@` queries at any practical
-- catalog size. STORED (not VIRTUAL) so the GIN index can use it
-- directly; one extra column on disk per row, negligible compared to
-- the JSONB manifest.
--
-- Uses the `simple` tsvector dictionary (no stemming, no stop-words).
-- Health terms ("pneumonia", "MRI", "ICD-11", "DUO_0000006") fare
-- better with `simple` than with English stemming. Phase E may revisit
-- if multi-language search becomes a real ask.
--
-- Manifest keyword extraction (`croissant->'keywords'`) is NOT included
-- in v1 — Croissant allows keywords to be a string OR an array OR an
-- array of DefinedTerms; safely flattening that in a generated column
-- expression is awkward. Most useful description text already lives in
-- `description`, which hosts populate when they create a dataset.

ALTER TABLE "catalog"."datasets"
  ADD COLUMN "search_vector" tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce("name", '')), 'A') ||
      setweight(to_tsvector('simple', coalesce("slug", '')), 'A') ||
      setweight(to_tsvector('simple', coalesce("description", '')), 'B')
    ) STORED;

CREATE INDEX "datasets_search_vector_idx"
  ON "catalog"."datasets"
  USING GIN ("search_vector");

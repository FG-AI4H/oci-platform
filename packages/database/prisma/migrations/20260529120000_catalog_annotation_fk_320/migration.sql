-- Catalog ↔ annotation linkage: hard FKs + manifest-version pin (#320, ADR-0016).
--
-- ADR-0016 Decision 1+2: formalise the dataset linkage as a real FK and
-- pin the campaign to a specific Croissant manifest version
-- (catalog.dataset_versions). Sample-level linkage stays a validated
-- logical reference (no DatasetSample table) per ADR-0016 Decision 3.
--
-- The `dataset_id` soft→hard FK is the only data-risk step: it fails if
-- any existing campaign references a missing dataset. On dev that can't
-- happen — every campaign is created either by the seed (slug-join to a
-- real dataset) or by the API (which rejects unregistered datasets before
-- insert). We still add it defensively as NOT VALID + VALIDATE so a stray
-- orphan on an old cluster surfaces loudly at VALIDATE (short lock) rather
-- than during a long validating ADD CONSTRAINT. ON DELETE RESTRICT matches
-- the existing tool-integration FK: a dataset can't be deleted while a
-- campaign references it.

-- AddColumn: manifest-version pin (nullable; legacy campaigns resolve the
-- dataset's latest version at use, new campaigns default-pin the latest).
ALTER TABLE "annotation"."annotation_campaigns"
    ADD COLUMN "manifest_version_id" UUID;

-- CreateIndex
CREATE INDEX "annotation_campaigns_manifest_version_id_idx"
    ON "annotation"."annotation_campaigns" ("manifest_version_id");

-- AddForeignKey: manifest version → catalog.dataset_versions (plain — the
-- column is new and all-null, so no existing row can violate).
ALTER TABLE "annotation"."annotation_campaigns"
    ADD CONSTRAINT "annotation_campaigns_manifest_version_id_fkey"
    FOREIGN KEY ("manifest_version_id") REFERENCES "catalog"."dataset_versions" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: dataset → catalog.datasets (soft→hard). NOT VALID first so
-- the lock window is short, then VALIDATE surfaces any orphan loudly.
ALTER TABLE "annotation"."annotation_campaigns"
    ADD CONSTRAINT "annotation_campaigns_dataset_id_fkey"
    FOREIGN KEY ("dataset_id") REFERENCES "catalog"."datasets" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
    NOT VALID;

ALTER TABLE "annotation"."annotation_campaigns"
    VALIDATE CONSTRAINT "annotation_campaigns_dataset_id_fkey";

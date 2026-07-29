# `idrid-grading-demo` fixture

A small, downsampled slice of the **IDRiD** "Disease Grading" testing set, hosted in
OCI storage to demonstrate the catalogue → gated download → evaluation flow end to end
(the Phase C evaluation demo).

- **Source:** Indian Diabetic Retinopathy Image Dataset (IDRiD), Porwal et al., 2018.
- **Licence:** CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
- **Changes made:** 30 testing-set images selected (class-stratified across DR grades
  0–4) and **downsampled to 512 px**. Attribution + "changes made" note travel in
  `manifest.json` (`creator`, `license`, `citeAs`, `description`).

## Contents

| File                     | What it is                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IDRiD_*.jpg`            | 30 downsampled fundus images — the hosted distributions (uploaded to S3 by `apps/migrate/upload-fixtures.mjs`).                                               |
| `manifest.json`          | Croissant 1.1 + BIOCroissant manifest; `FileObject` distributions point at OCI `/download` URLs.                                                              |
| `test-labels.hidden.csv` | Ground truth (`Image,dr_grade,dme_risk`) for the **evaluation service**. Deliberately **not** listed in `distribution[]`, so the uploader never publishes it. |
| `seed.generated.sql`     | The `demo.sql` section (dataset + version + distribution rows). Already merged into `packages/database/seed/demo.sql`.                                        |
| `generate.mjs`           | Reproducible generator (Node-only, per CLAUDE.md rule 9).                                                                                                     |

> **Note on "hidden" labels:** IDRiD grades are public (CC BY 4.0), so committing them
> here is fine. For a _real_ sealed dataset (e.g. a partner hospital's data), the ground
> truth would **never** be committed or uploaded — it would stay host-side and be read by
> the evaluation service in place. This slice demonstrates the mechanics on open data.

## Regenerate

```bash
# needs macOS `sips` + `unzip`; downloads ~212 MB from Zenodo if IDRID_GRADING_ZIP is unset
IDRID_GRADING_ZIP="/path/to/B. Disease Grading.zip" \
  node packages/database/seed/fixtures/idrid-grading-demo/generate.mjs
# knobs: IDRID_SLICE_SIZE (default 30), IDRID_MAX_DIM (default 512)
```

## Publish to an environment

```bash
# 1. upload the image bytes (idempotent HEAD-then-PUT)
OCI_DATASETS_BUCKET=oci-<env>-datasets-<account> \
  SEED_FIXTURES_DIR=packages/database/seed/fixtures \
  node apps/migrate/upload-fixtures.mjs
# 2. the dataset/version/distribution rows land via demo.sql on the next non-prod deploy
```

# Demo-data seed

`packages/database/seed/demo.sql` is replayed against every **non-prod** environment on each deploy. It exists so dev and int always have a baseline of data (datasets, campaigns, future entities) without anyone needing to operate the UI to put them there.

In addition to seeding row data, the migrate task **also uploads bundled binary fixtures to the `oci-datasets-<env>` S3 bucket** before the SQL replay (the OCI-curated demo dataset `oci-demo-chest-xr` ships with 5 synthetic PNGs — see [`packages/database/seed/fixtures/oci-demo-chest-xr/`](../../packages/database/seed/fixtures/oci-demo-chest-xr/)). The upload is idempotent (HEAD-then-PUT) and runs only when `OCI_DATASETS_BUCKET` is set.

The seeded catalogue on dev / int is:

| Slug                       | Visibility / tier       | Manifest                                                       | Bytes                  |
| -------------------------- | ----------------------- | -------------------------------------------------------------- | ---------------------- |
| `idrid-grading-demo`       | PUBLIC / OPEN           | bundled fixture (CC BY 4.0 slice of IDRiD)                     | 30 JPEGs in S3         |
| `rsna-pneumonia-2018`      | PUBLIC / OPEN           | bundled fixture describing the upstream challenge dataset      | none (upstream only)   |
| `demo-clinical-notes-2024` | PUBLIC / OPEN           | bundled fixture, synthetic text-only placeholder, zero records | none                   |
| `oci-demo-chest-xr`        | RESTRICTED / REGISTERED | bundled fixture with DUO terms (DS + NCU), non-commercial      | 5 synthetic PNGs in S3 |
| `isic-2019-melanoma`       | RESTRICTED / REGISTERED | none (placeholder row)                                         | none                   |
| `uhz-cardiac-mri-2024`     | PRIVATE / CONTROLLED    | none (placeholder row)                                         | none                   |

`oci-demo-chest-xr` is the dataset to use when demonstrating access governance: a signed-in researcher sees the _restricted_ badge and the "Request access" CTA, the structured intended-use form, the DUO matcher verdict (UNCLEAR for non-commercial research because DS needs the host to confirm the disease; CONFLICT for commercial intent or an identity score below the REGISTERED tier) and the request in the host inbox. Anonymous callers do not see it at all; `idrid-grading-demo` is the anonymous hosted-download demo.

## Where the seed runs

| Environment | Runs?        | How                                                                                                                                                                                 |
| ----------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local       | On demand    | `pnpm --filter @oci/database db:seed:demo` (uses `DATABASE_URL`)                                                                                                                    |
| dev / int   | Every deploy | The `apps/migrate` ECS one-shot task runs `prisma migrate deploy` then, if `OCI_ENV != 'prod'`, replays `seed/demo.sql`. The task is launched by `.github/workflows/deploy.yml`.    |
| prod        | **Never**    | The migrate entrypoint short-circuits the seed when `OCI_ENV=prod`. Production seed data flows through the business-rule layer (`apps/api/scripts/seed-catalog.ts`, host-operated). |

## Rules for editing the seed

1. **Idempotent**. Every INSERT uses `ON CONFLICT (...) DO NOTHING`, with one exception: the `catalog.datasets` and `catalog.dataset_versions` rows of a **bundled fixture manifest** (rule 6 — today `oci-demo-chest-xr`, `idrid-grading-demo`, `rsna-pneumonia-2018` and `demo-clinical-notes-2024`) use `ON CONFLICT ... DO UPDATE SET croissant = EXCLUDED.croissant, ... WHERE <table>.croissant IS DISTINCT FROM EXCLUDED.croissant`, because the repo is the authority for those manifests and an edited `manifest.json` must reach an already-seeded environment. The other columns in that `SET` list (description, visibility, tier, terms) only refresh together with the manifest, so a governance change to a fixture dataset must be accompanied by a manifest change (in practice the `cr:consentCode` block moves with it). Distribution rows, placeholder datasets and everything else stay `DO NOTHING`; evaluation ground truth is never refreshed by this file. The re-run test is unchanged: a second run of the same file changes zero rows. The compact payload in `demo.sql` must be `JSON.stringify(manifest.json)`; `packages/croissant/test/seed-fixtures.spec.ts` pins the two equal for every fixture.
2. **Slug-keyed**. Never reference UUIDs literally; let the row's existing id flow through slug lookups.
3. **Order matters on first apply**. Reference data (datasets, tool integrations) goes before the entities that depend on it (campaigns, etc.).
4. **No real PHI**. The seed lands on every non-prod operator's local box. Synthetic bytes, placeholder rows, or manifests that _describe_ an upstream public dataset without hosting it (`rsna-pneumonia-2018`) only.
5. **`created_by_id` is intentionally fake**. The dev-stub `alice` UUID. Production seed never executes; this row is hypothetical in non-prod.
6. **Bundled fixtures.** A dataset that ships a manifest lives under [`packages/database/seed/fixtures/<slug>/`](../../packages/database/seed/fixtures/) with a `manifest.json` matching the Croissant 1.1 shape (it must validate with `@oci/croissant` at zero issues). When it also needs _bytes_, the files sit alongside and the migrate entrypoint uploads every `distribution[]` file to `s3://oci-datasets-<env>/<slug>/<@id>/<filename>`; stable UUIDs in the manifest's `@id` keep the upload + SQL paths in sync. A manifest with no `distribution[]` is legitimate (it describes an upstream dataset or an empty placeholder): the uploader logs "manifest has no distribution[] — skipping" and the SQL writes no distribution rows.
7. **A replay leaves alone what people did in between.** The seed runs again on every deploy, after participants and operators have used the seeded objects. `DO NOTHING` protects everything it inserts. The statements that _update_ a dataset row (the manifest refresh of rule 1 and the `modalities` backfill of Section 1) would not, because publishing a version through the API rewrites the same columns. Each of them therefore stops once the dataset has a version published by anyone other than the seed, which publishes as `00000000-0000-4000-8000-000000000099`. From then on the published manifest is the current one, and a manifest change in the repo reaches only the seed's own version row. The refresh of a version row is limited the same way, to rows the seed published. Give any new statement that updates an existing row the same guard. `apps/api/src/seed-profiles/demo-seed-replay.int.spec.ts` seeds a real Postgres, makes the changes people make (a scored submission, annotations, campaign status, published versions, an upload, an access request, model-card status), seeds again and fails if any row of any table changed. Add your entity to it.

## Adding a new demo entity

When a new module ships an entity that should exist on dev for manual testing:

1. Add a section to `packages/database/seed/demo.sql` following the conventions above.
2. Test locally:
   ```bash
   DATABASE_URL=postgresql://oci:oci@localhost:5432/oci_dev \
     pnpm --filter @oci/database db:seed:demo
   ```
3. Re-run to confirm idempotency:
   ```bash
   DATABASE_URL=... pnpm --filter @oci/database db:seed:demo
   ```
   Row count should not change.
4. PR. Next dev / int deploy will pick up the new rows automatically — no GHA workflow change needed.

## When the seed feels too tight

The SQL-only seed works for simple inserts. When you reach for one of these you've outgrown it:

- **Cascading inserts that need business-rule validation** (e.g. publish a manifest, run the DUO matcher). Use `apps/api/scripts/seed-catalog.ts` instead — it goes through the HTTP API.
- **Conditional inserts based on application logic**. Move the seed to a TypeScript script using the Prisma client. The migrate image would gain a sidecar runtime — separate PR.
- **Per-environment differences**. The demo SQL is identical across dev and int. Content that belongs to one environment and one occasion goes in a **seed profile** (next section), not in `demo.sql`.

## Seed profiles

A seed profile is a second seed file with its own fixture set, under `packages/database/seed/profiles/<name>/`. It is replayed by the migrate task **after** the demo seed, and only on an environment that lists it:

| Setting                                                | Where                                      | Default         |
| ------------------------------------------------------ | ------------------------------------------ | --------------- |
| `seedProfiles` of the environment                      | `infra/cdk/lib/environments.ts`            | `[]` everywhere |
| `OCI_SEED_PROFILES` on the migrate task (from the row) | set by CDK only when the list is not empty | unset           |

With the list empty, the migrate task runs the same commands and the same SQL as before profiles existed, and the task definition is unchanged. A profile is never replayed on prod: the entrypoint does not seed there, and CDK refuses a profile listed for prod at synth time.

What the migrate task does for each listed profile:

1. **Readiness check** (`apps/migrate/seed-profile-check.mjs`). Every file the profile's manifests list must be either bundled in the image or already in the datasets bucket, with the size and the sha256 the manifest states. A profile that is not ready is **skipped with one line in the log and the deploy continues**. A profile whose `selection.json` says `"standIn": true` is never replayed on a deployed environment.
2. **Bundled files** are uploaded by `upload-fixtures.mjs` in profile mode, which stores the sha256 with the object.
3. **`seed.sql`** is replayed in one transaction. A failure here does fail the migrate task and the deploy, like a failure of `demo.sql`: it means the SQL is wrong or the stored evaluation answer key differs from the repository (#464).

Rules: the same as for `demo.sql` (replayable, a second run changes no row, slug-keyed, no real patient data in the repository). In addition, a profile's files are **generated**: change the inputs or the generator, never the output.

## The `radiology-workshop` profile

Content for the December 2026 radiology workshop ([#644](https://github.com/FG-AI4H/oci-platform/issues/644)). Off on every environment until the real images have been prepared.

| Object          | Slug                         | What it is                                                                                                                                   |
| --------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Dataset         | `nih-chestxray14-workshop`   | 200 chest radiographs from NIH ChestX-ray14, at most 1024 px, PUBLIC / OPEN, with `metadata.csv` and three teaching files                    |
| Evaluation task | `nih-chestxray14-finding`    | One finding, present or absent. `CLASSIFICATION` with two classes: 0 absent, 1 present                                                       |
| Campaign        | `nih-chestxray14-reading`    | Reading exercise: 60 tasks on 60 of the images, three readers per image, French instructions and labels, `taskTimeoutHours: 1`, status READY |
| Model cards     | `workshop-cxr-model-a`, `-b` | Fictional teaching entries: A is PUBLISHED with a complete intended-use statement, B is a DRAFT                                              |

**What is in the repository today is a synthetic stand-in**: 200 placeholder images drawn by a script (not committed, 13 MB), invented metadata and invented labels. It exists so the profile can be built, seeded and reset before any real file is fetched. `selection.json` says `"standIn": true`.

**The reading campaign.**

- **Pinned** to version 1.0.0 of the slice.
- **Labels**, the answers a reader can give (`workflowConfig.classificationLabels`, [#646](https://github.com/FG-AI4H/oci-platform/issues/646)): « Absent » on key 1 and « Présent » on key 2, stored as `0` and `1`, the classes of the evaluation task, and « Non interprétable » on key 0, stored as `cannot-assess`. Readers may add a comment. A campaign seeded before the labels existed gets them on the next replay; a declared set is never overwritten.
- **Tasks.** The seed creates one task per image flagged `"campaign": true` in `selection.json`, 60 in all. Creating them from the campaign page is not possible here: `tasks/from-dataset` selects by file-name prefix and a count, and the reading subset is a balanced draw spread over the whole slice. Each task points at `file:<distribution id>`, the hosted image in the pinned version. The SQL finds that id from the file's name and sha256, so it holds when the real images replace the stand-in, and it fails the seed if an image of the subset is not hosted in the pinned version. A replay never adds a task twice.
- **Status READY.** Readers are served only while the campaign is RUNNING. The facilitator presses **Start** on the campaign page in the room (a campaign manager account); until then a reader's queue says the campaign is not running yet.

**Not created by the seed:**

- **The evaluation method.** A result on the task is pinned to the latest version of the reference predictions method, `oci-predictions-scoring` ([#583](https://github.com/FG-AI4H/oci-platform/issues/583)). A migration registers it in every environment, `DECLARED`, so the profile does not repeat it. Nothing approves it: in the review exercise ([#649](https://github.com/FG-AI4H/oci-platform/issues/649)) a reviewer approves it in the browser, and the task's results move from provisional to published. The same version serves every predictions task on the environment, the demo tasks included.
- **Accounts.** They are created from a roster with `pnpm provision-users` (see [admin-user-management.md](./admin-user-management.md)). Give exactly one account the group `arbitration-annotator` **and no other reading group**: a user who is both reader and arbiter is only ever given reading tasks.

### Files of the profile

| File                                          | Role                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `selection.json`                              | **Input.** The images, where each was fetched from and what it hashed to, sex, age band, reading subset |
| `reference-labels.hidden.csv`                 | **Input.** The hidden reference labels. Never uploaded: it is not in the fixture directory              |
| `fixtures/<slug>/manifest.json`               | Generated. Croissant 1.1; record set of image id, sex and age band                                      |
| `fixtures/<slug>/metadata.csv`, `model-*.csv` | Generated. Bundled in the image and uploaded by the migrate task                                        |
| `seed.sql`, `reset.json`                      | Generated. The SQL replayed on deploy; the objects the reset may touch                                  |

`pnpm radiology-workshop check` fails when a generated file differs from what the inputs produce, and CI runs the same comparison as a test.

**Hidden labels.** They are in the evaluation task's answer key (`evaluation.evaluation_tasks.ground_truth`, never returned by an endpoint), in `seed.sql` and in the hidden CSV, exactly as for the IDRiD demo task. They are not in the manifest, in `metadata.csv` or in any distribution. The two valid teaching files are built from them and give most labels away, which is accepted for a teaching task.

**Teaching files.** Models A and B make the same number of missed findings and of false alarms, so their overall accuracy, sensitivity and specificity are identical. Model A's errors are spread over sex and age band; model B's are concentrated in the **60+** age band. Model C contains unknown identifiers, labels outside the range, duplicates and missing items, for the format check.

### Preparing the real data

Nothing below downloads anything by itself except `fetch --base-url`. Each download is a decision of the dataset's host.

1. **Obtain the inputs**: the NIH metadata file and, for the preferred label source, the adjudicated label file. Read the README shipped in the NIH download.
2. **Select.** Deterministic, with a fixed seed. Six strata (sex by age band 18-39, 40-59, 60+) of equal size, 40% of each with the finding, one image per patient, posterior-anterior films only. It stops, without selecting anything, if a cell cannot be filled.
   ```bash
   pnpm radiology-workshop select --metadata <Data_Entry file> \
     --label-source adjudicated --labels <label file> --finding "Airspace opacity" \
     --finding-fr "Opacité alvéolaire"
   # or, with the labels NIH mined from the reports (weak; the dataset page then says so):
   pnpm radiology-workshop select --metadata <Data_Entry file> \
     --label-source report-mined --finding <NIH finding name> --finding-fr <French name>
   ```
3. **Record the README** in `selection.json`, under `source.readme`: its file name, the date and its text. `generate` refuses real data until this is done; until then the manifest carries a marked placeholder that does not present anyone else's wording as the README's.
4. **Fetch, verify, resize.** From a directory holding the 200 files, or from a base address:
   ```bash
   pnpm radiology-workshop fetch --source-dir <dir> --work-dir <dir> --pin \
     --fetched-from "<where the files came from>"
   ```
   `--pin` records the sha256 of each file as fetched; later runs must get the same bytes or stop. A file within 1024 px is hosted byte for byte; a larger one is shrunk.
5. **Generate and review**: `pnpm radiology-workshop generate --work-dir <dir>`, then read the diff.
6. **Upload** the prepared files to the `dev` datasets bucket, under the operator role: `pnpm radiology-workshop upload --work-dir <dir> --bucket <bucket>`. It checks every file against `selection.json` first and refuses a bucket whose name contains `prod`.
7. **Switch the profile on** for `dev` in `infra/cdk/lib/environments.ts` (`seedProfiles: ['radiology-workshop']`) in the same pull request as the regenerated profile. The next deploy seeds it.

### Reset

Removes what people created **on the workshop objects**, between the rehearsal and the first day, or between two days: evaluation submissions on the task, and on the campaign every assignment (readers' answers, arbitration answers, images still open, expired and skipped ones) and the calibration flags. The 60 tasks are put back at the first reading, and a running or completed campaign goes back to READY, as seeded: the facilitator presses **Start** again for the next session. **Kept:** accounts, the dataset and its files, the answer key, the campaign with its pinned version, labels, 60 tasks and instructions, the model cards, everything on every other dataset, task and campaign, and the audit trail.

**Not reset: the method review.** A decision recorded on `oci-predictions-scoring` during the rehearsal stays: a decision is published with its reason and is not undone. To run the review exercise again, an administrator declares a new version of the method with the same declarations and the next number. New submissions are pinned to it, and are provisional until a reviewer approves it, on every predictions task of the environment. Results already scored keep the version they were pinned to.

**A full reset after a rehearsal needs both:** this reset, for the submissions and the reading campaign, and a new method version, for the review exercise. The reset deletes the task's submissions, each pinned to a method version, and writes nothing to the method, its versions or their review.

It is a one-off launch of the migrate task with `OCI_SEED_RESET` set, which then runs the reset and nothing else (no migration, no seed):

```bash
SPEC=$(aws ssm get-parameter --name /oci/dev/migrate/launch-spec --query Parameter.Value --output text)
aws ecs run-task --launch-type FARGATE \
  --cluster "$(echo "$SPEC" | jq -r .cluster)" \
  --task-definition "$(echo "$SPEC" | jq -r .taskDefinition)" \
  --network-configuration "awsvpcConfiguration={subnets=[$(echo "$SPEC" | jq -r '.subnets | join(",")')],securityGroups=[$(echo "$SPEC" | jq -r '.securityGroups | join(",")')],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"migrate","environment":[{"name":"OCI_SEED_RESET","value":"radiology-workshop"}]}]}'
```

- **This is a dry run.** It prints, in the task's log stream (`migrate/migrate/<task-id>`), how many rows each step would remove, and changes nothing.
- **To apply**, add `{"name":"OCI_SEED_RESET_CONFIRM","value":"radiology-workshop@dev"}` to the same list. Read the dry run first.
- It runs on `dev` and on a local stack only. Any other environment name is refused before a connection is opened, and so is a database address containing `prod`.
- Every statement is bound to the ids of the profile's own task and campaign (`reset.json`), in one transaction.

## Reference

- File: [`packages/database/seed/demo.sql`](../../packages/database/seed/demo.sql)
- Profiles: [`packages/database/seed/profiles/`](../../packages/database/seed/profiles/), generator in [`scripts/radiology-workshop/`](../../scripts/radiology-workshop/)
- Runner: [`apps/migrate/entrypoint.sh`](../../apps/migrate/entrypoint.sh)
- Local script: `pnpm --filter @oci/database db:seed:demo`
- HTTP-layer alternative: [`apps/api/scripts/seed-catalog.ts`](../../apps/api/scripts/seed-catalog.ts)

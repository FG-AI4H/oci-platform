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
- **Per-environment differences**. Currently the SQL is identical across dev and int. If they diverge meaningfully, add an `OCI_ENV` parameter to the entrypoint and pick the file accordingly.

## Reference

- File: [`packages/database/seed/demo.sql`](../../packages/database/seed/demo.sql)
- Runner: [`apps/migrate/entrypoint.sh`](../../apps/migrate/entrypoint.sh)
- Local script: `pnpm --filter @oci/database db:seed:demo`
- HTTP-layer alternative: [`apps/api/scripts/seed-catalog.ts`](../../apps/api/scripts/seed-catalog.ts)

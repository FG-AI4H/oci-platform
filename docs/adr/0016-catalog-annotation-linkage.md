# ADR-0016: Catalog ↔ annotation linkage contract

- **Status:** accepted
- **Date:** 2026-05-29
- **Deciders:** Marc Lecoultre (OCI Platform lead)
- **Tags:** `area:annotation` `area:catalog` `area:governance`

## Context

[ADR-0006](./0006-annotation-integration-hub-orchestrator.md) Decision 6 committed the annotation module to a **three-level foreign key** to the catalog: `Dataset.id` + `DatasetManifest.id` (immutable on the campaign) + `DatasetSample.id`, with completed campaigns writing annotations back as a new distribution.

When the time came to implement that linkage ([#223](https://github.com/FG-AI4H/oci-platform/issues/223)), the catalog's actual data model diverged from those names:

- The catalog has `Dataset`, **`DatasetVersion`** (the versioned Croissant 1.1 manifest, with `croissantHash`), and `Distribution` (a FileObject/FileSet inside a manifest). There is **no `DatasetManifest` model** — `DatasetVersion` _is_ the manifest version.
- There is **no `DatasetSample` model at all.** Samples are modelled the Croissant way — as records inside the manifest's `RecordSet`s — not materialised as rows. `AnnotationTask.sampleRef` is therefore free text, and `AnnotationCampaign.datasetId` is a soft FK (no relation).

So ADR-0006 Decision 6 cannot be implemented literally. The open question is the **sample granularity**: do we materialise every catalog sample as a `DatasetSample` row so `Task.sampleRef` can be a hard FK? For OCI's target datasets — petabyte-scale, external-S3-mounted, and federated (see [#89](https://github.com/FG-AI4H/oci-platform/issues/89)) — materialising a row per sample is infeasible and duplicates what the Croissant manifest already authoritatively describes.

This ADR reconciles ADR-0006 Decision 6 with the built catalog and resolves the sample-granularity question so #223 can proceed.

## Decision

**1. "Manifest version" = `catalog.DatasetVersion`.** A campaign pins the exact manifest it runs against: `AnnotationCampaign.manifestVersionId` is a **hard FK to `catalog.DatasetVersion`**, **immutable once `status = RUNNING`** (enforced in the campaign service; mutation attempts after start are a 409).

**2. Dataset linkage is a hard FK.** `AnnotationCampaign.datasetId` → `catalog.Dataset` becomes a real relation + DB foreign key. A campaign can no longer reference a non-existent dataset.

**3. Samples are referenced logically, not materialised.** `AnnotationTask.sampleRef` stays a **logical reference** — a Croissant `recordSet/record` URI or content-addressed id — that is **validated at campaign-seed time** against the pinned `DatasetVersion`'s Croissant `RecordSet`s. We do **not** add a `DatasetSample` table or a sample-level DB FK. Sample-ref integrity is _validated, not constrained_.

**4. Write-back is a new catalog distribution.** On campaign completion, the annotation output's Croissant-RAI entry (from `@oci/annotation-persistence`, [ADR-0008](./0008-annotation-persistence-and-provenance.md) / [#218](https://github.com/FG-AI4H/oci-platform/issues/218)) is written back as a new `catalog.Distribution` on a new `DatasetVersion`, so the federation harvester ingests it with no manual step.

**5. Re-publish keeps in-flight campaigns frozen.** Because a campaign pins a `manifestVersionId`, re-publishing a dataset (a new `DatasetVersion`) does not disturb running campaigns; new campaigns target the latest version.

This **supersedes the literal `DatasetManifest` / `DatasetSample` naming** in ADR-0006 Decision 6; the intent (no stale/missing dataset refs, manifest immutability mid-flight, write-back closes the federation loop) is preserved.

## Consequences

### Positive

- Closes the cross-module FK gap at the levels that have rows (dataset + manifest version) **without a sample-row explosion**, so the linkage works for petabyte / external-S3 / federated datasets.
- Manifest immutability on a running campaign prevents schema drift mid-flight; provenance stays reproducible.
- Write-back reuses the #218 Croissant-RAI derivation — one source of truth for the annotation distribution.

### Negative

- **Sample-ref integrity is validated, not DB-constrained.** A manifest mutation that removed a record _after_ seed time wouldn't be caught by the database — but manifest immutability (Decision 1) makes that path unreachable for a running campaign, so the residual risk is a seed-time validation bug, not a structural hole.
- Converting `Campaign.datasetId` from soft to hard FK requires existing dev rows to reference real datasets (a one-time data check before the constraint is added).

### Neutral

- `Task.sampleRef` semantics are now defined (a manifest-resolvable record reference) rather than opaque free text.
- Write-back depends on gate-3 fusion ([#216](https://github.com/FG-AI4H/oci-platform/issues/216)); it lands when fusion does.

## Alternatives considered

- **Materialise a `DatasetSample` row per sample (literal ADR-0006).** Rejected: doesn't scale to petabyte / federated datasets, duplicates the Croissant manifest, and forces an ingestion step the catalog deliberately avoided.
- **Keep `datasetId`/`sampleRef` as soft refs with API-only validation (status quo).** Rejected for the dataset + manifest levels: a hard FK is cheap there and the DoD ([#223](https://github.com/FG-AI4H/oci-platform/issues/223)) requires "cannot create a campaign referencing a non-existent dataset/manifest." Kept only for the sample level, where a hard FK isn't feasible.
- **(Chosen)** Hard FK at dataset + manifest-version; validated logical reference at sample; write-back as a new distribution.

## References

- [ADR-0006](./0006-annotation-integration-hub-orchestrator.md) Decision 6 (superseded naming), [ADR-0008](./0008-annotation-persistence-and-provenance.md) (write-back form), [ADR-0002](./0002-metadata-conformance.md) (Croissant manifest model)
- Issues: [#223](https://github.com/FG-AI4H/oci-platform/issues/223) (this work), [#89](https://github.com/FG-AI4H/oci-platform/issues/89) (external-S3 scale), [#216](https://github.com/FG-AI4H/oci-platform/issues/216) (gate-3 fusion → write-back)

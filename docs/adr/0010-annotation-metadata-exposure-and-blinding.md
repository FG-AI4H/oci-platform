# ADR-0010: Annotation metadata exposure + blinding policy

- **Status:** accepted
- **Date:** 2026-05-16
- **Deciders:** Marc Lecoultre (OCI Platform lead)
- **Tags:** `area:annotation` `area:governance` `area:security`

## Context

Catalog samples carry rich metadata — modality, body part, acquisition parameters, demographic facets, prior diagnoses, original radiologist reports, scanner make, hospital of origin. A subset of this metadata is **necessary** for the annotator to do the task at all (you can't annotate a slice without knowing it's axial vs sagittal); a different subset is **dangerous** to expose because it primes the annotator toward a finding (telling them "patient has diabetes" inflates retinopathy detection rates in a well-documented pattern).

Three forces make this an ADR-level decision rather than an implementation detail:

1. **Priming / suggestion bias is documented across medical-imaging literature.** Annotators told a patient's diagnosis before reading the image hallucinate findings consistent with that diagnosis. This is the strongest single argument for default-hidden metadata; the effect is robust across radiology, pathology, dermatology.
2. **Demographic-fairness artefacts encode through annotation.** If annotators can see ethnicity / hospital / scanner during gate-1 reading, the resulting model can pick up those signals as proxies — even when the model developer didn't intend it. Hiding demographic facets at gate 1 protects against this without requiring every annotator to ignore them on trust.
3. **Regulatory posture.** IRB-approved studies and FDA AI/ML SaMD submissions routinely require blinded reading for ground-truth establishment. Defaulting to it eases regulatory submissions (per [[ADR-0008]]'s conformance posture); requiring it later would be a costly retrofit.

Beyond blinding, **task-routing must be metadata-aware**. [ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md) Decision 1 step 5 catches class-label clustering (annotator X sees all positives), but doesn't catch metadata-facet clustering (annotator X sees only Hospital A scans, or only one scanner make). When a confounder facet correlates with the outcome, this is just as biasing as raw class clustering. The bias-prevention rule needs to extend.

Finally, **the audit trail must record what the annotator saw**. Without it, "did this annotator see the prior diagnosis when they made this call?" is unanswerable, and the regulator-facing posture of [ADR-0008](./0008-annotation-persistence-and-provenance.md) is incomplete.

This ADR locks the policy.

## Decision

### 1. Four metadata buckets per sample

Every metadata field on a catalog sample falls into exactly one of four buckets per campaign:

| Bucket       | Default for                                                                                                                                                                                                                 | Behaviour                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **required** | Fields needed to interpret the sample at all (modality, body part, view orientation, slice index, acquisition parameters when interpretation-relevant, the clinical question being asked)                                   | Always shipped to the annotator UI. Campaign manager cannot suppress these for a campaign that uses the sample.                                                                                        |
| **optional** | Fields that may be useful for some tasks but biasing for others (bucketed patient age, sex when relevant, hospital site when the finding is site-specific)                                                                  | Hidden by default; campaign manager opts in per field with a documented rationale.                                                                                                                     |
| **hidden**   | Fields that are biasing or irrelevant (prior diagnoses, original radiologist reports, peer annotators' labels at the same gate, demographic facets unrelated to the finding, scanner make when not interpretation-relevant) | Hidden by default; campaign manager can promote individual fields to `optional` with rationale, but the default for gate-1 reading remains hidden.                                                     |
| **never**    | PHI and direct identifiers (patient name, MRN, exact DOB, exact dates, identifying photos, any field tagged HIPAA-Safe-Harbor)                                                                                              | **Server-side filtered.** Never present in the handoff payload regardless of campaign config. The catalog's data-governance layer enforces this; the annotation API verifies a second time at handoff. |

**Bucket source-of-truth** is a per-field annotation in the campaign's metadata-visibility config, sourced in this priority order:

1. Campaign-manager override at campaign creation (documented per field with rationale).
2. Dataset host's Croissant manifest field-level `oci:annotationVisibility` tag (OCI extension to Croissant 1.1; documented in `docs/for-hosts/croissant-extensions.md` — to be added under E14).
3. OCI-platform default visibility table (shipped as a YAML config + Zod schema in `@oci/annotation`), keyed by common field semantic types — applies when neither (1) nor (2) is set.

The four buckets are visible to the campaign manager as a checklist at campaign-create time, with the default-applied values prefilled and the documented overrides editable inline.

### 2. Gate-progressive unblinding

Within a single campaign, the visibility profile **changes by gate** — the deeper the review, the more context the reviewer needs:

| Gate                                | Default visibility                                                                                                                                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gate 1 — Independent annotation** | `required` only. Peer annotators' labels at this gate hidden by default + as a hard server-side rule for CONTROLLED / SENSITIVE-tier campaigns.                                                                                                |
| **Gate 2 — Arbitration**            | `required` + `optional`. Peer-1 annotations visible (that's the point of arbitration). `hidden` fields remain hidden unless campaign manager explicitly promotes them.                                                                         |
| **Gate 3 — Expert review**          | `required` + `optional` + campaign-manager-promoted subset of `hidden`. The expert may see prior diagnoses or radiology reports if the campaign manager judges that necessary for the final call. The visibility set is logged per annotation. |

**Training-grade campaigns** (per ADR-0009 Decision 1 — campaigns marked as "training-grade" or "no-expertise-required") can override the default by promoting more fields at gate 1, since the goal there is calibration, not blinded ground-truth establishment.

### 3. Metadata-facet bias prevention (extends ADR-0009 Decision 1)

The 1.5× soft cap in [ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md) Decision 1 step 5 (class-balance) extends to **any metadata facet declared as a stratification key in the campaign config**.

Stratification keys at campaign-create time include (by default, when available in the manifest):

- `class` (the existing class-balance check, unchanged)
- `metadata.hospital_id` or `metadata.site_id` (when the catalog has it)
- `metadata.scanner_make` and `metadata.scanner_model`
- Bucketed demographic facets when the campaign manager opts in: `age_bin`, `sex`

For each declared stratification key, the router enforces: no single annotator may see more than `⌈total_samples / n_active_annotators⌉ × 1.5` samples carrying any single value of that key. Same mechanic as the class-balance check, evaluated independently per declared key.

The stratification keys are **not** required to be in the `optional` or `required` metadata buckets — facets used for stratification can still be hidden from the annotator (the router knows the value; the UI never sees it). This is the whole point: distribute samples evenly across hospitals without ever telling the annotator which hospital a given sample came from.

### 4. Audit trail of visible metadata

Every `Annotation` row acquires a `metadataExposureProfile` field recording what the annotator saw at annotation time:

```
metadataExposureProfile {
  visibilityConfigHash    : sha256 of the campaign-visibility config at annotation time
  visibilityConfigVersion : the campaign config version that was active
  deliveredFields         : array of field names actually shipped to the UI for this sample
                            (filtered server-side from the sample's full metadata set)
}
```

The `visibilityConfigHash` ties the row to an immutable record of the visibility policy in effect; the `deliveredFields` capture which fields were actually delivered to this specific annotator-sample pair (since `optional` fields may have been suppressed by campaign-manager filter rules). The campaign-visibility config is versioned + append-only — same pattern as the campaign workflow config in [ADR-0006](./0006-annotation-integration-hub-orchestrator.md).

This satisfies the regulator-facing question: "for this annotation, what did the annotator see?" The hash + fields list reconstructs the exposure exactly.

## Consequences

### Positive

- **Priming bias reduced by default.** Annotators don't see prior diagnoses or radiologist reports at gate 1 unless the campaign manager explicitly opts in (with documented rationale). The strongest single source of measurement error in annotation projects gets caught at the system level, not at the per-annotator level.
- **Demographic-fairness protection by design.** Hidden by default means the annotator can't encode the hospital / scanner / demographic into the label. Cross-platform datasets become more comparable.
- **Regulator-friendly out of the box.** Blinded-reading-by-default is the IRB / FDA / EMA expectation for AI/ML SaMD ground-truth establishment. Submissions can cite this ADR + the per-annotation audit trail rather than designing blinding ad hoc.
- **Metadata-aware bias prevention closes a real gap** in ADR-0009. Annotator A no longer ends up with all Hospital B scans by accident, even when the catalog mixes sites.
- **Hidden fields can still drive routing.** Stratification keys can be `hidden` from the UI — the router uses the value, the annotator never sees it. Best of both worlds.
- **Audit trail is reconstruction-grade.** The `metadataExposureProfile` + immutable campaign-visibility config history answer the "what did they see?" question for any historical annotation.

### Negative

- **Campaign-manager configuration burden.** Every campaign needs a visibility config. The OCI default table covers most fields automatically, but each campaign requires a "did I think about this?" pass. The UI surfaces the defaults so the burden is recognition-level, not generation-level.
- **Some annotators will push back.** "I can't do my job without knowing the patient's history" is a real concern — addressed by gate-2 / gate-3 progressive unblinding and per-campaign overrides. Annotators receive training on why blinded gate-1 reading exists.
- **Server-side metadata filtering adds latency at handoff.** The metadata bundle is composed at handoff time, not pre-baked. For very large per-sample metadata sets, this is non-zero. Acceptable for the audit benefit.
- **Croissant 1.1 doesn't have a standard visibility annotation.** OCI ships an extension (`oci:annotationVisibility`); the per-host onboarding docs need to explain it. If/when ML Croissant or RAI extends to cover annotation-side visibility, OCI's extension can be retired in favour of the standard.

### Neutral

- The visibility config is part of the campaign config — same governance as workflow config, IRR thresholds, retention policy. No new approval flow.
- The `metadataExposureProfile` adds a small column to every Annotation row. Storage cost is bounded; the field list is short.
- "Never-shown" PHI filtering is **redundant** with the catalog's existing data-governance layer ([ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md)). This ADR confirms the second enforcement layer at the annotation API as a defence-in-depth measure — not a new restriction.
- Stratification keys that aren't actually present in the catalog manifest are silently skipped; the router doesn't fail.

## Alternatives considered

- **Default-show (all fields visible, opt-out to hide).** Rejected — priming bias is a real and documented effect; defaulting to show makes every campaign manager responsible for catching every confounder, which they will miss. Default-hide flips the burden the right way.
- **Single binary "blinded / unblinded" toggle.** Rejected — too coarse. Real campaigns need some fields shown (modality), some hidden (prior diagnoses), and some unblinded at gate 3 (expert review). Four buckets + gate-progression captures this without ceremony.
- **Annotator self-blinding** ("we'll show everything; annotators should mentally ignore irrelevant fields"). Rejected — humans can't unsee what they've seen. The Stroop literature on this is unambiguous.
- **Visibility decided at the dataset level, not the campaign level.** Rejected — the same dataset can serve campaigns with different blinding needs (a tumour-grading campaign needs different blinding than a presence/absence campaign). Per-campaign config is the right granularity.
- **Skip metadata-facet bias prevention; rely on per-campaign-manager review.** Rejected — same reason ADR-0009 rejected pure manual bias review: it only becomes visible after the campaign completes. The router-time check is mechanical.
- **Don't record the visibility profile per annotation, just the campaign config version.** Rejected — `optional` fields may be filtered per-sample per-annotator (e.g. if the campaign manager later promotes a field but the historical annotations should still reflect what was visible at their time). Per-row exposure profile is the right grain.

## Amendments to prior ADRs

- **[ADR-0007](./0007-annotation-tool-integration-contract.md)** — the **handoff payload** acquires a `metadataBundle` structure with `required` and `optional` subkeys (and never anything from the `hidden` or `never` buckets). The presigned sample URL is unchanged; the bundle ships alongside it. The bundle's structure is part of the per-tool `schemaProfile`. ADR-0007 acquires an "Amendments" section noting this cross-reference.
- **[ADR-0008](./0008-annotation-persistence-and-provenance.md)** — the **provenance schema** acquires a `metadataExposureProfile` field per Annotation row (Decision 4 above). The hash chain extends to cover this field. ADR-0008 acquires an "Amendments" entry.
- **[ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md)** — Decision 1 step 5 (class-balance check) extends to **any declared stratification key**. The 1.5× soft cap applies per-key, evaluated independently. ADR-0009 acquires an "Amendments" entry.

## References

- [ADR-0006](./0006-annotation-integration-hub-orchestrator.md) — orchestrator model + role + catalog linkage.
- [ADR-0007](./0007-annotation-tool-integration-contract.md) — tool-integration contract; amended by this ADR for handoff payload.
- [ADR-0008](./0008-annotation-persistence-and-provenance.md) — persistence + provenance; amended by this ADR for exposure-profile audit trail.
- [ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md) — task-routing + multi-rater policy; amended by this ADR for metadata-facet bias prevention.
- [ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md) — `accessTier` + the data-governance layer that handles PHI / Safe-Harbor filtering at the catalog boundary.
- ITU-T FG-AI4H DEL05-A03 (2023-01-28) — DRAFT data-annotation standard (silent on blinding policy; this ADR adds the layer).
- ICH GCP E6(R2) §6.4 — clinical-trial blinding terminology (single-blind / double-blind / open-label) that informs the gate-progressive model.
- US HIPAA Safe Harbor identifier list — the 18 identifiers that fall into the `never` bucket and are server-side filtered.
- Croissant 1.1 — base manifest; the `oci:annotationVisibility` field-level extension lives in `docs/for-hosts/croissant-extensions.md`.

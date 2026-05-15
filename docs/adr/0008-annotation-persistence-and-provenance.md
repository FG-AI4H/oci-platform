# ADR-0008: Annotation persistence, provenance, and retention

- **Status:** accepted
- **Date:** 2026-05-15
- **Deciders:** Marc Lecoultre (OCI Platform lead)
- **Tags:** `area:annotation` `area:governance` `area:operations`

## Context

[ADR-0006](./0006-annotation-integration-hub-orchestrator.md) commits the annotation module to owning persistence, audit trail, and provenance — the part of the work no editor / viewer plug-in handles. [ADR-0007](./0007-annotation-tool-integration-contract.md) commits to schema-validated annotation submission from any adapter. This ADR specifies what gets persisted, in what forms, with what provenance, and for how long.

Three families of downstream consumers determine the persistence shape:

1. **Medical-imaging consumers + regulators** — speak DICOM. They expect structured outputs: TID-1500 measurement reports, TID-1410/1411 ROI annotations, SEG for segmentation masks. The competitive landscape (surveyed in the internal planning archive) shows that **only the medical-imaging-native stack (3D Slicer, OHIF, MD.ai, MONAI Label) round-trips DICOM SR/SEG/RT-STRUCT**. Encord, V7, and others load DICOM as pixels and emit JSON/COCO, discarding the structured semantics. OCI must preserve them.
2. **Clinical / EHR / interoperability consumers** — speak FHIR. They expect Observation resources for the label content and ImagingSelection / ImagingStudy / BodyStructure for the region pointers. FHIR R5 is current.
3. **ML training pipelines + the OCI federated catalog** — speak Croissant. Completed annotation campaigns must contribute back to the catalog as a new distribution per Croissant 1.1 + RAI; that distribution then propagates through the existing federation harvester.

The DRAFT standard (ITU-T FG-AI4H DEL05-A03, 2023-01-28) specifies a 3-gate SOP with configurable IRR thresholds but is silent on persistence formats, signing, retention, and Croissant interop. The standards + research review (in the internal planning archive) gives:

- Default IRR metric for variable-rater scenarios: **Krippendorff α**, threshold ≥ 0.80 release / ≥ 0.667 publishable floor.
- For segmentation: **Dice + Hausdorff** per Metrics Reloaded (Maier-Hein et al.).
- Retention for medical-device-associated data: **EU MDR baseline = 10 years (non-implantable) / 15 years (implantable)**, per Article 10.

The legacy implementation has no provenance recording beyond annotator ID and timestamp; no signed receipts; no retention enforcement; no DICOM SR or FHIR export. This ADR adds all of it.

## Decision

### Three canonical persistence forms

Every accepted (post-fusion, post-gate-3) annotation is persisted in three canonical forms, derived from a single internal source-of-truth:

| Form                                    | Use                                                  | Source standard                                                                                                     |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **DICOM SR (Structured Reporting)**     | Medical-imaging consumers + regulators               | TID-1500 for measurement reports (classification); TID-1410 for 2D ROI (bbox / polygon / mask); TID-1411 for 3D ROI |
| **DICOM SEG**                           | Multi-frame segmentation masks                       | Standalone DICOM SEG object referenced from the SR                                                                  |
| **FHIR Observation + ImagingSelection** | Clinical / EHR / interoperability                    | FHIR R5; Observation for the label, ImagingSelection for the region pointer                                         |
| **Croissant-RAI envelope**              | ML training pipelines + federated catalog write-back | Croissant 1.1 + RAI extension; the annotation distribution becomes a new entry on the catalog's `DatasetManifest`   |

Internal source-of-truth = a Postgres JSONB column on the `Annotation` table, validated against a **versioned Zod schema profile** matched to the tool integration version (per [ADR-0007](./0007-annotation-tool-integration-contract.md)). The three canonical forms are derived on demand (and cached) by the `@oci/annotation-persistence` package; they are not stored in parallel.

### Per-modality implementation order

Persistence implementation is incremental, not all-at-once:

1. **Phase B.A.3 (Q4)** — DICOM SR + FHIR + Croissant-RAI for `image-2d` and `image-3d` modalities (the modalities OCI's first dataset hosts target).
2. **Phase C+** — video, audio, text, multimodal as each modality enters production use. Adapters declare their `outputFormats`; the persistence package's per-modality mapping is added incrementally.

### Provenance — recorded with every annotation

Every `Annotation` row carries:

- **Annotator** — GA4GH Passport `sub` claim, role at submission, organization (if any), via the identity module ([ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md))
- **Tool** — `AnnotationToolIntegration.id` + version FK (per [ADR-0007](./0007-annotation-tool-integration-contract.md))
- **Schema** — Zod schema version that validated the payload
- **Time** — `createdAt`, `durationSeconds` (time-on-task), `irrSampleTag` (whether this annotation contributes to IRR)
- **Hash chain** — SHA-256 over the JSONB payload + provenance, linked to the previous annotation in the same task (Merkle-style chain so any retroactive tamper is detectable)
- **Signed receipt** — KMS-CMK signature over the hash, for CONTROLLED and SENSITIVE-tier datasets. Same pattern as click-wrap policy receipts ([#118](https://github.com/FG-AI4H/oci-platform/issues/118)) and DocuSeal AdES receipts ([#128](https://github.com/FG-AI4H/oci-platform/issues/128)). The receipt ARN is stored on the row; the signed material lives in S3 with Object Lock.

The audit event log is append-only and hash-chained at the table level; supervisor actions (suspend annotator, override gate decision) emit dedicated event rows for regulator queries.

### IRR policy — defaults locked, per-campaign override

The 3-gate SOP's "decision boxes" use IRR scores keyed to task type:

| Task type                           | Default IRR metric                  | Default release threshold | Default publishable floor |
| ----------------------------------- | ----------------------------------- | ------------------------- | ------------------------- |
| Classification — nominal, 2 raters  | Cohen's κ                           | 0.80                      | 0.667                     |
| Classification — nominal, >2 raters | Fleiss' κ                           | 0.80                      | 0.667                     |
| Classification — ordinal            | Krippendorff α (ordinal)            | 0.80                      | 0.667                     |
| Detection / segmentation            | Dice + Hausdorff (Metrics Reloaded) | Dice ≥ 0.85               | Dice ≥ 0.75               |
| Localization (keypoint, landmark)   | Euclidean distance < ε              | per-campaign              | per-campaign              |
| Multi-rater variable-n fallback     | Krippendorff α                      | 0.80                      | 0.667                     |

**Krippendorff α is the universal fallback** — it handles missing raters and arbitrary measurement levels.

Thresholds are configurable per campaign at creation time; the defaults above are the "I don't know" starting point. The `@oci/annotation-quality` package (pure functions, unit-tested) implements every metric.

### Retention — EU MDR baseline

| Dataset clinical-use claim          | Retention floor                          |
| ----------------------------------- | ---------------------------------------- |
| Non-implantable medical device data | **10 years** post-last-use               |
| Implantable medical device data     | **15 years** post-last-use               |
| Non-clinical / research-only        | Per-campaign override (default: 5 years) |

The clinical-use claim is sourced from the catalog Dataset's `accessTier` + `clinicalUseClaim` fields (governed by [ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md)). Per-campaign overrides are allowed only to **lengthen** the retention period, never shorten — retention is a one-way ratchet.

After the retention period elapses, annotations are subject to lifecycle deletion via a scheduled job that respects any active legal hold (via `Annotation.legalHoldUntil`). The hash-chain integrity is preserved by archiving the hash + provenance metadata indefinitely, even when the payload is deleted.

### Conformance posture

vs. ITU-T FG-AI4H DEL05-A03 DRAFT: **partial / extended**. OCI conforms to the 3-gate SOP and the IRR-metric-by-task-type framing; takes deliberate stances on the DRAFT's TBDs (label fusion = median for continuous / majority-vote with seniority tie-break for categorical; post-processing = none in the platform layer; expert-review decision is final, no rejection loop); and adds the layers the DRAFT omits (DICOM SR / FHIR / Croissant-RAI persistence; hash-chained audit trail; KMS-CMK signed receipts; EU MDR retention floor).

vs. ISO/IEC 5259-3: full conformance on the data quality processes for annotation. The "OCI default" labels in the conformance doc make the OCI-specific stances explicit so a future standard revision can be adopted without breaking existing data.

## Consequences

### Positive

- **Three-stack interop.** Medical-imaging, clinical, and ML consumers each get the form they speak. No lossy translation through a wrong-shape intermediate.
- **Federation closes the loop.** Completed campaigns contribute back to the catalog as new Croissant distributions; the federation harvester propagates them to peer hosts automatically.
- **Regulator-grade audit.** Hash chain + KMS-CMK signed receipts give tamper-detection and non-repudiation. The append-only event log gives a complete history of every gate decision and supervisor action.
- **Retention is a one-way ratchet** — extensions allowed, shortening blocked at the schema level. Reduces operational risk of accidental early deletion.
- **The default IRR policy is conservative and well-justified.** Krippendorff α + Dice + Hausdorff are the post-Metrics-Reloaded consensus. The publishable floor of 0.667 is the lowest threshold any reputable medical-imaging dataset publishes.
- **Per-modality incremental rollout** keeps the persistence package's combinatorial complexity manageable. Image-2D and image-3D come first; other modalities follow as the platform's dataset mix evolves.

### Negative

- **DICOM SR + FHIR + Croissant-RAI per modality is real work.** Each new modality means a per-template mapping; some modalities have no clean DICOM SR equivalent (text, audio) and will rely on FHIR + Croissant only. The conformance posture handles this — "DICOM SR if applicable, otherwise FHIR + Croissant" — but the per-modality matrix needs to be filled in incrementally.
- **The hash chain creates ordering constraints.** Annotations within a task can't be re-ordered after the fact; corrections are appended as new rows with a `correctsAnnotationId` pointer, not in-place edits. Operators need to be trained on this.
- **15-year retention for implantable-device annotations is a real cost** at the storage layer. S3 Glacier Deep Archive is the natural home for cold annotations; lifecycle rules transition them automatically.
- **Krippendorff α defaults aren't right for every campaign.** Campaigns with hand-tuned thresholds need to opt out at creation time; documentation has to make this discoverable.

### Neutral

- The `@oci/annotation-quality` and `@oci/annotation-persistence` packages live in-tree for now; OSS extraction is a follow-up if/when a community signal emerges.
- Pre-annotation results flow through the same persistence pipeline as human annotations, distinguished by a `source: HUMAN | PRE_ANNOTATION | MODEL_ASSIST` provenance field.
- Active learning (Phase C+) uses the IRR scores + gold-standard sample tags as its query strategy input; no separate active-learning data model required.

## Alternatives considered

- **Single canonical form (e.g. JSON only) with on-the-fly translation to DICOM SR / FHIR / Croissant.** Rejected — different consumers expect different shapes; lazy translation makes interop fragile and adds latency at consumer time. Eager derivation with caching is the right shape.
- **Shorter retention period (e.g. 3 or 5 years for everything).** Rejected — EU MDR's 10-year floor for non-implantable medical-device data is the binding minimum for OCI's regulator-facing posture. We have to meet it.
- **In-place mutability for annotations** (edit, don't append correction). Rejected — breaks hash-chain integrity; tamper-detection becomes meaningless.
- **Annotator-only provenance** (skip tool version + schema version). Rejected — without tool/schema versioning, the legacy "this annotation was made with Visian 1.2 not 1.3, no, wait, was it?" ambiguity returns.
- **Skip the Croissant-RAI envelope** (just write DICOM SR + FHIR). Rejected — federation + ML-training-pipeline interop both depend on Croissant; the catalog's federation harvester only speaks Croissant.
- **Use a different IRR metric default** (e.g. Cohen's κ everywhere). Rejected — Cohen's κ doesn't handle >2 raters or missing values; Krippendorff α handles both. The papers ([`standards-papers.md`](../planning/inputs/standards-papers.md)) are unanimous on this for variable-rater medical-imaging campaigns.
- **Sign every annotation** (not just CONTROLLED/SENSITIVE-tier). Rejected — the KMS-CMK call cost adds up; only the regulator-facing tiers need non-repudiation. OPEN/REGISTERED tiers get hash-chain only.

## References

- [ADR-0006](./0006-annotation-integration-hub-orchestrator.md) — orchestrator model + role + catalog linkage.
- [ADR-0007](./0007-annotation-tool-integration-contract.md) — tool-integration contract + schema profiles.
- [ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md) — `accessTier` + `clinicalUseClaim` driving retention.
- ITU-T FG-AI4H DEL05-A03 (2023-01-28) — 3-gate SOP + IRR metric-by-task-type framing.
- ISO/IEC 5259-2:2024 — AI data quality measures.
- ISO/IEC 5259-3:2024 — AI data quality processes.
- EU Regulation 2017/745 (MDR) — Article 10 retention requirements.
- DICOM PS3.16 Annex A — Structured Reporting templates (TID-1500 / 1410 / 1411).
- HL7 FHIR R5 — Observation + ImagingSelection.
- Croissant 1.1 + RAI extension.
- Maier-Hein et al., "Metrics reloaded: Recommendations for image analysis validation" (2024).
- Krippendorff, K. — "Content Analysis: An Introduction to Its Methodology" (4th ed., 2019).

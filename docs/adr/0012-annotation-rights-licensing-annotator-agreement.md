# ADR-0012: Annotation rights, licensing, and the annotator agreement

- **Status:** accepted
- **Date:** 2026-05-16
- **Deciders:** Marc Lecoultre (OCI Platform lead)
- **Tags:** `area:annotation` `area:governance` `area:legal`

## Context

Before any annotation campaign runs, the platform needs a settled legal position on four questions:

1. **Who owns the annotation?** Without an explicit assignment, copyright defaults to the annotator (per [Oregon State research-data guidance](https://guides.library.oregonstate.edu/research-data-services/data-licensing-ip)). OCI can't redistribute work it doesn't own.
2. **Under what license is the annotation distribution released?** Croissant 1.1 + RAI ([ADR-0008](./0008-annotation-persistence-and-provenance.md)) requires a `license` field; downstream consumers need machine-readable terms.
3. **What does the annotator consent to?** The platform instruments annotation work extensively — intra-rater resampling ([ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md) Decision 5), metadata-exposure-profile capture ([ADR-0010](./0010-annotation-metadata-exposure-and-blinding.md) Decision 4), IRR scoring ([ADR-0008](./0008-annotation-persistence-and-provenance.md), [ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md) Decision 4), full audit trail ([ADR-0008](./0008-annotation-persistence-and-provenance.md)). The annotator must consent to all of this on the record.
4. **GDPR posture for the annotator identity.** An annotator may later invoke right-to-be-forgotten (Article 17). The audit-trail / hash-chain commitments in [ADR-0008](./0008-annotation-persistence-and-provenance.md) conflict with naïve identity deletion.

[Industry norm](<https://www.friedfrank.com/uploads/siteFiles/Publications/Data%20as%20IP%20and%20Data%20License%20Agreements%20(1).pdf>) for medical annotation: work-for-hire vesting in the campaign/platform + explicit consent + machine-readable license declaration. This ADR locks the OCI position.

## Decision

### 1. Annotator agreement: work-for-hire with consent disclosures

Every annotator signs an **annotator agreement** before they can join any campaign. The agreement is delivered + signed via the existing DocuSeal AdES flow ([#128](https://github.com/FG-AI4H/oci-platform/issues/128), [ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md) Decision 5).

Two variants by relationship:

| Variant                 | Used for                                                     | Terms                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Work-for-hire**       | Paid annotators with an employment / contractor relationship | All annotation IP vests in OCI under US 17 USC §101 / equivalent. Annotator receives compensation per the per-campaign rate; no residual rights.                                                                                                                                |
| **Contributor licence** | Volunteer / academic annotators with no paid relationship    | Annotator grants OCI a non-revocable royalty-free license to use, modify, and redistribute the annotation under the campaign's chosen output license. Equivalent to Apache-2.0-CLA shape. Annotator retains attribution rights (opt-in named attribution per Decision 4 below). |

The agreement version is captured on every Annotation row as part of provenance ([ADR-0008](./0008-annotation-persistence-and-provenance.md)). Agreement versions are immutable + content-addressed (sha256 of the rendered DocuSeal template).

### 2. Consent disclosures (mandatory section in both variants)

The agreement explicitly discloses + obtains consent for:

- **Intra-rater resampling** — 5 % of the annotator's completed work will be silently re-presented after a blind ≥ 7-day delay for QA ([ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md) Decision 5). The annotator acknowledges they may be looking at a sample they've seen before.
- **Metadata-exposure profile capture** — what was visible to them is logged per annotation ([ADR-0010](./0010-annotation-metadata-exposure-and-blinding.md) Decision 4). Used for regulator-facing audit.
- **IRR scoring** — running per-modality + per-annotation-type scores ([ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md) Decision 4). Low scores can result in supervisor review or removal from the campaign.
- **Audit trail** — every annotation + supervisor action recorded immutably ([ADR-0008](./0008-annotation-persistence-and-provenance.md)) with retention floors per EU MDR (10 / 15 years).
- **Right-to-be-forgotten posture** (Decision 5 below) — RTBF removes attribution but does not remove the contribution itself.

### 3. Output dataset license declaration

Every campaign declares a license for its output annotation distribution at creation time. The license is captured in the resulting Croissant-RAI distribution's `license` field ([ADR-0008](./0008-annotation-persistence-and-provenance.md) persistence) and is **immutable** once the campaign starts running.

| License option            | When to use                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **`CC-BY-4.0`** (default) | Academic medical-data norm; balanced re-use + attribution requirement                                             |
| `CC-BY-NC-4.0`            | Datasets restricted from commercial use (donor-imposed terms, IRB conditions)                                     |
| `CC-BY-SA-4.0`            | Datasets requiring downstream share-alike (rare in medical AI)                                                    |
| `CC0-1.0`                 | Public-domain release; used when the dataset host wants maximum re-use                                            |
| `custom-restricted`       | Dataset-host-supplied custom license text; campaign manager records the SPDX-equivalent or attaches the full text |

The campaign manager picks one; the dataset host can constrain the choices (e.g. a host releasing under CC-BY-NC can require the same on derivatives). Defaults are tunable per dataset access tier:

- **OPEN / REGISTERED-tier datasets**: default `CC-BY-4.0`
- **CONTROLLED-tier**: default `CC-BY-NC-4.0` (no commercial use without separate agreement)
- **SENSITIVE-tier**: default `custom-restricted` — must be explicitly specified

### 4. Annotator attribution model

Default: **pseudonymous attribution** in the public Croissant distribution. Each annotator gets a per-campaign random id; their GA4GH `sub` is never published.

Opt-in: annotator can choose **named attribution** for academic credit (their declared name appears in the distribution's `contributors` field per Croissant-RAI). The choice is per-annotator + per-campaign; default is pseudonymous.

Campaign-level override: SENSITIVE-tier campaigns where evidence chains require it (legal proceedings, regulator submissions) can require named attribution. Annotators who decline named attribution can't join such campaigns.

### 5. GDPR Article 17 posture (right-to-be-forgotten)

An annotator invoking RTBF has two distinct expectations:

- **Remove their identity from the published distribution** — yes, mechanically. We replace the annotator's per-campaign random id with a one-way pseudonym (sha256 of the original id + per-platform salt). The hash chain ([ADR-0008](./0008-annotation-persistence-and-provenance.md)) is preserved because it hashes the pseudonym, not the original id. Named attribution is similarly replaced.
- **Remove their annotation contributions from the dataset** — no. Annotations under work-for-hire / contributor-licence are owned by the platform / dataset host; they are part of the dataset's scientific record and continue to exist under the declared license. The annotator was disclosed upfront in the agreement (Decision 2). RTBF removes attribution; it doesn't unwind the contribution.

The pseudonymisation is a one-shot job; the annotator's row in the user database is also pseudonymised. The platform retains a separate mapping (encrypted at rest, accessible only by a specific operator role) so legitimate legal requests (e.g. court-ordered re-identification for regulatory investigations) can be honoured.

## Consequences

### Positive

- **Platform can legally accept and redistribute annotator work.** No ambiguous IP situations; no surprise copyright claims downstream.
- **Datasets carry machine-readable licenses.** Croissant-RAI consumers know exactly what they can do.
- **Annotators consent upfront** to instrumentation; no surprise audit-trail or IRR-scoring claims.
- **GDPR-compliant by design** — RTBF is honoured at the right scope (identity, not contribution).
- **Re-uses the existing DocuSeal AdES flow** — no new signing infrastructure.

### Negative

- **Annotator agreement signing adds onboarding friction.** A new annotator must sign before they get their first task. Acceptable cost for the legal posture.
- **Per-campaign license override requires campaign-manager training** — the difference between CC-BY and CC-BY-NC has real downstream consequences; managers need to understand it. Covered in the operator runbook (E14).
- **Pseudonymisation is non-trivial** — implementation must guarantee hash-chain integrity through the rename. Tested with adversarial scenarios in the E5 sub-epic.
- **Custom-restricted licenses on SENSITIVE-tier are operator burden** — hosts must supply text; legal review may be required. Acceptable for the tier.

### Neutral

- The annotator agreement is part of the user-profile flow, not the annotation module itself. Lives in the identity module ([ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md)) territory.
- License declarations are a campaign config field, captured in workflow + persistence layers as immutable references.

## Alternatives considered

- **Each annotator owns their annotations + grants per-campaign license.** Rejected — legal complexity, fragmented redistribution rights, can't aggregate. The work-for-hire / contributor-licence model is the only viable shape at platform scale.
- **No annotator agreement; rely on platform terms of service.** Rejected — generic ToS aren't enforceable as a copyright assignment; specifically signed, content-addressed agreements are the only defensible posture.
- **Single platform-wide license (no per-campaign override).** Rejected — legitimate use cases exist for NC + SA + custom-restricted variants; donors and IRBs impose these terms.
- **Named attribution always (no pseudonymous).** Rejected — many annotators (especially in pathology / radiology cross-jurisdiction work) decline named attribution. Pseudonymous is the right default.
- **RTBF removes the annotation contribution entirely.** Rejected — annotations under work-for-hire are owned by the platform; the annotator was disclosed upfront. Removing contributions retroactively breaks the scientific record + every downstream model trained on it.

## Amendments to prior ADRs

- **[ADR-0008](./0008-annotation-persistence-and-provenance.md)** — provenance acquires two fields: `annotatorAgreementVersion` (sha256 of the signed agreement) and `outputLicense` (SPDX identifier or "custom-restricted"). The hash chain covers both. ADR-0008 gets an "Amendments" entry.
- **[ADR-0006](./0006-annotation-integration-hub-orchestrator.md)** — campaign config acquires an immutable `outputLicense` field declared at campaign creation. ADR-0006 gets an "Amendments" entry.

## References

- [ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md) — DocuSeal AdES flow used for signing the annotator agreement.
- [ADR-0008](./0008-annotation-persistence-and-provenance.md) — provenance + audit trail; amended by this ADR.
- [ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md), [ADR-0010](./0010-annotation-metadata-exposure-and-blinding.md) — instrumentation disclosed in the annotator agreement.
- [Fried Frank — Data as IP and Data License Agreements](<https://www.friedfrank.com/uploads/siteFiles/Publications/Data%20as%20IP%20and%20Data%20License%20Agreements%20(1).pdf>) — work-for-hire patterns + medical-data IP.
- [Oregon State University — IP & Licensing Data](https://guides.library.oregonstate.edu/research-data-services/data-licensing-ip) — research-data licensing norms.
- US 17 USC §101 — work-for-hire definition.
- GDPR Article 17 — Right to erasure.
- Croissant 1.1 specification — `license` field semantics.
- SPDX License List — `CC-BY-4.0` / `CC-BY-NC-4.0` / `CC-BY-SA-4.0` / `CC0-1.0` SPDX identifiers.

# ADR-0013: Intended-Use Statement & IMDRF risk-tier vocabulary

- **Status:** proposed · **amended 2026-05-17** — IUS carrier narrowed to AI submissions only (see "Amendments" below).
- **Date:** 2026-05-17
- **Deciders:** Marc Lecoultre (OCI Platform lead)
- **Tags:** `area:prediction` `area:platform` `area:governance` `area:evaluation`

## Context

A convergent reading of five WHO publications (2021 _Ethics & Governance of AI for Health_, 2023 _Regulatory Considerations on AI for Health_, 2024 _LMM Guidance_, 2026 _AI and Evidence-Informed Policy_, 2026 WHO Europe _EU Readiness_) surfaced **Intended Use** as the most-cited foundation for everything downstream: risk classification, evidence rigor, model card content, post-market surveillance scope, regulatory pathway, and subgroup-fairness analysis all depend on it. The WHO/ITU FG-AI4H regulatory document devotes its entire §5.3 to it; WHO 2021 makes it a required "Model Facts" element (Figure 7); the EU Readiness doc maps it directly to the EU AI Act high-risk obligations matrix.

OCI today has **request-side** intended use ([`IntendedUseCategorySchema`](../../packages/shared-types/src/index.ts) — `NON_COMMERCIAL_RESEARCH` / `COMMERCIAL_RESEARCH` / `CLINICAL_CARE` / `EDUCATION`) used by access-request flows. This is necessary but not sufficient: it describes what the requester intends to do with the data, not what the AI device is medically _for_. The latter — the device's medical purpose, target population, intended user, operating environment, foreseeable misuse, contraindications — is unmodeled.

Without it the platform cannot:

1. Auto-derive an IMDRF risk class (I–IV) for any AI submission;
2. Drive the evidence-rigor tier (analytical-only vs. retrospective-clinical vs. prospective-clinical);
3. Render a clinical-grade Model Facts Label (WHO 2021 §11);
4. Generate a Clinical Evaluation Assessment Report (CEAR) or AI-MDR Bridge Report;
5. Scope subgroup-fairness analysis to the right target population;
6. Tell EU vendors which AI-Act / MDR / IVDR obligations bite.

This ADR locks the schema and the vocabulary. It does **not** scaffold the `evaluation` / `prediction` / `reporting` modules — those are separate epics (Phase C/D).

## Decision

### 1. Intended-Use Statement (IUS) is a typed object on AI submissions

The IUS schema lives in `@oci/shared-types` as `IntendedUseStatementSchema`. It is the single source of truth for "what is this _AI device_ medically for". One carrier:

- **AI submissions / model cards** — IUS is required at the moment a model is submitted to the future `prediction` / `evaluation` modules (Phase C). Stored on `ModelCard.intendedUse` JSONB column (Phase C). Drives risk-tier auto-derivation, evidence-rigor selection, Model Facts Label, CEAR, AI-MDR Bridge Report, PMS scope, fairness-report scope, and the regulator-export bundle.

**Datasets are explicitly NOT a carrier.** A dataset is a resource that can be reused across many medical purposes (a chest-X-ray set can train a Tier I research model, a Tier II screening tool, or a Tier IV standalone diagnostic). Pinning a single IUS onto a dataset prejudges the device and would be friction with no downstream benefit. Dataset suitability for a given IUS is a matching concern resolved by reading the dataset's existing provenance + characteristic fields (modality, body region, condition, demographics, IRB approval, consent basis, anonymisation level, lawful basis, EHDS permit) — all of which live in BIOCroissant already.

Request-side intended use ([`IntendedUseCategorySchema`](../../packages/shared-types/src/index.ts) — `NON_COMMERCIAL_RESEARCH` / `COMMERCIAL_RESEARCH` / …) remains where it is: on the access request. That field describes the _requester's_ intent, distinct from the device's IUS.

### 2. Field set (locked vocabulary)

The IUS contains exactly the following:

| Field                     | Type                                                                                                                                                                                    | Notes                                                                                                                                                                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `medicalPurpose`          | enum: `screening`, `diagnosis`, `triage`, `treatment-planning`, `monitoring`, `prognosis`, `clinical-decision-support`, `administrative`, `patient-education`, `research-only`, `other` | "What clinical job does this do?"                                                                                                                                                                                                                                                                          |
| `medicalPurposeOther`     | string ≤ 200                                                                                                                                                                            | Required iff `medicalPurpose=other`.                                                                                                                                                                                                                                                                       |
| `bodySystemOrSite`        | open string ≤ 200                                                                                                                                                                       | FMA / SNOMED CT-class concept; free text until vocabulary service lands.                                                                                                                                                                                                                                   |
| `targetPopulation`        | object                                                                                                                                                                                  | `ageRangeYears`, `sexEligibility`, `clinicalStrata[]` (free-text codes), `populationDescription` narrative (≤ 2000).                                                                                                                                                                                       |
| `intendedUserRole`        | enum: `nurse`, `general-clinician`, `specialist`, `radiologist`, `pathologist`, `lab-tech`, `patient`, `researcher`, `administrator`, `other`                                           | Multi-valued.                                                                                                                                                                                                                                                                                              |
| `operatingEnvironment`    | enum: `primary-care`, `hospital-inpatient`, `hospital-outpatient`, `emergency`, `field-or-community`, `home-or-telehealth`, `lab`, `research`                                           | Multi-valued.                                                                                                                                                                                                                                                                                              |
| `intendedClinicalPathway` | enum: `standalone`, `adjunct-with-confirmation`, `triage-before-clinician`, `screening-before-specialist`, `research-only`                                                              | Drives the human-oversight expectations.                                                                                                                                                                                                                                                                   |
| `operatingPrinciple`      | open string ≤ 1000                                                                                                                                                                      | "Rule-based on lab values" / "CNN over chest X-ray" / "LLM with RAG over EHR" — short narrative.                                                                                                                                                                                                           |
| `foreseeableMisuse`       | string ≤ 4000                                                                                                                                                                           | Required. WHO/ITU §5.3.2: "developers must document foreseeable misuse."                                                                                                                                                                                                                                   |
| `contraindications`       | string ≤ 4000                                                                                                                                                                           | Required. Empty value is allowed but the field is not.                                                                                                                                                                                                                                                     |
| `riskTier`                | enum: `I`, `II`, `III`, `IV`                                                                                                                                                            | IMDRF significance × healthcare-situation severity. Auto-suggested by the platform from `medicalPurpose` + `intendedClinicalPathway` + `operatingEnvironment` per the IMDRF Table 5/6 matrix; submitter can override but must record `riskTierJustification` (≥ 50 chars) when override raises tier ≥ III. |
| `riskTierJustification`   | string ≤ 4000                                                                                                                                                                           | Required when `riskTier` was overridden upward.                                                                                                                                                                                                                                                            |
| `regulatoryPathway`       | reuses [`RegulatoryPathwaySchema`](../../packages/shared-types/src/index.ts)                                                                                                            | Already exists for access requests; same vocabulary applies here. Optional.                                                                                                                                                                                                                                |

All optional sub-fields are nullable; the **shape** is fixed.

### 3. Risk-tier auto-derivation table

Auto-derivation is published as `deriveRiskTier(intendedUse): RiskTier` in `@oci/shared-types`. The mapping (truncated; full table in code) is the IMDRF significance-of-information × significance-of-healthcare-situation matrix:

| `medicalPurpose`                      | `intendedClinicalPathway`                                | Auto-suggested tier                                        |
| ------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| `diagnosis`, `treatment-planning`     | `standalone`                                             | IV                                                         |
| `diagnosis`, `treatment-planning`     | `adjunct-with-confirmation`                              | III                                                        |
| `triage`, `screening`                 | `triage-before-clinician`, `screening-before-specialist` | II–III (depends on operating environment: emergency → III) |
| `prognosis`, `monitoring`             | any                                                      | II                                                         |
| `clinical-decision-support`           | `adjunct-with-confirmation`                              | II                                                         |
| `administrative`, `patient-education` | any                                                      | I                                                          |
| `research-only`                       | any                                                      | I (excluded from production deployment)                    |

The matrix is a _suggestion_; the user can adjust ±1 tier without justification, ≥ 2 tiers or jumping from I/II to III/IV requires the `riskTierJustification` field. Auto-derivation is a pure function of the IUS — no I/O, no DB lookups — so it lives in `@oci/shared-types` and runs on both the API and the web form.

### 4. Evidence-rigor tier follows risk tier

The IUS `riskTier` is the **input** to the evidence-rigor selector that the future `evaluation` module will use:

| Risk tier | Minimum evidence required at submission                                           |
| --------- | --------------------------------------------------------------------------------- |
| I         | Analytical metrics on external validation set; demographic distribution report.   |
| II        | + retrospective clinical analysis vs. reference standard; subgroup performance.   |
| III       | + prospective protocol (SPIRIT-AI), Clinical Evaluation Assessment Report (CEAR). |
| IV        | + post-market surveillance plan (mandatory before deployment promotion).          |

This ADR does not implement the evidence-rigor module; it locks the **vocabulary** the future module will consume.

### 5. Storage

- **Models:** Phase C introduces `ModelCard.intendedUse Json` (non-nullable from day one — no models exist yet at ADR time).
- **No dataset column, no manifest field.** A dataset is not a device; see the amendment.
- **No new tables.** The single column is JSONB, schema-validated at write time by `IntendedUseService.validate()`.

## Consequences

### Positive

- **One source of truth for the AI device's medical purpose.** Risk tier, evidence rigor, model card, CEAR, AI-MDR Bridge Report, PMS plan scoping — all five future deliverables read from the same `ModelCard.intendedUse` column.
- **Regulator-friendly.** The IUS field set maps 1-to-1 onto IMDRF §5 and EU MDR Annex II.B.1 — vendors using OCI generate this artefact for free.
- **Cheap to ship.** No new tables today, no friction on dataset publish. Pure schema + a small validator + a derive-risk-tier helper. The `prediction` module (Phase C) lands the column.
- **Audit-trail-ready.** Every IUS write is an event the future audit log ([ADR-0014](./0014-evidence-audit-trail-and-regulator-export.md)) emits — IUS changes are first-class regulatory signals.

### Negative

- **Auto-derivation will be wrong sometimes.** The IMDRF matrix is coarse; mid-case clinical decisions don't always slot cleanly. Override path with justification is the relief valve; we accept it.
- **The IUS schema will evolve.** Every change is a `v` bump (same pattern as [`AccessRequestAttestationsSchema`](../../packages/shared-types/src/index.ts)); the migration story is permissive read + strict write.
- **The "device's IUS" vs. "requester's intended use" naming collision** (with `IntendedUseCategorySchema` on access requests) needs to be re-explained every time. Mitigated by code comments and ADR cross-references; not solved.

### Neutral

- Free-text fields stay free-text for v1. Phase C may bind `bodySystemOrSite` to FMA / SNOMED CT once a vocabulary service exists.
- The `regulatoryPathway` enum is shared with access requests; if either side needs to evolve independently, the schema splits.
- LMM-specific intended-use considerations (e.g. hallucination sensitivity, prompt-injection exposure) are not in v1. [ADR-0015](./0015-lmm-extensibility-door-openers.md) explains why the door is left open.

## Alternatives considered

- **Free-text intended-use field.** Rejected — every downstream consumer (risk tier, CEAR, PMS scope) would need to re-parse free text. Structured wins.
- **Reuse `IntendedUseCategorySchema` from access-request.** Rejected — that field describes the _requester's_ intent (research vs. commercial); the IUS describes the _device's_ clinical purpose. Same word, different concept.
- **Carry the IUS on `Dataset` as well as on `ModelCard`** (the original v1 of this ADR before the 2026-05-17 amendment). Rejected — a dataset is a resource that can train models with different intended uses; pinning a single IUS prejudges the device. Dataset suitability is a matching concern resolvable from existing provenance fields (modality, body region, condition, demographics, IRB, consent, anonymisation, lawful basis, EHDS permit). See amendment.
- **Carry a multi-valued `supportedIntendedUses[]` capability declaration on the dataset.** Deferred — no concrete consumer needs it today. A future regulator UI may want a "this dataset is suited for X / Y / Z purposes" hint, at which point we add the field. Doesn't prejudice any later submission's IUS.
- **Defer the entire schema until the `prediction` module lands.** Rejected for the _schema_ itself — keeping the Zod schema + derivation helper in `@oci/shared-types` today lets the web form + future API surface adopt it without round-tripping through an ADR. Accepted for the _column_ — `ModelCard.intendedUse` lands with the prediction module in Phase C.
- **Auto-classify on every submission and refuse override.** Rejected — clinical judgment isn't always pattern-matchable from enum values; an override with justification preserves auditability without paternalism.
- **Capture the full IMDRF Table 5/6 cells (12 cells, not 4 tiers).** Rejected — too fine-grained for v1; 4 tiers covers the regulatory mapping cleanly and is easier to defend in a regulatory dossier.

## Amendments

### 2026-05-17 — IUS carrier narrowed to AI submissions only

The v1 of this ADR named both `Dataset` and `ModelCard` as carriers, and the initial implementation added `Dataset.intendedUse Json?` + `bio:intendedUse` to the BIOCroissant manifest + a publish-time gate. On the day the implementation landed, the design was challenged: a dataset is a _resource_ and the same set can train models with different intended uses, while IMDRF risk-tier classification, Model Facts Label, CEAR, and SPIRIT-AI all attach to the _device_, not the data.

The amendment:

- **Removed** `Dataset.intendedUse` column (migration `20260517000000_dataset_intended_use` deleted before flip to int).
- **Removed** `bio:intendedUse` field from the BIOCroissant manifest schema.
- **Removed** the publish-time IUS gate in `CatalogService.publishVersion`.
- **Removed** the `IntendedUseRepository.setForDataset` / `findForDataset` methods + the `IntendedUseAuditEmitter` stub.
- **Kept** the `IntendedUseStatementSchema` + `deriveRiskTier()` + `overrideRequiresJustification()` in `@oci/shared-types`.
- **Kept** the `IntendedUseModule` + `POST /v2/intended-use/derive-risk-tier` endpoint as a Phase-C-ready primitive. The persistence + audit hook lands alongside `ModelCard` when the `prediction` module is built.

The strategic frame (OCI as a compliance-evidence generator for EU AI Act / MDR / EHDS / WHO-IMDRF) is unchanged — IUS still drives the same five downstream artefacts, just from the model side.

## References

- WHO/ITU FG-AI4H (2023) _Regulatory Considerations on AI for Health_ — [9789240078871-eng.pdf](../research/9789240078871-eng.pdf) §5.3 (Intended Use).
- WHO (2021) _Ethics and Governance of AI for Health_ — [9789240038462-eng.pdf](../research/9789240038462-eng.pdf) Chapter 4 (Intended Use), §11 (Model Facts).
- WHO Europe (2026) _AI Reshaping Health Systems — EU Readiness_ — [WHO-Europe-2026-AI-Reshaping-Health-Systems-EU-Readiness.pdf](../research/WHO-Europe-2026-AI-Reshaping-Health-Systems-EU-Readiness.pdf) §1.3.
- IMDRF/SaMD WG/N12 FINAL:2014 — "Software as a Medical Device: Possible Framework for Risk Categorization and Corresponding Considerations" (Table 5/6 used for the auto-derivation matrix).
- EU MDR (2017/745) Annex II §B.1 — technical documentation device-description requirements.
- [ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md) — recommended-bounds-by-tier table; IUS risk tier integrates with that table directly.
- [ADR-0014](./0014-evidence-audit-trail-and-regulator-export.md) — IUS writes are audited events.
- [ADR-0015](./0015-lmm-extensibility-door-openers.md) — leaves the IUS extensible for LMM submissions in Phase D without schema churn.

# ADR-0019: Model-card conformance — IMDRF-anchored core, CHAI Applied Model Card as an export

- **Status:** proposed
- **Date:** 2026-08-04
- **Deciders:** Marc Lecoultre
- **Tags:** `area:prediction` | `area:reporting` | `phase:C` | `package:PP`

## Context

The `prediction` module shipped a `ModelCard` in [#260](https://github.com/FG-AI4H/oci-platform/issues/260)
(PR [#383](https://github.com/FG-AI4H/oci-platform/pull/383)). Its shape was derived from the
issue's field list plus [ADR-0013](./0013-intended-use-statement-and-risk-tier.md) (IUS +
IMDRF risk tier), [ADR-0015](./0015-lmm-extensibility-door-openers.md) (`model_class`), and
WHO 2021 _Ethics & Governance of AI for Health_ Fig. 7 (Model Facts Label). **No external
model-card standard was consulted.**

That is a gap in our own terms: [ADR-0002](./0002-metadata-conformance.md) commits the platform
to _conforming to external metadata standards_ (Croissant / BIOCroissant) rather than inventing
shapes. We applied that discipline to datasets and not to model submissions.

The relevant external standard is the **CHAI Applied Model Card** (Coalition for Health AI),
published at `https://mc.chai.org/` with an XSD at
[`coalition-for-health-ai/mc-schema`](https://github.com/coalition-for-health-ai/mc-schema)
(`v0.1`, `v0.2`; permissive licence, CHAI retains copyright). It is explicitly designed to
satisfy **HTI-1** transparency criteria for predictive Decision Support Interventions and to
evidence CHAI's Five Principles of Responsible AI (Usefulness, Fairness & Bias, Safety,
Transparency, Security & Privacy).

### Field-level crosswalk (CHAI v0.2 XSD → OCI `ModelCard`)

CHAI v0.2 defines 9 top-level sections under `AppliedModelCard`, plus an optional
`ds:Signature` (XML DSig). Assessed against what #260 shipped:

| CHAI v0.2 section                            | Fields                                                                                                                                                                                           | OCI coverage                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BasicInfo`                                  | ModelName, ModelDeveloper, DeveloperContact                                                                                                                                                      | ❌ none — we have `slug` + `submitterUserId`; **no developer/vendor identity**                                                                                                         |
| `ReleaseInfo`                                | ReleaseStage, ReleaseDate, ReleaseVersion, GlobalAvailability, EHRCompatibility, RegulatoryApproval                                                                                              | ⚠️ partial — `versionMajorMinorPatch`, `createdAt`. **No lifecycle status**, no `RegulatoryApproval` (CE / 510(k))                                                                     |
| `ModelSummary`                               | Summary, Keywords                                                                                                                                                                                | ⚠️ `architectureSummary` is technical, not the clinical summary; no keywords                                                                                                           |
| `UsesAndDirections`                          | IntendedUseAndWorkflow, PrimaryIntendedUsers, HowToUse, TargetedPatientPopulation, CautionedOutOfScopeSettings                                                                                   | ✅ strong — covered by `intendedUse` (`medicalPurpose`, `intendedUserRole`, `intendedClinicalPathway`, `targetPopulation`, `foreseeableMisuse`, `contraindications`)                   |
| `Warnings`                                   | KnownRisksAndLimitations, KnownBiasesOrEthicalConsiderations, ClinicalRiskLevel                                                                                                                  | ⚠️ `riskTier` (IMDRF I–IV) + `lmmSpecificLimitations`; **no bias/ethical-considerations field**                                                                                        |
| `TrustIngredients → AISystemFacts`           | OutcomesAndOutputs, ModelType, FoundationModels, InputDataSource, OutputAndInputDataTypes, DevelopmentDataCharacterization, BiasMitigationApproaches, OngoingMaintenance, Security, Transparency | ⚠️ `modelClass`, `generativeAi`, `trainingDataLineage` only; **no bias-mitigation, maintenance/PMS, security**                                                                         |
| `TrustIngredients → TransparencyInformation` | FundingSource, ThirdPartyInformation, StakeholdersConsulted                                                                                                                                      | ❌ none                                                                                                                                                                                |
| `KeyMetrics`                                 | Usefulness/Fairness/Safety × {MetricGoal, Results, Interpretation, TestType, TestingDataDescription, ValidationProcessAndJustification}                                                          | ❌ none on the card — this is `evaluation` territory ([#262](https://github.com/FG-AI4H/oci-platform/issues/262), fairness [#263](https://github.com/FG-AI4H/oci-platform/issues/263)) |
| `Resources` / `Bibliography`                 | EvaluationReferences, ClinicalTrial, PeerReviewedPublications, ReimbursementStatus, PatientConsentOrDisclosure                                                                                   | ❌ none                                                                                                                                                                                |

**What OCI has that CHAI does not:** IMDRF-derived `riskTier` with auto-derivation + override
justification (CHAI's `ClinicalRiskLevel` is a free string); semver lineage
(`parentModelCardId`, `changeJustification`, `materialChange`) against CHAI's flat
`ReleaseVersion`; `trainingDataJurisdictions`; and **enum-validated** IUS vocabulary.

**The decisive observation:** CHAI v0.2 is almost entirely `xs:string` free text. It is a
_transparency disclosure document_, not a validated data model. Adopting it as our persistence
shape would trade structure and validation for prose. Rendering our structured record _into_ it
is straightforward; the reverse is lossy and unverifiable.

## Decision

1. **The canonical `ModelCard` stays IMDRF/WHO-anchored** (ADR-0013 IUS + risk tier). OCI is a
   WHO/ITU/WIPO platform; a US-rule-shaped disclosure document is not the right core primitive.
2. **CHAI Applied Model Card is a rendering, not the model** — a `chai-amc` exporter alongside
   the WHO Fig. 7 Model Facts Label ([#261](https://github.com/FG-AI4H/oci-platform/issues/261)).
   One canonical record → many regulator-facing renderings (WHO label, CHAI/HTI-1, later EU AI Act).
3. **Close the crosswalk gaps that are genuinely ours** — regardless of CHAI, a compliance-evidence
   platform should carry: model lifecycle status, developer/vendor identity, regulatory-approval
   status, bias/ethical considerations + mitigation, ongoing-maintenance/PMS, and security posture.
   These become `ModelCard` fields.
4. **Do not pin persistence to a draft.** CHAI v0.2 is draft-stage. The exporter targets a
   pinned version and records which version it emitted.
5. **`KeyMetrics` is sourced from the evaluation module, not the card** — the exporter composes
   `ModelCard` + evaluation/fairness results; it emits a partial card (documented as such) until
   #262/#263 land.

## Consequences

### Positive

- AI builders — a first-class OCI audience per [ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md) — can reuse OCI evidence toward HTI-1 without re-authoring it. Directly serves the "compliance-evidence generator" positioning.
- Restores consistency with ADR-0002's conform-don't-invent discipline, without importing a US rule into the core.
- The gap list in Decision 3 improves the card on its own merits.
- CHAI's optional `ds:Signature` aligns with our signed-evidence approach (ADR-0014) — a natural fit for the exporter.

### Negative

- A second export target to maintain, tracking a moving draft (v0.1 → v0.2 → …).
- CHAI is XML/XSD; our stack is Zod/JSON. The exporter needs XML emission + XSD validation in CI.
- Decision 3 adds fields to a table that just shipped — a migration on a young model.

### Neutral

- No change to the `prediction` module's API contract; the exporter is additive.
- Until #262/#263 land, an emitted card is incomplete in `KeyMetrics` by construction.

## Alternatives considered

- **Adopt the CHAI schema as our persistence model.** Rejected: it is free-text-typed, US-rule-shaped, and draft-stage; we would lose IMDRF tiering, enum validation and semver lineage.
- **Ignore CHAI.** Rejected: it is the emerging health-AI model-card standard and the HTI-1 vehicle; ignoring it weakens OCI's value to builders and contradicts ADR-0002.
- **Rewrite #260 before merge.** Overtaken — #383 merged; and the core shape is right. Gaps land as additive fields.

## References

- CHAI Applied Model Card — <https://registry.chai.org/applied-model-card> · schema <https://github.com/coalition-for-health-ai/mc-schema> (v0.2 XSD)
- [ADR-0002](./0002-metadata-conformance.md) (conform to external standards) · [ADR-0013](./0013-intended-use-statement-and-risk-tier.md) · [ADR-0014](./0014-evidence-audit-trail-and-regulator-export.md) · [ADR-0015](./0015-lmm-extensibility-door-openers.md)
- WHO 2021 _Ethics & Governance of AI for Health_, ch. 4 + Fig. 7

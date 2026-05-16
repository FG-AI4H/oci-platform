# Submitting an AI model

🚧 **Phase C — Planned, not yet live.** This page describes the AI-builder submission surface OCI is committed to delivering. Architecture is locked in [ADR-0013](../adr/0013-intended-use-statement-and-risk-tier.md), [ADR-0014](../adr/0014-evidence-audit-trail-and-regulator-export.md), [ADR-0015](../adr/0015-lmm-extensibility-door-openers.md); implementation is tracked under [#260](https://github.com/FG-AI4H/oci-platform/issues/260) (Prediction module skeleton) and its sub-epics. If you have skin in the game on the design — submission ergonomics, evidence rigor, what regulators in your jurisdiction actually accept — file feedback against [#271](https://github.com/FG-AI4H/oci-platform/issues/271) (steering endorsement).

## What "submitting a model" will mean

When the Prediction module ships, you'll be able to register a *ModelCard* against an OCI dataset and run a structured evaluation. The submission carries a typed **Intended-Use Statement (IUS)**: what your device is medically *for*. From the IUS, the platform auto-derives an **IMDRF risk tier (I–IV)** that gates the evidence rigor the platform expects from your evaluation.

The IUS attaches to your ModelCard, **not** to the dataset. A dataset is multi-purpose — the same chest-X-ray set can train a Tier I research model, a Tier II screening tool, or a Tier IV standalone diagnostic. You declare the device-level intent; the platform matches it against the dataset's provenance + characteristics.

## The submission flow (planned)

1. **Pick a dataset.** Same catalogue you read today — filtered by modality, body region, condition, commercial-use band, WHO priority, etc.
2. **Declare the IUS.** Structured form covering medical purpose, target population, intended user, operating environment, intended clinical pathway, foreseeable misuse, contraindications. The form calls [`POST /v2/intended-use/derive-risk-tier`](../for-developers/api-reference.md#post-v2intended-usederive-risk-tier-any-auth) to hint the IMDRF tier before you commit.
3. **Required evidence depends on the tier.** Today's commitment ([ADR-0013 §4](../adr/0013-intended-use-statement-and-risk-tier.md)):
   - **Tier I** (research, administrative, patient education): analytical metrics on an external validation set + demographic distribution report.
   - **Tier II** (screening, monitoring, CDS-as-adjunct): + retrospective clinical analysis vs. reference standard + per-subgroup performance.
   - **Tier III** (high-risk clinical, emergency screening): + prospective protocol (SPIRIT-AI) + Clinical Evaluation Assessment Report (CEAR).
   - **Tier IV** (standalone diagnosis or treatment planning): + post-market surveillance plan; mandatory before deployment promotion.
4. **Override-with-justification.** You can override the auto-derived tier ±1 freely; overriding ≥ 2 tiers upward requires a written rationale (recorded, immutable). Don't game the matrix — Notified Bodies read the justifications.
5. **Submit + evaluate.** The Evaluation module ([#262](https://github.com/FG-AI4H/oci-platform/issues/262)) runs your packaged model against the dataset; results are versioned, reproducible, and signed.
6. **Auto-generated outputs.** Each evaluation produces:
   - **Model Facts Label** ([#261](https://github.com/FG-AI4H/oci-platform/issues/261)) — clinician-facing one-pager (WHO 2021 Fig. 7): intended use, mechanism, performance overall + per-subgroup, warnings, generalisability statement, discontinue-use criteria.
   - **Fairness / subgroup report** ([#263](https://github.com/FG-AI4H/oci-platform/issues/263)) — per-group sensitivity / specificity / AUC / PPV / NPV with CIs. Any subgroup ≥ 5% below cohort metric is flagged and requires a written justification before promotion.
   - **CEAR** ([#265](https://github.com/FG-AI4H/oci-platform/issues/265)) — Clinical Evaluation Assessment Report, EU MDR Annex II aligned. Tier ≥ II only.
   - **AI-MDR Bridge Report** ([#266](https://github.com/FG-AI4H/oci-platform/issues/266)) — maps your OCI artefacts to MDR Annex II / III clauses. For EU vendors this is the highest-leverage output: OCI becomes your evidence pre-pack for the Notified Body.
   - **Reproducibility manifest** — dataset snapshot, model digest, hyperparameters, seed, env hash, software versions. Export as a signed bundle.

## What kinds of model OCI will accept

The Prediction module supports a typed `modelClass` set ([ADR-0015](../adr/0015-lmm-extensibility-door-openers.md)):

| `modelClass` | Examples | Phase |
|---|---|---|
| `classical` | Classifier, segmentor, detector, regressor — closed-form ML/DL | Phase C from day one |
| `time-series` | RNN / Transformer over ECG, EEG, vitals | Phase C |
| `foundation` | General-purpose pre-trained single-modality model | Phase C |
| `lmm` | Large multi-modal model (LLM + vision / EHR / signals) | Phase D+ (tooling: [#270](https://github.com/FG-AI4H/oci-platform/issues/270)) |
| `agent` | Multi-step orchestrated AI | Phase D+ |

Schemas for all five classes ship today on `main` so when the LMM submission path lands no migration is required. The LMM-specific evaluation surface (red-teaming corpora, hallucination scoring, prompt-injection probes, output-distribution drift) is deferred — see the [LMM extensibility stance](../for-strategy/lmm-extensibility-stance.md).

## Post-deployment monitoring

For Tier III/IV models the platform expects a Post-Market Surveillance plan ([#267](https://github.com/FG-AI4H/oci-platform/issues/267)) and accepts drift-event ingestion against the deployed model. EU AI Act Art. 72 anchors this; WHO/ITU FG-AI4H 2023 §5.2.3 + WHO 2024 LMM Guidance describe the analogous obligations for non-EU regimes. The platform doesn't replace your monitoring stack; it lets your monitoring stack feed a regulator-readable record.

## How OCI artefacts feed regulatory submissions

| Regulator / regime | What OCI gives you |
|---|---|
| EU AI Act high-risk obligations | IUS + risk tier + Fairness report + PMS plan + signed audit-export bundle (see [`docs/for-governance/compliance.md`](../for-governance/compliance.md)) |
| EU MDR (Notified Body submission) | AI-MDR Bridge Report ([#266](https://github.com/FG-AI4H/oci-platform/issues/266)) maps to Annex II / III clauses |
| FDA 510(k) / De Novo / PMA | Model Facts Label + CEAR + reproducibility manifest; you carry these into your Q-Sub / pre-sub conversation |
| WHO Innovation Hub / national-MoH endorsement | Same artefacts; structured to support LMIC public-sector deployment pathways |

## What stays your responsibility

OCI is a *compliance-evidence generator*, not a regulatory consultancy. You still own:

- The training pipeline outside OCI's evaluation surface.
- Your Quality Management System (ISO 13485 / 62304 / 81001-5-1).
- Bias mitigation in your data pipeline (OCI surfaces the *measurement*; remediation is yours).
- Patient consent for the data you used outside OCI's catalogue.
- Real-world deployment monitoring infrastructure (OCI accepts the drift events; the monitoring code that emits them is yours).
- Post-incident response, including reporting to the relevant competent authority.

## Reference

- [ADR-0013](../adr/0013-intended-use-statement-and-risk-tier.md) — Intended-Use Statement + IMDRF risk tier (note the same-day amendment: IUS attaches to the model, not the dataset).
- [ADR-0014](../adr/0014-evidence-audit-trail-and-regulator-export.md) — append-only audit trail + signed regulator export.
- [ADR-0015](../adr/0015-lmm-extensibility-door-openers.md) — extensible task-kind + model-class vocabulary.
- [`docs/research/`](../research/) — the five WHO publications this work is derived from.
- [`docs/for-governance/compliance.md`](../for-governance/compliance.md) — OCI artefact → regulatory clause map.
- [`docs/for-governance/audit.md`](../for-governance/audit.md) — what the platform records and how a regulator reads it.
- [`docs/for-developers/api-reference.md`](../for-developers/api-reference.md) — endpoint shapes; `POST /v2/intended-use/derive-risk-tier` is live today.

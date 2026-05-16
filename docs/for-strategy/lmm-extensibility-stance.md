# Strategic stance — LMM extensibility

OCI is committed to accepting Large Multi-Modal Model (LMM) evaluations in a future phase without forcing a schema migration when that work begins. The architectural decision is locked in [ADR-0015](../adr/0015-lmm-extensibility-door-openers.md). Today's cost: two extensible enums. The deferred work — red-team corpora, hallucination scorers, prompt-injection probes, output-distribution drift detectors — is Phase D+ ([#270](https://github.com/FG-AI4H/oci-platform/issues/270)).

## Why this matters strategically

The WHO 2024 *Ethics and Governance of AI for Health: LMM Guidance* (in [`docs/research/`](../research/)) is the only one of the five 2026 WHO publications that **does not fit** a classical AI-SaMD evaluation paradigm. Classical narrow AI maps a fixed input to a fixed output: accuracy, sensitivity, specificity, Dice, Hausdorff. LMM evaluation needs:

- Red-teaming against adversarial-prompt corpora.
- Hallucination scoring against factuality rubrics per medical purpose.
- Prompt-injection probes.
- Use-case-stratified safety assessment (a Tier IV diagnostic and a Tier I clerical assistant have different acceptable failure modes — the same model can be either).
- Population-stratified post-deployment drift detection that watches output distribution shift, not just accuracy delta.

A platform that locks its evaluation schema to classical task kinds excludes itself from the LMM-evidence conversation when regulators show up asking "where do I get a structured evaluation of this LMM-based triage tool?". WHO 2024 explicitly anticipates that question.

## What's committed today (the cheap part)

Two enums in `@oci/shared-types` shipped on 2026-05-17 ([PR #272](https://github.com/FG-AI4H/oci-platform/pull/272)):

1. **`EvaluationTaskKindSchema`** is an open vocabulary, not a closed enum. The `KNOWN_EVALUATION_TASK_KINDS` constant lists classical kinds (`classification`, `segmentation`, …) and reserves the `lmm-*` prefix family from day one (`lmm-qa`, `lmm-red-team`, `lmm-hallucination`, `lmm-prompt-injection`, `lmm-safety-eval`). Vendor extensions follow `x-<vendor>-<task>`.
2. **`ModelClassSchema`** is closed but already includes `lmm` and `agent` alongside `classical` / `time-series` / `foundation`.

When Phase D's submission path lands, no migration is required to start accepting LMM submissions. The schema-version bump that would otherwise be a 12-month migration is avoided by writing 30 lines of code today.

## What's NOT committed today (the deferred part)

ADR-0015 explicitly does **not** ship LMM tooling:

- No red-team corpora.
- No hallucination scorer.
- No prompt-injection probe library.
- No output-distribution drift detector.

The reasoning is in [ADR-0015 "What this ADR explicitly does NOT do"](../adr/0015-lmm-extensibility-door-openers.md#3-what-this-adr-explicitly-does-not-do): premature implementation is more expensive than the door-opener cost, and Phase D is far enough out that current investment should go to Phase B (annotation) and Phase C (prediction + evaluation + reporting).

## How this stance is defensible to convening organisations

The stance balances two pressures:

- **WHO 2024 LMM Guidance demand:** governance of LMMs in health is a stated WHO concern; a benchmarking platform that can't accept LMMs ages out of the conversation quickly.
- **Phase A/B/C focus:** OCI's Phase B (annotation reactivation) and Phase C (prediction + evaluation + reporting) timelines are the binding constraint on time-to-value for the existing AI-builder and researcher audiences. Diverting Phase B/C engineering capacity to LMM tooling now would slip both.

The door-opener decision absorbs the architectural pressure cheaply, lets the convening organisations point to a written commitment when asked, and frees the engineering capacity to ship the Phase C primitives that benefit *every* model class — classical and LMM alike (Model Facts Label, fairness report, CEAR, audit trail, PMS dashboard).

## When the door opens

Two trigger conditions for un-deferring [#270](https://github.com/FG-AI4H/oci-platform/issues/270):

1. **Phase C is shipped** — the Prediction + Evaluation + Reporting modules are running in production with classical models, so the LMM tooling can plug into a stable surface rather than a moving target.
2. **A concrete LMM submission is on the horizon** — a specific WHO Collaborating Centre, a specific MedTech vendor, or a specific national MoH has named an LMM-based AI-SaMD they intend to evaluate on OCI. We build for actual users, not hypothetical ones.

Until both trigger, [#270](https://github.com/FG-AI4H/oci-platform/issues/270) stays open and dormant; the strategic stance is what shows up in conversations with regulators and convening bodies.

## Implications for related decisions

- **Hardware / compute footprint:** LMM evaluation is compute-heavy. CDK currently doesn't budget for GPU-backed evaluation workers. Phase D+ requires the GPU worker pool already on the Phase C epic ([#46](https://github.com/FG-AI4H/oci-platform/issues/46) PP 2026-Q3) — there's no double-counting here, but Phase D+ tools will saturate it.
- **Risk-tier matrix:** the IMDRF Tables 5/6 derivation in [ADR-0013](../adr/0013-intended-use-statement-and-risk-tier.md) was authored for classical AI-SaMD. LMM intended-use considerations (hallucination sensitivity, prompt-injection exposure) may need an IUS schema bump (`v: 2`) before LMM submissions can be tiered fairly. That's a schema evolution, not a new ADR.
- **Audit-trail event taxonomy:** [ADR-0014](../adr/0014-evidence-audit-trail-and-regulator-export.md) already lists `evaluation.{submitted, scored, …}` as standard events. LMM-specific events (`evaluation.red-team.completed`, `evaluation.hallucination-scored`) extend the same taxonomy without changing the schema.

## Reference

- [ADR-0015](../adr/0015-lmm-extensibility-door-openers.md) — the door-opener decision in full.
- [`docs/research/WHO-2024-AI-Governance-LMMs-in-Health.pdf`](../research/WHO-2024-AI-Governance-LMMs-in-Health.pdf) — the source.
- [#270](https://github.com/FG-AI4H/oci-platform/issues/270) — deferred Phase D+ tooling ticket.
- [#271](https://github.com/FG-AI4H/oci-platform/issues/271) — steering endorsement for ADR-0013/14/15 collectively.

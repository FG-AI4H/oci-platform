# ADR-0015: LMM extensibility door-openers (extensible task_kind + model_class)

- **Status:** proposed
- **Date:** 2026-05-17
- **Deciders:** Marc Lecoultre (OCI Platform lead)
- **Tags:** `area:platform` `area:evaluation` `area:prediction`

## Context

WHO 2024 _Ethics and Governance of AI for Health: Guidance on Large Multi-Modal Models_ ([WHO-2024-AI-Governance-LMMs-in-Health.pdf](../research/WHO-2024-AI-Governance-LMMs-in-Health.pdf)) is the only one of the five WHO publications reviewed that **does not fit** the current OCI evaluation design. Classical AI-SaMD benchmarks assume a fixed input → fixed output mapping with metrics like sensitivity, specificity, AUC, Dice, Hausdorff. LMM evaluation needs:

- Red-teaming corpora with adversarial-prompt libraries;
- Hallucination scoring against curated factuality rubrics;
- Prompt-injection probes;
- Use-case-stratified safety assessment (diagnosis vs. clerical vs. patient-facing has different acceptable failure modes);
- Population-stratified post-deployment drift detection that watches output distribution shift, not just accuracy delta.

These are real Phase D scope items. They are also material schema changes if retrofitted later: a closed `task_kind` enum and a closed `model_class` enum painted-into a corner is the kind of decision that produces a 12-month migration when LMM submissions arrive.

This ADR makes the **two cheapest decisions that keep the door open**:

1. The future `evaluation.task_kind` is an **extensible vocabulary**, not a closed enum.
2. The future `prediction.model_class` includes `lmm` **from day one**, even though zero LMM submissions exist today.

**This ADR does not build any LMM tooling.** Red-teaming corpora, hallucination scorers, drift detectors — all Phase D. The point is to avoid schema churn when we get there.

## Decision

### 1. `EvaluationTaskKindSchema` is an extensible vocabulary, not a closed enum

The Zod schema in `@oci/shared-types`:

```ts
export const KNOWN_EVALUATION_TASK_KINDS = [
  // Classical AI-SaMD task kinds (Phase B at submission)
  'classification',
  'detection',
  'segmentation',
  'localization',
  'regression',
  'survival',
  // LMM task kinds — reserved namespace; tooling lands Phase D
  'lmm-qa',
  'lmm-summarization',
  'lmm-red-team',
  'lmm-hallucination',
  'lmm-prompt-injection',
  'lmm-safety-eval',
  // Multi-modal hybrid
  'multi-modal',
] as const;

export const EvaluationTaskKindSchema = z.union([
  z.enum(KNOWN_EVALUATION_TASK_KINDS),
  z
    .string()
    .regex(/^x-[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected x-<vendor>-<task>')
    .max(64),
]);
export type EvaluationTaskKind = z.infer<typeof EvaluationTaskKindSchema>;
```

Two design choices locked here:

- **`lmm-*` is a known prefix from day one.** The enum _values_ are listed even though no code consumes them yet, because adding them later would force a schema-version bump and a re-migration of every emitted artefact that mentioned a `task_kind`.
- **`x-*` is the vendor-extension prefix.** Anyone needing to register a task kind without an upstream ADR uses `x-<vendor>-<task>`. The platform never gates on `x-*` semantics; UI surfaces them as "custom".

Crucially, this is **not** the same as the annotation `CampaignTaskKind` (in [`packages/shared-types/src/modality-task-kinds.ts`](../../packages/shared-types/src/modality-task-kinds.ts)) — that one is a closed set on purpose because the annotation orchestrator needs to make routing decisions (per [ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md)). The annotation `CampaignTaskKind` stays closed; the evaluation `EvaluationTaskKind` is open. Different module, different invariant.

### 2. `ModelClassSchema` includes `lmm` from day one

The Zod schema in `@oci/shared-types`:

```ts
export const ModelClassSchema = z.enum([
  'classical', // closed-form ML/DL: classifier, segmentor, detector, regressor
  'time-series', // RNN/Transformer over signals — ECG, EEG, vitals
  'foundation', // general-purpose pre-trained model, single-modality
  'lmm', // Large Multi-Modal Model (LLM with vision / EHR / signals)
  'agent', // multi-step orchestrated AI (Phase D+); placeholder
]);
export type ModelClass = z.infer<typeof ModelClassSchema>;
```

Two design choices locked here:

- **`lmm` is value 4 of 5 from day one** even though no `prediction` module exists yet. When that module lands ([ADR-0017](./0017-prediction-module-and-model-card.md), forthcoming Phase B), the `ModelCard.modelClass` column will accept `lmm` without further schema change.
- **`agent` is also pre-reserved.** Same reasoning — the architectural surface for agentic AI (Anthropic's MCP, OpenAI tool-use, multi-step planners) is approaching production; we don't want to require an ADR to add the enum value.

### 3. What this ADR explicitly does NOT do

- No `evaluation` module skeleton — that is its own Phase B epic.
- No `prediction` module skeleton — same.
- No red-teaming corpora, no adversarial-prompt libraries, no hallucination scorer — all Phase D.
- No model-card column changes (the column doesn't exist yet — it will, with `modelClass` typed against `ModelClassSchema` from inception).
- No `Evaluation` table changes — when it's added, `taskKind: String @db.VarChar(64)` will be validated against `EvaluationTaskKindSchema` at the API boundary.

### 4. Two strict invariants for downstream modules

For any module that touches `EvaluationTaskKind` or `ModelClass`:

- **No `if (kind === ...) else throw`.** Pattern-matching with exhaustive checks is fine for the known-enum branch; the `x-*` and any future addition branches must degrade gracefully (e.g. "fall back to generic renderer", "skip the bespoke metric").
- **No DB columns store the closed enum.** Columns are `String @db.VarChar(64)` validated by Zod at the API boundary. PostgreSQL `enum` types lock the schema in a way that defeats the extensibility — we keep PG enums for genuinely closed sets (status enums, role enums) and avoid them here.

## Consequences

### Positive

- **Zero LMM work shipped, full LMM door open.** The platform looks identical to today after this ADR lands; the future LMM submissions don't require a schema migration to be accepted.
- **Annotation orchestrator unaffected.** The annotation `CampaignTaskKind` stays closed where closed is correct (routing invariants); the evaluation kind is open where open is correct (extensibility).
- **Vendor extensions are first-class.** External integrators can register task kinds without waiting for an upstream ADR — they just use `x-<vendor>-<task>` and own the semantics on their side.

### Negative

- **Exhaustive `switch` is slightly less ergonomic** than over a closed enum — every consumer carries a default branch. We accept it; the alternative (closed enum + future migration) costs much more.
- **Discoverability hit.** A reader of the API spec sees a `string`, not an enum, in some places. Mitigated by the OpenAPI spec listing `KNOWN_EVALUATION_TASK_KINDS` as the documented vocabulary with the `x-*` extension pattern in the description.

### Neutral

- The enum value list (`lmm-qa`, `lmm-summarization`, …) is best-effort. Phase D may add, rename, or refine these; that's fine — the _schema_ doesn't change, only the documented vocabulary does.
- Storage shape (`String @db.VarChar(64)`) is identical to a closed-enum storage shape in Postgres terms.

## Alternatives considered

- **Add `lmm` only when needed.** Rejected — the entire point of this ADR is that "when needed" is too late. The reason ADR-0015 exists in 2026 is to spare us ADR-0042 in 2028.
- **Make every task-kind / model-class column `String` with no enum.** Rejected — gives up the type-safety benefit of `KNOWN_*` listings; reviewers and tooling can no longer auto-complete.
- **Make `CampaignTaskKind` also extensible "for consistency".** Rejected — annotation routing has closed-set invariants ([ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md)); extensibility there would break the orchestrator without buying anything.
- **Add Phase D LMM tooling now (red-team corpora, hallucination scorer).** Rejected — the work is real Phase D scope. We are not at Phase D. Premature implementation is more expensive than the door-opener cost.

## References

- WHO 2024 _Ethics & Governance of AI for Health: LMM Guidance_ — [WHO-2024-AI-Governance-LMMs-in-Health.pdf](../research/WHO-2024-AI-Governance-LMMs-in-Health.pdf).
- [ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md) — `CampaignTaskKind` is intentionally closed; this ADR doesn't change that.
- [ADR-0013](./0013-intended-use-statement-and-risk-tier.md) — IUS schema is fixed; LMM-specific IUS fields are a future extension, again with a `v` bump rather than a model_class flag.
- [ADR-0014](./0014-evidence-audit-trail-and-regulator-export.md) — audit events carry `taskKind` and `modelClass` in payload; extensibility here means the audit stream gracefully accepts future kinds too.

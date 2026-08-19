# ADR-0020: Scoring is dispatched per evaluation task kind, not hard-coded

- **Status:** proposed
- **Date:** 2026-08-19
- **Deciders:** Marc Lecoultre
- **Tags:** `area:evaluation` | `area:platform` | `phase:C` | `package:EP`

## Context

[ADR-0017](./0017-minimal-evaluation-surface.md) shipped exactly one scoring family. It fixed two
contracts to that family: the predictions payload (`itemId -> integer label`) and the scores shape
(a flat `EvaluationScores` of quadratic-weighted kappa, accuracy, referable sensitivity/specificity
and coverage). `scoreSubmission()` computed those metrics directly. For IDRiD diabetic-retinopathy
grading that was the correct scope.

It does not generalise, and the constraint has become external rather than technical:

- The challenge presents itself as a test of **generalisable** privacy-preserving evaluation. A
  platform that can only score ordinal image grading is a weak demonstration of that claim.
- Recruitment is capped by it. Co-organizers are approaching hospitals and universities whose
  datasets are nominal classification, segmentation and detection; the first prospective host from
  outside the co-organizing institutions brings span-level and speech tasks
  ([#428](https://github.com/FG-AI4H/oci-platform/issues/428)).
- Ordinal metrics are not merely incomplete for those tasks, they are **wrong**. Quadratic-weighted
  kappa rewards predicting a near-miss class, which is meaningful for a severity grade and
  meaningless for a nominal category.

Two constraints shape the design. Scoring correctness must be trusted before any result is published
(ADR-0017), so scoring stays testable code rather than configuration. And the sealed-execution output
path is an **exfiltration channel** — a model that cannot read the data out may still try to encode
it into its "predictions" — so every field added to that path is attack surface
([#414](https://github.com/FG-AI4H/oci-platform/issues/414)).

## Decision

Scoring is **dispatched through a registry keyed by `EvaluationTaskKind`**. Each kind declares three
things: a strict Zod schema for its predictions payload, a scorer, and the scores shape it returns.
`scoreByKind()` dispatches and computes nothing itself. Adding a scoring family is adding a registry
entry.

Consequences of that shape, all deliberate:

- **`EvaluationScores` becomes an envelope**, `{ kind, metrics }`, discriminated on `kind`. The flat
  ADR-0017 object survives unchanged as the `GRADING` member, and `GRADING` delegates to
  `scoreSubmission()` verbatim — a unit test asserts the registry result is `toStrictEqual` the
  direct call, because published results must not drift when the indirection lands.
- **Payload validation is separate from scoring.** `validatePredictionsPayload()` answers "is this
  the right shape" without touching ground truth, which is what lets a validation submission
  (WP6) be checked without the server loading hidden labels at all.
- **Every payload carries an item budget**, enforced on shape before any scoring work. A payload
  larger than any plausible evaluation split is not generosity.
- **A kind without a registered scorer fails loudly.** `isScorableTaskKind()` gates dispatch, so a
  task kind that exists in the enum but has no scorer raises rather than defaulting.
- **The enum is extended additively only**, with a matching Prisma migration.

## Consequences

### Positive

- A scoring family is now a bounded, unit-testable addition rather than a change to shared scoring
  code, so widening the challenge does not put existing published results at risk.
- Data-host recruitment stops being gated on the platform: a host offering a classification task can
  be onboarded without touching the scorer for grading.
- Payload shape checking without ground truth is what makes validation submissions safe.
- Heterogeneous metrics per kind make a single cross-task leaderboard arithmetically impossible,
  which reinforces the per-task reporting the challenge already commits to.

### Negative

- **Adding a kind is a monorepo-wide change, not a package-local one.** Widening the union breaks
  every exhaustive `Record<EvaluationTaskKindDb, T>` consumer. This is not hypothetical: adding
  `CLASSIFICATION` broke the `@oci/web` build at two label maps, because the change was typechecked
  in `apps/api` only. Four such sites exist in the evaluation surface today. Any future kind must
  sweep them.
- **The kind list is now known in two places** — the Prisma/Zod enum and the registry. They can
  drift. Mitigated by failing loudly rather than silently defaulting, but not eliminated.
- **Consumers must discriminate** on `kind` before reading metrics. A caller that assumes the flat
  grading shape compiles only because `GRADING` still has it.
- **Each new kind adds fields to the sealed-run output path**, which is attack surface. This is the
  reason kinds are landed against a real task definition from a named host rather than speculatively.
- One more indirection between a submission and its number, in code whose correctness must be
  trusted.

### Neutral

- ADR-0017's `GRADING` semantics, metrics and numbers are unchanged.
- `CLASSIFICATION` lands with this ADR. `SEGMENTATION`, `DETECTION` and `SPAN_EXTRACTION` are
  declared as planned and rejected at dispatch until each has a scorer.

## Alternatives considered

- **Keep one scorer and widen `EvaluationScores`** with the union of all metrics — rejected: the
  object becomes mostly-null for every task, and it would report ordinal agreement for nominal tasks
  where that figure is misleading rather than merely absent.
- **Store a per-task output JSON Schema in the database and score generically** — rejected: scoring
  correctness must be trusted before publication, and that means unit-tested code, not
  data-driven interpretation. It would also let a task author widen the sealed-run output contract
  without review.
- **Move scoring into `worker-eval`, per kind** — rejected: ground truth would have to enter the
  sandbox. ADR-0017 keeps scoring API-side precisely so it never does.
- **A NestJS module or class hierarchy per kind** — rejected: these are pure functions over two
  records; a registry of plain objects is the smaller thing that works.
- **(Chosen)** One registry keyed on task kind; payload schema, scorer and scores shape declared per
  kind; `GRADING` delegating verbatim to the ADR-0017 implementation.

## References

- [ADR-0017](./0017-minimal-evaluation-surface.md) — minimal evaluation surface, `GRADING` only
- [ADR-0018](./0018-evalai-front-door-oci-evaluation-backend.md) — execution modes and routes
- Task-kind generalisation: [#428](https://github.com/FG-AI4H/oci-platform/issues/428)
- Sealed-run output as attack surface: [#414](https://github.com/FG-AI4H/oci-platform/issues/414)
- Phase C epic: [#46](https://github.com/FG-AI4H/oci-platform/issues/46)
- `apps/api/src/modules/evaluation/scoring-registry.ts`

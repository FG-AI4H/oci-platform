# ADR-0017: Minimal evaluation surface (Phase C-lite)

- **Status:** proposed
- **Date:** 2026-07-29
- **Deciders:** Marc Lecoultre
- **Tags:** `area:evaluation` | `area:platform` | `phase:C` | `package:EP`

## Context

The OCI's differentiator is **model-to-data evaluation**: a model is sent to the data,
scored where the data sits, and only the metrics come back. That capability is Phase C
([#46](https://github.com/FG-AI4H/oci-platform/issues/46)) and is **not yet built** —
there is no `evaluation` module in `apps/api`.

Two forces make a minimal version urgent now:

1. **The GI-AI4H benchmarking challenge** (launching for the September China meeting) needs
   the platform to produce a real, scored evaluation, with per-task results rather than one
   global leaderboard (each host brings a different clinical question).
2. **The IDRiD demo** — the `idrid-grading-demo` dataset slice ([PR #388](https://github.com/FG-AI4H/oci-platform/pull/388))
   gives us hosted images + a held-back ground truth. We need something that scores a
   submission against that ground truth end to end.

Relevant existing assets:

- `apps/worker-eval` already **specifies** the sealed-run contract (a placeholder today):
  SQS inbox `oci-eval-submissions-{env}` → sandboxed Docker run against host-resident data →
  HTTP `POST /v2/submissions/{id}/result` outbox. It is the sanctioned single Python
  component (CLAUDE.md rule 9).
- BullMQ is used in-process for schedulers; SQS is the cross-service boundary to the sandbox.
- ADR-0014 defines the evidence/audit-trail expectations any evaluation must feed.

The constraint is **time and scope**: a demo in weeks, not a full challenge platform.

## Decision

We add a new NestJS **`evaluation`** module in `apps/api` (same controller/service/
repository/dto pattern as `catalog`) with two Prisma models — **`EvaluationTask`** (binds a
dataset + task type + metric config + a reference to the **hidden ground-truth labels**) and
**`Submission`** — and a shared **scoring service** (quadratic-weighted kappa, referable-DR
sensitivity/specificity, accuracy, coverage).

It exposes **two submission modes, sequenced**:

- **Mode 1 — predictions file (shipped first).** A participant uploads predicted grades; the
  API scores them **in-process** against the hidden labels and records the result. No ECS/SQS
  needed → demoable immediately.
- **Mode 2 — sealed container (next).** A participant submits a Docker image; the API enqueues
  to SQS `oci-eval-submissions-{env}`; `worker-eval` runs it against the host-resident data and
  `POST`s only the scores back to `/v2/submissions/{id}/result` — **reusing the contract that
  directory already specifies**.

Ground truth is held server-side and is **never** exposed as a dataset distribution. This is
Phase C-lite, tracked under [#46](https://github.com/FG-AI4H/oci-platform/issues/46).

## Consequences

### Positive

- A **real** scored evaluation inside OCI for the demo, not a mock.
- Mode 1 needs nothing beyond the API + DB, so it is demoable on the current dev stack.
- Mode 1 and Mode 2 share the same data model and API, so Mode 1 is **not throwaway** — Mode 2
  is an execution-path upgrade, not a rewrite.
- Reuses `worker-eval`'s already-designed SQS/HTTP contract rather than inventing a new one.
- Per-task results match the challenge's "no single global ranking" design and feed the
  ADR-0014 evidence trail.

### Negative

- Introduces a **Prisma migration** (deploy-impacting) for the two new tables.
- Mode 2 pulls in ECS + SQS + CDK wiring and **finishing the Python `worker-eval`** (the only
  Python component; sanctioned exception to rule 9).
- **Scoring correctness must be trusted** → the scoring service needs strong unit tests before
  any result is shown as authoritative.
- Hosting **hidden labels server-side** is a new data-handling responsibility (for the demo they
  are public IDRiD grades; for real sealed datasets they must stay host-side — see Mode 2).

### Neutral

- New `/v2/evaluation/*` and `/v2/submissions/*` endpoints and a new module boundary.
- Results are surfaced **per task**, not on a global leaderboard.

## Alternatives considered

- **Run the whole demo on the FG-AI4H EvalAI platform** (no OCI build) — rejected as the primary
  path: it leaves the evaluation surface a permanent external dependency and does not advance
  Phase C. (Retained only as a possible short-term compute fallback for Mode 2.)
- **Build the full Phase C surface now** (multi-phase challenges, GPU worker pool, regulator
  export, public leaderboards) — rejected: far too large for the demo window; violates "minimal".
- **Stub/mock the result in the UI** — rejected: not a real run; misleads reviewers who probe it.
- **Use BullMQ for the sealed run** instead of SQS — rejected: `worker-eval` is a separate
  (Python) service; SQS is the specified cross-service boundary. BullMQ stays for in-process
  schedulers only.
- **(Chosen)** Minimal `evaluation` module; Mode 1 (in-process scoring) first; Mode 2 (sealed
  container via the existing `worker-eval` SQS contract) next.

## References

- Phase C epic: [#46](https://github.com/FG-AI4H/oci-platform/issues/46)
- IDRiD demo slice: [PR #388](https://github.com/FG-AI4H/oci-platform/pull/388)
- `apps/worker-eval/README.md` — sealed-run contract
- [ADR-0014](./0014-evidence-audit-trail-and-regulator-export.md) — evidence / audit trail
- [ADR-0016](./0016-catalog-annotation-linkage.md) — catalog linkage pattern

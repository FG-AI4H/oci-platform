# The 3-gate workflow

Every annotation task in OCI moves through three gates. This is the canonical Standard Operating Procedure from ITU-T FG-AI4H DEL05-A03, locked architecturally in [ADR-0006](../adr/0006-annotation-integration-hub-orchestrator.md) Decision 3 and [ADR-0008](../adr/0008-annotation-persistence-and-provenance.md) §gate semantics.

Most annotators only ever work at gate 1. If you've been invited to arbitration or expert review, the relevant gate's section below applies.

## The state machine

```
              N annotators submit
                       |
                       v
INDEPENDENT ──disagree──► AWAITING_ARBITRATION ──no resolution──► AWAITING_EXPERT ──> COMPLETED
     │                              │                                                    ^
     │                              │                                                    │
     └──unanimous (IRR predicate)──┴───────arbitration resolves──────────────────────────┘
                                                                                         ▲
                                                                                         │
     ──N=1 single-rater shortcut───────────────────────────────────────────────────────┘
```

Any gate can also transition to `SKIPPED` via operator override (with a reason).

## Gate 1 — `INDEPENDENT`

This is where most labelling happens. The campaign manager has set `N` (default 3 per [ADR-0009](../adr/0009-annotation-task-assignment-and-multi-rater-policy.md) Decision 2; valid range 1–12). The task waits at this gate until `N` annotators with the `annotator` role have submitted their independent labels.

You see the task at this gate if:

- Your role includes `annotator`.
- You haven't already submitted for this task at this gate (one annotator, one submission per gate).
- You're under the bias-prevention cap (1.5×) for this campaign.

You do **not** see other annotators' labels for this task — they're blinded from you (per [ADR-0010](../adr/0010-annotation-metadata-exposure-and-blinding.md)).

### Gate progression

When the `N`th submission lands, the platform runs the **gate-1 IRR predicate** ([#215 slice 3](https://github.com/FG-AI4H/oci-platform/issues/215)):

- If all `N` annotators **agree unanimously** (per the campaign's chosen IRR metric and threshold), the task fast-forwards to `COMPLETED`. No arbitration needed.
- If they **disagree**, the task moves to `AWAITING_ARBITRATION`.

For `N=1` campaigns (single-rater shortcut), the task goes straight to `COMPLETED` after the one submission. This is allowed but discouraged for medical AI use cases.

## Gate 2 — `AWAITING_ARBITRATION`

Tasks land here when gate-1 annotators disagreed. The platform routes the task to a member of `arbitration-annotator`. As an arbitrator you see:

- The original `N` gate-1 submissions (now de-blinded — you need to see the disagreement).
- The campaign instructions (and any per-task notes).
- The same annotation tool as gate-1.

You produce a single arbitration label. Two outcomes:

1. **You can resolve it** — submit your label. The task transitions to `COMPLETED` with your label as final.
2. **You can't** (the disagreement is irreducible — e.g. expert opinion needed, instructions don't cover this edge case) — escalate. The task transitions to `AWAITING_EXPERT`.

You can also `SKIP` with a reason if the task is unfit for the campaign (image quality, PHI leakage, etc.).

The `arbitration-annotator` group is a different Cognito group from `annotator`. People can hold both, but the router treats them as separate role buckets.

## Gate 3 — `AWAITING_EXPERT`

The final gate. Routed to `expert-reviewer` — typically a clinical specialist, a domain expert, or the campaign's PI. As an expert reviewer you see:

- All gate-1 submissions.
- The gate-2 arbitrator's notes (why they couldn't resolve).
- The campaign instructions.
- Any per-task notes.

You produce **the final decision**. Per ADR-0008, expert review is final — there is no gate-4. The task transitions to `COMPLETED` with your label as the canonical label for the published dataset.

(Exception: a supervisor can roll the gate back via the supervisor review queue per [ADR-0011](../adr/0011-annotation-sample-rejection.md). This is rare and audited.)

## `SKIPPED`

Any gate can transition to `SKIPPED` with an operator reason. Skips bypass the normal lifecycle and don't count toward the gate's `N`. The campaign manager reviews skipped tasks and either retires them or re-queues them with a clarification.

## `COMPLETED`

Terminal state. The platform:

- Stamps `completedAt`.
- Locks the task — no further claims.
- Records the canonical label (from the gate that produced the final decision) for the published annotation set.
- Updates campaign-level progress counters.

The published annotation set captures the **full provenance** (per ADR-0008): which annotators submitted at gate 1, which arbitrator resolved, which expert decided, what instructions version applied, what tool version was used. Aggregate-only — your individual name is not exposed (ADR-0012 Decision 4).

## Why three gates?

The short version: medical-AI groundtruth is contested. A single rater's label is one opinion; an unanimous group of three is **stronger evidence**; an arbitrator + expert chain captures the **adversarial verification** that regulators (FDA, IMDRF, EU AI Act) increasingly demand for high-risk applications.

The long version is in ADR-0006 + the parent FG-AI4H DEL05-A03 standard.

## What this means for you

- Working at **gate 1** is the common case. Just label, don't overthink it. If others disagree with you, that's the _signal_ — arbitration and expert review catch the genuinely hard cases. The system isn't grading your individual call against a hidden truth.
- If you regularly disagree with peers (low IRR), don't panic. Read the calibration prompt when it shows up, and tell the campaign manager which parts of the instructions felt ambiguous. Drift is usually a symptom of bad instructions, not bad annotators.
- If you're at **gate 2 or gate 3**, treat the prior gate's work as evidence. You're not their judge — you're the next layer of evidence.

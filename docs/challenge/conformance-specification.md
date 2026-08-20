# Conformance specification for evaluation solutions

What a privacy-preserving evaluation solution must satisfy to be accepted into the **GI-AI4H
Benchmarking Challenge**. Decision: [ADR-0018](../adr/0018-evalai-front-door-oci-evaluation-backend.md);
scoring surface: [ADR-0017](../adr/0017-minimal-evaluation-surface.md) and
[ADR-0020](../adr/0020-task-kind-scoring-registry.md).

The challenge's primary call is for the solutions themselves. Before a health AI model can be
evaluated without exposing the data or the model, a system that does exactly that must exist and be
shown to work.

This document is normative for acceptance. Where it describes something the platform does not yet
enforce in code, it says so — see [§8](#8-implementation-status).

## 1. What a solution is

A solution evaluates a submitted model against a data host's data and returns results, without
exposing the data to the model developer or the model to the data host. It may use sealed execution,
homomorphic encryption, confidential computing, federated evaluation, or another approach.

A solution need not be built from nothing. **Adapting existing work to this specification is a valid
and expected route to entry.**

Within the platform a solution is represented as a **route**: a versioned, reviewable record, not a
configuration flag. Every published score names the route and route version that produced it.

## 2. Interface requirements

A solution must:

1. **Accept a dispatch** carrying a submission identifier, a task identifier, a model reference, and
   an execution deadline. See [Appendix A](#appendix-a--dispatch-and-result-payloads).
2. **Execute the model against the task's data** without the model developer obtaining the data and
   without the data host obtaining the model.
3. **Return either predictions or metrics** — never patient-level data, never model internals.
4. **Return a classified failure code** on error, with operator detail kept out of the participant
   response. See [Appendix B](#appendix-b--failure-taxonomy).
5. **Be reproducible**: the same model, task and route version produce the same result, or the
   solution declares and quantifies its non-determinism.
6. **Enforce its declared operational envelope.** A declared runtime or memory cap that is not
   actually applied is a conformance failure, not a documentation error.

A solution using an execution family other than sealed execution still uses the payloads in
Appendix A at the boundary.

## 3. Required declarations

Three declarations are filed per route version, in the shapes given in
[Appendix C](#appendix-c--declaration-shapes). They are published alongside every result the route
produces.

**Threat model.** Which adversaries the solution defends against — data host, model developer,
platform operator, route provider, network observer — and what it explicitly does **not** defend
against. A declaration claiming no out-of-scope adversaries will not pass review. Every real system
has boundaries; naming them is the point.

**Disclosure profile.** What each party observes during and after a run; where the trust anchor lies
(contractual, hardware attestation, or cryptographic assumption); who holds decryption keys or
attestation roots; and whether a run is independently reproducible.

**Operational envelope.** Permitted operations, arithmetic precision, runtime and memory caps, the
constraints imposed on submitted models, and — once measured — the fidelity gap against an
unconstrained plaintext baseline on the reference task.

## 4. Reference task

Every solution demonstrates against a common reference task before it may carry a host's clinical
task. The reference task uses public data with a published plaintext baseline, so that a solution's
correctness and fidelity gap are measurable independently of any host's data.

Demonstration is complete when the solution produces a result on the reference task, its fidelity gap
against the plaintext baseline is measured and recorded, and its declared envelope is observed to be
enforced.

**Item identifiers.** A task publishes the full set of item identifiers it scores against, together
with its item count, on the task page and in `GET /v2/evaluation/tasks/{slug}`. A sealed run receives
the same set at run time as `index.json` on its `/input` mount. Read that set rather than generating
it — identifiers are not guaranteed to be contiguous or densely numbered. Items you omit are
permitted and reported as reduced coverage; identifiers a task does not recognise are a validation
failure.

**Validation submissions.** Unscored, unlimited, and open throughout. A validation submission checks
the interface contract only — payload shape, duplicate identifiers, label range, and which submitted
identifiers the task does not recognise — and never touches reference labels. It is the intended
debugging loop: in a model-to-data challenge a participant cannot debug against data they never see.
Scored submissions are capped at **three per task per week and ten per task in total**; validation
submissions do not count toward either.

## 5. Review and adversarial testing

**No solution's claims are accepted on assertion.** This applies to the OCI reference implementation
and to routes contributed by co-organizers on the same terms as to any other entrant.

Each route version passes:

1. **Technical review** — the declarations are coherent, the implementation matches them, and the
   envelope is enforced rather than merely stated.
2. **Adversarial testing** — a deliberate attempt to demonstrate disclosure the route claims to
   prevent: exfiltration through outputs, through logs, through timing or resource side channels,
   through malformed inputs, or through repeated queries.

A route version is `DECLARED` on submission, `UNDER_REVIEW` during assessment, and `APPROVED` before
any result it produces is published. Results produced by a route version that is later `REJECTED` or
`WITHDRAWN` are retracted; they remain in the record with their review notes rather than being
deleted, because a published result that was later withdrawn has to stay explicable.

Two points of process are **open governance decisions** and are not settled by this document: who
performs the adversarial testing, and whether a demonstrated leak withholds the affected results or
publishes them alongside the finding.

## 6. How results are reported

A model's score is always published together with the route and route version that produced it. A
score without its route is not a meaningful result, and the platform does not return one.

Solutions are assessed on correctness, non-disclosure and cost; models are scored per clinical task,
on metrics defined by the contributing institution. There is deliberately no cross-task leaderboard
and no threshold for what constitutes a sufficient model — each task answers a different clinical
question. The purpose is not to declare one technique the winner, but to make the trade-off
measurable.

## 7. Submitting a solution

Contact the organizers with the three declarations and a reference to a runnable implementation.

Contributed routes are **integrated by the platform rather than submitted through it** — a route
executes other participants' models against a host's data, so it is onboarded deliberately rather
than self-served.

Contact: `marc.lecoultre@itu.int`.

## 8. Implementation status

Stated plainly so that nobody builds against a guarantee that is not yet enforced. Verified
2026-08-20.

| Capability                                               | Status                            |
| -------------------------------------------------------- | --------------------------------- |
| Predictions scoring against server-held labels (Mode 1)  | Enforced in code                  |
| Sealed container execution and sandbox controls (Mode 2) | Enforced in code                  |
| Result outbox, idempotent, classified failure codes      | Enforced in code                  |
| Validation submissions and scored-submission quotas      | Enforced in code                  |
| Task-kind scoring registry (grading, classification)     | Enforced in code                  |
| Published item identifiers per task                      | Enforced in code                  |
| Route model, review status and retraction (§1, §5, §6)   | **Specified; not yet enforced**   |
| Encrypted computation adapter (Mode 3)                   | Specified; track opens 1 Nov 2026 |

Until the route model lands, results are not yet gated on `APPROVED` review status. No result is
published as authoritative before it is.

---

## Appendix A — Dispatch and result payloads

These are the boundary payloads. A solution consumes the first and produces the second.

**Dispatch.** Delivered as a JSON message on the submission queue:

| Field          | Type     | Notes                                                      |
| -------------- | -------- | ---------------------------------------------------------- |
| `submissionId` | uuid     | Identifies the submission this run scores                  |
| `taskSlug`     | string   | Resolves the task, its dataset and its input mount         |
| `routeId`      | uuid     | Which route executes this                                  |
| `routeVersion` | string   | Pinned at dispatch; recorded on the result                 |
| `imageRef`     | string   | Registry reference **including digest**; tags are rejected |
| `imageDigest`  | string   | `sha256:…`, verified after pull                            |
| `timeoutSec`   | int      | Hard wall-clock cap from the task's operational envelope   |
| `callbackUrl`  | url      | Absolute result-outbox URL                                 |
| `deadline`     | ISO-8601 | After this the run is abandoned rather than started        |

**Container interface** (sealed execution). The participant's image is run with:

- **`/input`** — read-only mount of the evaluation inputs, containing an `index.json` listing the
  item identifiers for the run.
- **`/output`** — writable, empty, `tmpfs`, size-capped. The image writes `predictions.json`.
- No arguments; the image's own `ENTRYPOINT`/`CMD` runs.
- Environment: `OCI_INPUT_DIR=/input`, `OCI_OUTPUT_DIR=/output`. Nothing else — no credentials, no
  submission identifier, no task metadata beyond what `/input` carries.

```json
{ "predictions": { "<itemId>": 0, "<itemId>": 3 } }
```

Labels are integers in `[0, numClasses-1]`. The payload is validated against the schema the task's
kind declares, and is size-capped before parsing.

**Result.** `POST /v2/submissions/{id}/result`, authenticated as the runner, **idempotent** —
replaying a result after a terminal state is a no-op, never a second scoring:

```jsonc
{
  "routeVersion": "string",
  "durationMs": 12345,
  // exactly one of:
  "predictions": { "<itemId>": 0 }, // platform scores against held labels
  "metrics": {
    /* the task kind's scores shape */
  }, // host-side scoring
  // on failure:
  "failure": { "code": "TIMEOUT", "detail": "operator-facing text" },
}
```

Rejected: an unknown submission, one already in a terminal state, both `predictions` and `metrics`
present, neither present, or a `routeVersion` that does not match the dispatched one.

**Sandbox controls.** Non-negotiable for sealed execution, and the baseline a contributed
sealed-execution route is measured against. Each maps to a disclosure risk:

| Control                                                    | Prevents                                |
| ---------------------------------------------------------- | --------------------------------------- |
| No network access                                          | Exfiltration of host data by the model  |
| Read-only root filesystem; `/output` the only write        | Persistence and tampering               |
| Non-root user; all capabilities dropped; no new privileges | Escape to the host                      |
| Memory, CPU and process limits from the envelope           | Denial of service against the host      |
| Wall-clock timeout, hard-killed                            | Hanging runs                            |
| Pull and run **by digest**, never by tag                   | Image substitution after review         |
| No host path, socket or device mounts                      | Access to anything outside `/input`     |
| Container removed and image pruned after the run           | Retention of the participant's model    |
| `/output` size cap                                         | Bulk data smuggled out as "predictions" |

Two consequences of that table are worth stating on their own, because they are the guarantee rather
than a detail of it:

- **Container stdout and stderr are captured for operators and never returned to the participant.**
  A model that prints the pixel values it was given has exfiltrated the data if those logs are echoed
  back. This is a review checkpoint, not a nicety.
- **The participant's image is not inspected, copied or retained.** The guarantee runs both ways.

## Appendix B — Failure taxonomy

Every failure sets the submission to `FAILED` with a **classified code**. Participant-facing text is
derived from the code alone; operator detail stays in logs.

`IMAGE_PULL_FAILED` · `DIGEST_MISMATCH` · `STARTUP_FAILED` · `TIMEOUT` · `OOM_KILLED` ·
`NONZERO_EXIT` · `NO_OUTPUT` · `MALFORMED_OUTPUT` · `UNKNOWN_ITEM_IDS` · `OUTPUT_TOO_LARGE` ·
`NETWORK_ATTEMPT_DETECTED` · `INTERNAL_ERROR`

`NETWORK_ATTEMPT_DETECTED` is reported to the operator and to the data host rather than silently
swallowed. A model attempting egress inside a sealed run is a finding about that submission, not a
transient error.

## Appendix C — Declaration shapes

Filed per route version and validated on write. A malformed declaration is rejected at the boundary,
not stored as loose text.

**`ThreatModel`**

- `adversaries` — each with `party`, `capability`, and `defended` (boolean).
- `assumptions` — what the guarantee rests on, e.g. a hardness assumption or an attestation root.
- `outOfScope` — explicit non-guarantees. **An empty `outOfScope` is a review finding**, not a strong
  result.

**`DisclosureProfile`**

- `observations` — per party (data host, model developer, platform operator, route provider): what
  each observes during and after a run.
- `trustAnchor` — `CONTRACTUAL`, `HARDWARE_ATTESTATION` or `CRYPTOGRAPHIC`.
- `keyGovernance` — who holds decryption keys or attestation roots.
- `reproducible` — boolean, plus the method by which a run is reproduced.

**`OperationalEnvelope`**

- `permittedOperations`, `arithmeticPrecision`.
- `maxRuntimeSec`, `maxMemoryMb` — **enforced by the sandbox**, not merely documented. A declared cap
  the runner does not apply is a defect.
- `modelConstraints` — architecture limits participants must design to.
- `fidelityGap` — measured delta against an unconstrained plaintext baseline on the reference task.
  Null until measured.

Declarations are **immutable** once a route version leaves `DECLARED`. Changing a declaration means a
new version, so that a review outcome always applies to exactly what was reviewed.

# Conformance specification for evaluation solutions

GI-AI4H Benchmarking Challenge · WG-Data · version of 20 August 2026

**This is the published, participant-facing specification** referenced from the
challenge page.

Phase 1 of the challenge calls for **privacy-preserving evaluation solutions**.
Before a health AI model can be evaluated without exposing the data or the model,
a system that does exactly that must exist and be shown to work. This document
says what such a system must do to be accepted, and what it must declare.

---

## 1 What counts as a solution

A solution evaluates a submitted model against a data host's data and returns
results, without exposing the data to the model developer or the model to the
data host.

It may use sealed execution, homomorphic encryption, confidential computing,
federated evaluation, or an approach not on that list. The challenge is
technique-neutral: what is assessed is what your method guarantees, what it
costs, and whether the guarantee survives inspection.

**A solution need not be built from nothing.** Adapting existing work to this
specification is a valid and expected route to entry.

## 2 The interface

A solution receives a dispatch, executes the model against the task's data, and
returns either predictions or metrics. The reference implementation uses the
following contract; a solution using a different execution family still meets it
at the boundary.

### 2.1 Dispatch

A JSON message carrying: the submission identifier; the task identifier; the
route and route version executing it; the model reference **including its image
digest**; a wall-clock timeout; a callback URL; and a deadline after which the
run is abandoned rather than started.

Tags are refused. A model is dispatched by digest, because a tag can be
repointed after review.

### 2.2 Executing the model

The reference implementation runs a participant container with:

- **`/input`** — read-only, containing the evaluation items and an `index.json`
  listing their identifiers.
- **`/output`** — writable, empty, size-capped. The model writes
  `predictions.json`.
- Environment: `OCI_INPUT_DIR`, `OCI_OUTPUT_DIR`. Nothing else — no credentials,
  no task metadata beyond what `/input` carries.

`predictions.json`:

```json
{ "predictions": { "<itemId>": 0, "<itemId>": 3 } }
```

Integer labels in `[0, numClasses-1]`. Missing items are permitted and reported
as reduced coverage. Unknown item identifiers are a validation failure. A
payload may carry at most **100,000 items** — a payload larger than any plausible
evaluation split is rejected on shape, before scoring.

### 2.3 Returning a result

A solution returns **either** predictions, for the platform to score against
reference labels it holds, **or** metrics, where the host scored against its own
labels. Never both, never neither, and never patient-level data or model
internals.

Results are idempotent: re-delivering the same result is a no-op, not a second
scoring.

On failure, a solution returns a classified code — `TIMEOUT`, `OOM_KILLED`,
`NONZERO_EXIT`, `NO_OUTPUT`, `MALFORMED_OUTPUT`, `UNKNOWN_ITEM_IDS`,
`OUTPUT_TOO_LARGE`, `NETWORK_ATTEMPT_DETECTED`, `DIGEST_MISMATCH`,
`IMAGE_PULL_FAILED`, `STARTUP_FAILED`, `INTERNAL_ERROR`. Participant-facing text
is derived from the code alone; operator detail stays in host-side logs.

### 2.4 Containment, and why the details are published

The reference implementation blocks outbound network access; mounts a read-only
root filesystem with `/output` the only writable path; runs non-root with all
capabilities dropped and no privilege escalation; applies memory, CPU and process
limits; enforces a hard wall-clock timeout; pulls and runs by digest; mounts no
host path, socket or device; removes the container and prunes the image after the
run; and caps the size of `/output`.

**Container stdout and stderr are captured for operators and never returned to
the participant.** A model that prints the pixel values it was given has
exfiltrated the data if those logs are echoed back. This is a review checkpoint,
not a nicety, and any solution is expected to close the same channel.

Equally, the participant's model is not inspected, copied or retained. The
guarantee runs both ways.

## 3 What a solution must declare

Three declarations per **route version**, published alongside every result the
route produces. Declarations are frozen once review begins; changing one means a
new version.

### 3.1 Threat model

The adversaries your method defends against — data host, model developer,
platform operator, route provider, network observer — and what it explicitly does
**not** defend against. State the assumption the guarantee rests on.

A declaration with nothing out of scope will not pass review. Every real system
has boundaries; naming them is the point, and a threat model that claims none
reads as one that has not been thought about.

### 3.2 Disclosure profile

What each party observes during and after a run. Where the trust anchor sits:
contractual, hardware attestation, or a cryptographic assumption. Who holds
decryption keys or attestation roots. Whether a run is independently
reproducible, and by what method.

### 3.3 Operational envelope

Permitted operations, arithmetic precision, runtime and memory caps, and the
constraints your method imposes on a submitted model — what a developer must
change to run under it. Once measured, the **fidelity gap** against an
unconstrained plaintext baseline on the reference task.

Declared caps are **enforced**, not merely documented. A limit the runner does
not apply is a conformance failure, not a documentation error.

## 4 The reference task

Every solution demonstrates against a common reference task before it carries a
host's clinical task. The reference task uses public data with a published
plaintext baseline, so correctness and fidelity gap are measurable independently
of any host's data.

The first reference task is **diabetic-retinopathy grading** on a licensed public
slice, scored on quadratic-weighted kappa, referable sensitivity and specificity,
accuracy and coverage.

Demonstration is complete when the solution produces a result on the reference
task, its fidelity gap against the plaintext baseline is measured and recorded,
and its declared envelope is observed to be enforced.

## 5 Scoring families a solution may encounter

A task declares its scoring family, and the platform scores accordingly.
Currently:

| Family           | Payload           | Metrics reported                                                                                 |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `GRADING`        | one ordinal label | quadratic-weighted kappa, accuracy, referable sensitivity/specificity, coverage                  |
| `CLASSIFICATION` | one nominal label | accuracy, balanced accuracy, macro and micro F1, per-class precision/recall/F1/support, coverage |

Segmentation, detection and span extraction are in development. Metrics are
always reported with the family that produced them, because a number means
nothing without knowing which family it came from.

## 6 Review and adversarial testing

**No solution's claims are accepted on assertion.** This applies to the reference
implementation and to routes contributed by co-organizers on exactly the same
terms.

Each route version passes:

1. **Technical review** — the declarations are coherent, the implementation
   matches them, and the envelope is enforced rather than stated.
2. **Adversarial testing** — a deliberate attempt to demonstrate disclosure the
   route claims to prevent: exfiltration through outputs, through logs, through
   timing or resource side channels, through malformed inputs, or through repeated
   queries.

Reviewers work in pairs, with at least one drawn from outside the co-organizing
institutions.

A route version is `DECLARED` on submission, `UNDER_REVIEW` during assessment,
and `APPROVED` before any result it produces is published. Results produced by a
version later `REJECTED` or `WITHDRAWN` are retracted, with the review outcome
published alongside.

**Where this stands today (20 August 2026).** Review and the route lifecycle above
are the process every solution is held to, and they govern the first published
results in January 2027. The lifecycle is not yet enforced by the platform in
code: no result has been published, and none will be until it is. Said plainly
because a specification that quietly describes a control it does not yet have is
the thing this challenge exists to argue against.

## 7 How results are reported

A model's score is always published together with the route and route version
that produced it. A score without its route is not a meaningful result, and the
platform does not return one.

Solutions are assessed on correctness, non-disclosure and cost. Models are scored
per clinical task. There is no cross-task ranking: each task answers a different
clinical question.

**Results are not a regulatory approval, certification or endorsement of any
model.**

## 8 Dates

| Date                 | What                                                   |
| -------------------- | ------------------------------------------------------ |
| Open now             | Register a solution; validation submissions unlimited  |
| **8 September 2026** | Register to present at the GI-AI4H meeting in Hangzhou |
| 18 September 2026    | Solution presentations, Hangzhou                       |
| 1 November 2026      | Encrypted-computation demonstration track opens        |
| 18 December 2026     | Phase 1 closes, 23:59 UTC                              |
| January 2027         | Phase 1 results published                              |

## 9 Submitting a solution

Contact the organizers with the three declarations and a reference to a runnable
implementation. Contributed routes are integrated by the platform rather than
self-served: a route executes other participants' models against a hospital's
data, so it is onboarded deliberately.

Marc Lecoultre, WG-Data — marc.lecoultre@itu.int

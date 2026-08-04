# ADR-0018: EvalAI is the challenge front door, the OCI is the evaluation backend

- **Status:** accepted
- **Date:** 2026-07-30
- **Deciders:** Marc Lecoultre
- **Tags:** `area:evaluation` | `area:platform` | `phase:C` | `package:EP`

## Context

The **GI-AI4H Benchmarking Challenge** is publicly announced: registration opens 2026-07-31,
interim results are presented at the GI-AI4H Annual Meeting in Hangzhou (16–18 September 2026),
and the submission window closes 2026-12-18. The public description commits the challenge to the
**AI for Good challenge platform** (`competition.aiforgood.itu.int`, challenge 493 — built on the
open-source EvalAI framework), _extended_ with a privacy-preserving evaluation capability built on
the OCI. Tsinghua University is co-organizer.

[ADR-0017](./0017-minimal-evaluation-surface.md) specified the evaluation surface — `EvaluationTask`,
`Submission`, in-process scoring, and a sealed-container path over SQS — but assumed the OCI owns
submission intake. It does not. Participants register and submit on EvalAI, which already has the
accounts, the task listing, and the results pages. Nothing participant-facing can be rebuilt before
the call opens, and duplicating a working public good would be wrong regardless of the deadline.

A second force arrived on 2026-07-30. On a call with Tsinghua (Qiao Hui, AI Eye Clinic; Song Bian,
homomorphic encryption) the challenge scope broadened from sealed model-to-data execution to
**technique-neutral privacy-preserving evaluation**. Under homomorphic encryption the _model_ also
remains in ciphertext, so neither party discloses — a stronger claim than model-to-data, and one
that ADR-0017's two modes cannot express.

That broadening carries a consequence for this ADR. Before any clinical model can be evaluated
without exposing the data or the model, a system that does exactly that must exist and be shown to
work — so the challenge's **primary call is for the evaluation solutions themselves**, not for
clinical models. Routes are therefore **competitive entries submitted by third parties**, not merely
platform capabilities the OCI implements. The OCI's Mode 2 is the **reference implementation** and
the baseline other routes are measured against; the OCI does not compete.

Constraints that shape the seam:

- Both stacks live in AWS account `601883093460`, so IAM and SQS between them are straightforward.
  The EvalAI stack is **not** in CDK: it sits in the hand-built flat public VPC `vpc-0165820af0626153f`,
  with a documented availability incident on 2026-07-15 and an open Security Hub RDS.46 exception.
- EvalAI's default `submission-worker` pulls submissions to central compute. That cannot satisfy the
  non-disclosure premise. Its **remote-evaluation** path can — the `remote-worker` image is already
  present in the account's ECR.
- Identity is split: EvalAI has its own accounts; the OCI has Cognito with the
  [ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md) assurance tiers and
  BuilderStatus.

## Decision

**EvalAI owns the participant-facing surface** — registration, task listing, submission intake and
results display. **The OCI owns evaluation execution and scoring.** The seam is EvalAI's
remote-evaluation path: submissions are published to `oci-eval-submissions-{env}`, consumed by the
OCI, dispatched to an execution mode, and the resulting metrics written back to both the OCI
`Submission` record and EvalAI's submission API.

The OCI supports **three execution modes behind one submission and scoring contract**:

| Mode | Name          | Execution                                                              | Introduced |
| ---- | ------------- | ---------------------------------------------------------------------- | ---------- |
| 1    | `PREDICTIONS` | Predictions file scored in-process against server-held labels          | ADR-0017   |
| 2    | `CONTAINER`   | Sealed container run host-side by `worker-eval`; only metrics return   | ADR-0017   |
| 3    | `ENCRYPTED`   | Evaluation computed on ciphertext by a route provider's implementation | this ADR   |

A route is either the OCI reference implementation or a third-party entry. Each `EvaluationTask`
declares its route, and each route declares three records the OCI stores and publishes alongside
every result:

- a **threat model** — the adversary the route claims to defend against, and what it explicitly does
  not defend against;
- a **disclosure profile** — what each party observes, where the trust anchor lies (contractual,
  hardware attestation, or cryptographic assumption), how keys and attestations are governed, and
  whether the run is independently reproducible;
- an **operational envelope** — permitted operations, arithmetic precision, runtime and compute
  caps, and, where a plaintext reference exists, the measured **fidelity gap** against an
  unconstrained baseline on the same task.

**No route's claims are accepted on assertion.** Every route — including the OCI reference
implementation and any route contributed by a co-organizer — passes independent technical review and
adversarial testing against its declared threat model before results obtained through it are
published. Routes are **versioned**, and every `Submission` records the route and route version that
produced its score, so a review outcome can be applied to exactly the results it affects.

The OCI never holds decryption keys for Mode 3.

## Consequences

### Positive

- The call opens on schedule. Registration, task listing and community are not rebuilt, and the OCI
  is off the critical path for participant-facing UI.
- Reuses the SQS boundary ADR-0017 already specifies and the remote-evaluation path EvalAI already
  ships, rather than inventing an integration.
- Adding a privacy technology becomes **adding an execution adapter**, not adopting a new platform.
- The disclosure profile and operational envelope give the challenge's second and third assessment
  axes a data model, so "what does this privacy guarantee cost" is a stored, queryable result rather
  than prose in a report.
- Advances Phase C ([#46](https://github.com/FG-AI4H/oci-platform/issues/46)) instead of deferring it
  to an external platform.

### Negative

- **OCI results are only as available as EvalAI.** A legacy stack in a flat public VPC, with an open
  RDS.46 exception and a six-day outage in July, becomes a dependency of a public international
  challenge running to December.
- **Two identity systems.** Challenge participants hold EvalAI accounts, not Cognito identities, so
  the ADR-0003 assurance tiers and BuilderStatus do not gate challenge submissions. A data host
  admitting third-party code needs a vetting answer that is not the OCI's — open, and overlapping the
  tool-integration security boundary in [#314](https://github.com/FG-AI4H/oci-platform/issues/314).
- **Results exist in two systems.** The OCI `Submission` record is authoritative for the scored value
  and its provenance; EvalAI's record is authoritative for participant identity and timing. Any
  divergence is a defect, and reconciliation is now a thing that must be tested.
- Mode 3 introduces a **third party** — the route provider — that is neither data host nor model
  developer, and on Track B that provider is a co-organizer.
- **The OCI now operates a platform whose privacy guarantees it did not write.** Accepting routes as
  competitive entries means third-party cryptographic and enclave implementations execute against
  host data under the OCI's name. Review capacity, not engineering capacity, becomes the limit on how
  many routes the challenge can carry.
- **Adversarial testing needs an owner, a method and a disclosure policy.** Committing publicly to it
  is only credible if all three exist. Unresolved: who performs it, and whether a demonstrated leak
  withholds the affected results or publishes them alongside the finding. Publishing is the more
  defensible answer for a WHO-branded challenge, but it must be decided before the first result, not
  at the point one is contested.
- **A route can fail review after results exist.** Route versioning on every `Submission` makes
  retraction tractable, but retraction is now a workflow the platform must support rather than an
  incident to improvise through.
- **Cross-border posture differs per route.** Mode 2 keeps data in-country. Mode 3 moves ciphertext,
  which remains personal data under PIPL and GDPR. Each host's legal clearance must be obtained per
  route, not once.

### Neutral

- ADR-0017's Mode 1 / Mode 2 naming carries forward unchanged; Mode 3 extends the enum.
- A new `EvaluationRoute` concept sits alongside `EvaluationTask`, carrying the threat model,
  disclosure profile, operational envelope, a version, and a review status.
- Results are reported as a pair — the model's score and the route that produced it — since a score is
  only as meaningful as the route it came through.

## Alternatives considered

- **The OCI owns the full participant surface** (registration, submissions, leaderboard) — rejected:
  cannot be built before 2026-07-31, duplicates a functioning public good, and contradicts the public
  commitment to the AI for Good platform.
- **EvalAI runs the evaluation with its own workers** — rejected: the default `submission-worker`
  pulls submissions to central compute, which cannot satisfy the non-disclosure premise, and it leaves
  Phase C unadvanced (already rejected in ADR-0017).
- **Synchronous HTTP callback from EvalAI into the OCI API** instead of SQS — rejected: couples the two
  stacks at request time, and sealed and encrypted runs are long-running and host-scheduled. SQS is the
  specified cross-service boundary.
- **Sealed execution as the only route** — rejected 2026-07-30: technique-neutrality is now a public
  commitment, and the model-constraint assessment axis exists precisely to compare routes.
- **(Chosen)** EvalAI as front door over a remote-evaluation SQS seam; the OCI as evaluation backend
  with three execution modes behind one scoring contract.

## References

- **Implementation plan:** `docs/planning/evaluation-challenge-2026-08/` in the private companion repo
  `FG-AI4H/oci-platform-internal` — work packages, acceptance criteria, dates, and the four
  implementation specs derived from this ADR
- [ADR-0017](./0017-minimal-evaluation-surface.md) — minimal evaluation surface (Modes 1 and 2)
- [ADR-0003](./0003-tiered-identity-assurance-and-access-requirements.md) — identity assurance tiers
- [ADR-0013](./0013-intended-use-statement-and-risk-tier.md) — intended-use statement on submissions
- [ADR-0014](./0014-evidence-audit-trail-and-regulator-export.md) — evidence / audit trail
- Phase C epic: [#46](https://github.com/FG-AI4H/oci-platform/issues/46)
- Tool-integration security boundary: [#314](https://github.com/FG-AI4H/oci-platform/issues/314)
- `apps/worker-eval/README.md` — sealed-run contract
- Challenge page: https://competition.aiforgood.itu.int/web/challenges/challenge-page/493/overview

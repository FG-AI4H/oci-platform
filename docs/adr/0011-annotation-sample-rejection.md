# ADR-0011: Sample-rejection workflow

- **Status:** accepted
- **Date:** 2026-05-16
- **Deciders:** Marc Lecoultre (OCI Platform lead)
- **Tags:** `area:annotation` `area:operations` `area:governance`

## Context

Every annotation campaign hits unannotateable samples on day one: corrupt files, wrong modality, missing metadata, PHI burned into pixels, task-incompatible content. The existing annotation ADRs (0006–0010) have no path for this — the workflow engine ([ADR-0006](./0006-annotation-integration-hub-orchestrator.md)) assumes every assigned task results in an annotation submission or stays in `IN_PROGRESS`.

Industry practice across medical-annotation platforms (iMerit, Encord, Flywheel) is **structured rejection with reason codes + supervisor review + dataset-host feedback loop**. Skipping samples silently loses the audit trail and prevents the host from fixing the underlying data-quality problem.

## Decision

### 1. First-class rejection action

At gate 1, an annotator can **reject a sample** alongside the existing "submit annotation" action. Rejection is captured with a structured reason code + free-text justification. The task transitions to a new state `REJECTED_PENDING_REVIEW`.

### 2. Reason taxonomy

| Code                | Meaning                                                                                             | Default disposition                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `corrupt-file`      | Parse error, file missing, integrity-check failure                                                  | Sample removed from campaign; P2 issue raised on catalog host                                           |
| `wrong-modality`    | Manifest says CT, file is MRI (or similar mismatch)                                                 | Sample removed; P2 host issue                                                                           |
| `missing-metadata`  | Required field (per [ADR-0010](./0010-annotation-metadata-exposure-and-blinding.md)) not present    | Sample removed; P2 host issue                                                                           |
| `phi-leak`          | Identifying info burned into pixels / text / metadata that bypassed catalog filtering               | Sample quarantined; **P1** host issue; SENSITIVE-tier campaigns auto-pause until catalog confirms scope |
| `task-incompatible` | Sample is fine but doesn't match the campaign's task kind (e.g. knee X-ray in a pneumonia campaign) | Sample removed; no host issue (campaign-config mismatch, not data bug)                                  |
| `other`             | Free-text required                                                                                  | Supervisor judges per case                                                                              |

Reason codes are declared as a versioned Zod enum in `@oci/shared-types` so the API + UI stay aligned.

### 3. Supervisor review

Rejections enter the task supervisor's queue with a 48-hour SLA. Supervisor either:

- **Confirms** the rejection — sample status set to `REJECTED` (terminal); disposition per the reason table executes (host issue raised, sample removed from campaign, etc.)
- **Overrides** — task returned to queue, picked up by the next-eligible annotator (router skips the original rejector for that sample). Supervisor override is logged with rationale.

Supervisor inaction past 48 h auto-confirms (with a log entry noting the timeout).

### 4. Catalog feedback loop

Confirmed rejections of `corrupt-file`, `wrong-modality`, `missing-metadata`, and `phi-leak` raise issues on the catalog dataset's `for-hosts` admin dashboard with the rejection reason + affected sample id + annotator commentary. Hosts see a "data-quality issues" queue per dataset; they triage + patch + re-publish the manifest. PHI-leak issues additionally fire a CloudWatch alarm so operators see them in real time.

### 5. Quota + scoring integration

- Rejections **do NOT** count toward the bias-prevention 1.5× cap ([ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md) Decision 1) — they're not annotation work.
- Rejections **do** count toward `taskCount` for fatigue / drift detection — the annotator did look at the sample.
- Rejections **do NOT** affect `irrAgainstGold` / `irrAgainstPeers` / `irrAgainstSelf` — no annotation was produced.
- A separate per-annotator metric `rejectionRate` is tracked. An annotator with rejection rate > 3× the campaign median is flagged for supervisor review (rejection-spam detection).

### 6. Audit trail

Every rejection event lands in the append-only event log ([ADR-0008](./0008-annotation-persistence-and-provenance.md)) with: annotator id, sample id, reason code, free-text, timestamp, supervisor disposition (when made), and the disposition timestamp.

## Consequences

### Positive

- **Every campaign has a path for unannotateable samples on day one.** No more "the annotator picked the task and never came back" mysteries.
- **PHI leaks get caught + escalated** — real DICOM data sometimes contains burned-in names; the workflow surfaces this rather than silently ingesting it.
- **Dataset hosts get structured feedback** about their data quality, with per-sample audit trail. Hosts can fix the manifest + re-publish.
- **Rejection-rate is a useful quality signal** for both annotator skill (high rate = miscalibration) and dataset quality (cluster of `corrupt-file` rejections from many annotators = real data bug).

### Negative

- **Adds a supervisor queue** with a 48 h SLA. Operationally cheap at low rejection rates (~1–2 %) but non-zero.
- **Rejection-spam risk** — under-skilled or malicious annotators could reject everything. Mitigated by the rejection-rate flagging in Decision 5, but supervisors need to be trained on the signal.
- **PHI-leak auto-pause on SENSITIVE-tier campaigns** is conservative — false positives (annotator misreads acceptable metadata as PHI) pause the campaign for catalog review. Acceptable trade vs the alternative of ingesting real PHI.

### Neutral

- Rejected samples don't produce annotations, so retention + persistence ([ADR-0008](./0008-annotation-persistence-and-provenance.md)) are unaffected for them.
- The new task status `REJECTED_PENDING_REVIEW` + terminal `REJECTED` extend the state machine in [ADR-0006](./0006-annotation-integration-hub-orchestrator.md) — small amendment, not a redesign.

## Alternatives considered

- **Auto-reject on Zod validation only.** Rejected — semantic problems (wrong modality, PHI leak, task-incompatible) can't be schema-detected. Need a human in the loop.
- **Annotator silently skips the sample.** Rejected — loses the audit trail, prevents host feedback, prevents rejection-rate monitoring.
- **No supervisor review** — annotator decision is final. Rejected — opens the rejection-spam attack and removes the catalog-feedback signal.
- **Reject reasons as free-text only.** Rejected — structured taxonomy enables filtering, analytics, and reason-specific dispositions. The free-text field stays as a sub-field of `other` (and as an optional supplement to the other codes).
- **Bundle rejection with abandonment / timeout** (a separate concern — see E3's task-abandonment sub-issue). Rejected — they're different signals: rejection is "I looked, this is broken"; abandonment is "I never came back". Treat them separately.

## Amendments to prior ADRs

- **[ADR-0006](./0006-annotation-integration-hub-orchestrator.md)** — task state machine acquires `REJECTED_PENDING_REVIEW` (non-terminal, awaiting supervisor) and `REJECTED` (terminal). ADR-0006 gets an "Amendments" entry.
- **[ADR-0008](./0008-annotation-persistence-and-provenance.md)** — append-only event log includes rejection event rows (no schema change needed; the log is already extensible). ADR-0008 gets an "Amendments" entry.

## References

- [ADR-0006](./0006-annotation-integration-hub-orchestrator.md) — workflow state machine; amended by this ADR.
- [ADR-0008](./0008-annotation-persistence-and-provenance.md) — audit trail; rejection events flow here.
- [ADR-0009](./0009-annotation-task-assignment-and-multi-rater-policy.md) — bias-prevention cap that rejections are exempt from.
- [ADR-0010](./0010-annotation-metadata-exposure-and-blinding.md) — `missing-metadata` rejection reason matches the four-bucket model.
- [iMerit — Top tools for medical data annotation](https://imerit.net/resources/blog/top-5-tools-for-medical-data-annotation-in-ai-development/) — reject/accept/fix as standard.
- [Encord — Managing data-annotation pipelines](https://encord.com/blog/manage-data-annotation-pipelines/) — escalation flows.
- [Flywheel — Enhancing medical annotation workflows](https://flywheel.io/insights/blog/how-enhancing-medical-data-annotation-workflows-makes-for-better-ai-training) — sample triage.

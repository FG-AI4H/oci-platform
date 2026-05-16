# ADR-0009: Annotation task-assignment + multi-rater policy

- **Status:** accepted
- **Date:** 2026-05-16
- **Deciders:** Marc Lecoultre (OCI Platform lead)
- **Tags:** `area:annotation` `area:platform` `area:governance`

## Context

[ADR-0006](./0006-annotation-integration-hub-orchestrator.md) committed the annotation module to the integration-hub orchestrator model and locked the 3-gate SOP from ITU-T FG-AI4H DEL05-A03 with "configurable n-annotators" — but deliberately deferred the _routing algorithm_ (which task goes to which annotator) and the _upper bound on N_ to a follow-up decision. [ADR-0008](./0008-annotation-persistence-and-provenance.md) locked IRR thresholds per task type and noted "fusion logic per task type" — but enumerated fusion only for continuous (median) and categorical (majority-vote with seniority tie-break), leaving the segmentation case (the most operationally important one for medical imaging) under-specified.

A review of the ITU FG-AI4H Data Annotation Package slides + the conformance posture against FDA's Good Machine Learning Practice (GMLP) guidance surfaced five concrete gaps that need locking:

1. **Smart task assignment.** The next task assigned to an annotator should _not_ be random — it should match the annotator's expertise, weight by their running IRR-vs-gold score, and ensure non-biased coverage so a single annotator doesn't see all positive cases or all of one class.
2. **Upper bound on N annotators.** "Configurable" with no bound invites cost blowouts; defaults must be chosen. A claim circulating internally that "FDA mandates up to 7 annotators" was checked — **no FDA standard prescribes a specific N**. GMLP requires only that ground truth be well-defined, expert-annotated, with documented criteria + inter-rater consistency metrics. Common medical practice across imaging is 3–5 annotators with an adjudicator; pathology occasionally uses higher in specific high-risk studies (FDA's High Throughput Truthing programme uses 3+, going higher project-by-project, never mandated).
3. **Segmentation-specific fusion.** When task type is `segmentation`, naive majority-vote produces brittle results on dense masks. The ITU slide shows "Unionization strategy (special case for segmentation tasks)" with A∪B / A∩B notation; the medical-imaging consensus algorithm is **STAPLE** (Simultaneous Truth and Performance Level Estimation, Warfield et al. 2004) — not currently called out in ADR-0008.
4. **Annotator experience model.** New annotators with no track record can't be ignored, but they also can't be trusted on the first task. Calibration via gold-standard samples (already in scope of E4) needs to feed the router.
5. **Intra-rater reliability (self-consistency).** The DRAFT standard and the ITU slide both explicitly call out "**inter- and intra-rater agreement**". Inter-rater (annotator-vs-gold, annotator-vs-peers) is necessary but not sufficient — it doesn't catch annotator fatigue (hour 1 vs hour 8), calibration drift (week 1 vs week 8), or sample ambiguity (when raters disagree with themselves more than with each other). Medical-imaging certification programmes (RSNA, ESR) routinely re-present cases for self-consistency testing; the OCI platform must do the same.

This ADR locks the policy for all five.

## Decision

### 1. Task-routing algorithm

A task is assigned to an annotator (or queued for them to pull) based on the following predicate chain, evaluated in order:

1. **Role-Visa scope** (per ADR-0006) — the annotator must hold an `AnnotationRole` Visa for the campaign with the role that matches the gate's required role.
2. **Capability match** — the annotator's declared expertise (modality + annotation type, stored on the user profile) must intersect with the campaign's `taskKind` + `Tool.capabilities`. Annotators without declared expertise are eligible only for campaigns marked as "training-grade" or "no-expertise-required".
3. **Experience-weighted ranking** — among eligible annotators, sort by running IRR-vs-gold-standard score (campaign-scoped + modality-scoped). The router prefers higher-scoring annotators for high-stakes tasks (CONTROLLED / SENSITIVE-tier datasets); lower-scoring annotators are routed to lower-stakes tasks first and to gold-standard samples for calibration.
4. **Bias-prevention sampling** — no single annotator may see more than `⌈total_samples / n_active_annotators⌉ × 1.5` samples within a campaign. The router enforces this at assignment time; if the constraint would be violated, the task is offered to the next-eligible annotator.
5. **Class-balance + metadata-facet check** — if a campaign declares stratification keys (default keys include `class` when labels exist; campaign manager can add `metadata.hospital_id`, `metadata.scanner_make`, `metadata.scanner_model`, bucketed `age_bin`, `sex`, or any catalog metadata field), the router refuses assignments that would give one annotator more than 1.5× the proportional share of any single value of any declared key. Same-class clustering and same-facet clustering (annotator X sees all positives _or_ all Hospital B scans _or_ all one-scanner-make samples) are both detected + blocked. Stratification keys can be **`hidden`** from the UI per [ADR-0010](./0010-annotation-metadata-exposure-and-blinding.md) — the router uses the value, the annotator never sees it.
6. **Within-tie tiebreaker** — within an equivalence class after the above, FIFO by `taskAssignment.assignedAt` timestamp.

**No purely-random assignment.** Even when all predicates allow multiple annotators, the deterministic tiebreaker means task assignment is audit-reproducible.

### 2. N annotators — defaults + bounds

| Setting                        | Value                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Default N**                  | 3                                                                                                      |
| **Minimum N**                  | 1 (degenerate single-annotator campaigns, allowed for training datasets and low-stakes work)           |
| **Maximum N**                  | 12 (operational soft cap; values 8–12 require campaign-manager justification recorded on the campaign) |
| **Recommended bounds by tier** | OPEN/REGISTERED: 1–3; CONTROLLED: 3–5; SENSITIVE: 3–7                                                  |

The "FDA-7" claim is documented as inaccurate. FDA's GMLP does not mandate a specific N; the framework demands quality-via-IRR + documented annotator criteria. The bounds above reflect the medical-imaging-community consensus (3–5 is typical, 5–7 is the high end of pathology projects, >7 is rare and project-specific).

Higher N increases cost super-linearly: at N=7 with a 3-gate SOP, a campaign of 1 000 samples requires 7 000 independent annotation events at gate 1 alone before any arbitration. Campaign managers see a cost estimate at creation time when N > 5.

### 3. Segmentation fusion strategy

When `task.kind = segmentation`, the default fusion algorithm is **STAPLE** (Simultaneous Truth and Performance Level Estimation, Warfield, Zou, Wells 2004). STAPLE produces a probabilistic ground-truth mask + per-rater sensitivity/specificity scores, which feed back into the annotator-experience model (per Decision 1).

Configurable alternatives per campaign:

- `staple` (default) — best aggregate quality; slowest computation; mainstream in medical-imaging research and used by ITK / NIfTI tooling.
- `majority-pixel` — pixel-by-pixel majority vote; fast; good for cases where masks are dense and well-aligned.
- `union` — pixel-wise OR; surfaces "anyone called this a finding" cases for sensitive screening (e.g. tumour-detection campaigns where false negatives are worse than false positives).
- `intersection` — pixel-wise AND; surfaces "everyone agreed" cases for specificity-prioritised tasks.

Acceptance thresholds use Dice + Hausdorff (per ADR-0008's Metrics Reloaded reference); the _aggregation_ algorithm is independent of the _acceptance_ metric.

### 4. Annotator experience model

Every annotator has a per-modality + per-annotation-type running score:

- **`irrAgainstGold`** — moving average IRR (Krippendorff α default) over the annotator's annotations on samples flagged `isGoldStandardLabel = true`. Window: trailing 90 days. _Captures: skill at matching expert ground truth._
- **`irrAgainstPeers`** — moving average IRR over the annotator's contribution to multi-rater tasks where the gate-1 consensus was reached. Window: trailing 90 days. _Captures: skill at matching community consensus._
- **`irrAgainstSelf`** — moving average IRR between t1 and t2 annotations on the **same sample** re-presented to the **same annotator** after a blind delay. Window: trailing 90 days. _Captures: self-consistency — fatigue, calibration drift, sample-ambiguity signal._ See "Intra-rater resampling protocol" below for how samples are selected.
- **`taskCount`** — total tasks contributed in the window.
- **`calibrationStatus`** — `uncalibrated` (taskCount < 10 on gold samples) | `calibrated` | `flagged` (irrAgainstGold dropped below publishable floor _or_ irrAgainstSelf dropped below the fatigue threshold for the running window).

**New annotators** start `uncalibrated`. The router preferentially routes them to gold-standard samples for the first 10 task assignments per campaign so the score converges before they're trusted on high-stakes tasks.

**Flagged annotators** are auto-suspended by the supervisor module pending review. Two distinct flag types:

- **Skill-flag** (low `irrAgainstGold` or low `irrAgainstPeers`) → supervisor either unflags after retraining + re-calibration on fresh gold samples, or removes the annotator from the campaign.
- **Drift-flag** (low `irrAgainstSelf` despite acceptable `irrAgainstGold` / `irrAgainstPeers`) → supervisor either schedules a recalibration window (no removal — the annotator was good and may still be; this is a fatigue/drift signal) or, if the drift persists across two windows, escalates to skill-flag treatment.

The scores are **per-modality** and **per-annotation-type** — a pathologist who's calibrated on tissue-mask segmentation is not automatically calibrated on retinal-bounding-box detection. Annotators self-declare expertise; the scores confirm or contradict the declaration empirically.

### 5. Intra-rater resampling protocol

Self-consistency is measured via **blind resampling**: a fraction of an annotator's completed samples are silently re-presented after a delay, and `irrAgainstSelf` is computed between the t1 and t2 annotations.

| Setting                      | Default                                                                     | Notes                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Resampling rate**          | 5 % of completed samples per annotator per campaign                         | Configurable per campaign in [0 %, 20 %]. Set to 0 % to disable on training-grade or low-stakes campaigns where the QA cost isn't justified.                                         |
| **Blind delay**              | ≥ 7 days between t1 and t2 presentations                                    | Configurable per campaign in [1 d, 30 d]. Pathology / radiology campaigns where memory recall is plausible may need longer.                                                          |
| **Sample selection**         | Stratified random across difficulty + class (when known)                    | Easy-case bias is explicitly avoided — re-presenting only easy cases makes the metric meaningless. The stratification matches the campaign's overall distribution.                   |
| **Annotator awareness**      | Disclosed in onboarding; blinded at moment of annotation                    | "Some of your samples may be re-presented for QA" is part of the annotator agreement. The UI never reveals a sample's resample status; the t1 annotation is hidden when t2 is shown. |
| **Cost accounting**          | t2 events do **not** count toward the bias-prevention 1.5× cap (Decision 1) | Re-presentations are QA, not annotation work. They also don't count toward the campaign's task-completion progress.                                                                  |
| **Threshold (drift signal)** | `irrAgainstSelf` < 0.85 for medical imaging                                 | Configurable per campaign. Sustained crossing triggers `drift-flag` (per Decision 4).                                                                                                |
| **Across-modality scope**    | Per-modality + per-annotation-type                                          | Same granularity as the other scores. A pathologist's tissue-segmentation self-consistency is separate from their retinal-detection self-consistency.                                |

**Two distinct surfaces use this protocol:**

- **During campaign (live):** the router silently injects resamples per the rate above. Used continuously to catch fatigue + drift in real time.
- **During assessment (certification + recertification):** the existing certification-quiz module (E4 / #216) integrates with the same protocol. Pre-onboarding quiz includes re-presented cases at different sessions; recertification quizzes (every 12 months by default) re-test a fresh set. Calibration is required for new annotators before they touch CONTROLLED / SENSITIVE-tier samples.

## Consequences

### Positive

- **Reproducible task routing.** Every assignment has an audit-trail-grade explanation: the predicate chain ran, here's the rank, here's the tie-break. No "the system felt like assigning it to Bob" outcomes.
- **Calibration baked in.** Gold-standard samples are no longer just an IRR measurement device — they're the runway every new annotator runs on first. The router enforces the calibration loop.
- **Bias-prevention is mechanical, not aspirational.** The 1.5× soft cap on per-annotator share + the class-balance check mean a campaign cannot accidentally land in "one annotator labeled 80% of the positives" territory.
- **Segmentation fusion is correct out of the box.** STAPLE is the medical-imaging consensus algorithm; making it the default closes the gap that majority-pixel + union/intersection alone would leave for dense-mask tasks.
- **Cost estimate at campaign creation** keeps N from drifting upward by accident. Managers see the cost curve.

### Negative

- **STAPLE is computationally heavy.** A 512×512 mask × 5 raters × thousands of samples requires real CPU time. The implementation runs as a BullMQ async job, not synchronously on gate transition. Operators will see fusion-pending campaigns in the dashboard.
- **Per-modality + per-annotation-type experience model multiplies the storage cost.** An annotator working across 5 modalities × 6 annotation types has 30 score rows. Acceptable but worth flagging.
- **Bias-prevention sampling reduces routing efficiency.** When the 1.5× soft cap binds, tasks may sit in the queue waiting for an eligible annotator even when a more-skilled annotator is idle. This is by design — sample diversity is more important than throughput — but throughput-conscious campaign managers will need to be onboarded.
- **The "FDA-7" misconception is being explicitly corrected in this ADR.** Anyone who heard the claim elsewhere needs to update their mental model.

### Neutral

- The 90-day window for the experience score is a starting point; future revisions may make it configurable per campaign or per modality (e.g. radiology annotators stay calibrated longer than text annotators).
- The N=12 maximum is a soft cap. Hitting it is allowed with explicit justification; it doesn't break the workflow engine.
- Annotator self-declared expertise is a configuration concern, not a Visa — it lives on the user profile, not in a Passport claim, because it's mutable and granular.

## Alternatives considered

- **Random or FIFO task assignment** (the legacy default). Rejected — same-class clustering and skill mismatches are the dominant causes of low IRR; random assignment maximises both.
- **Lock N at a single value** (e.g. always N=3, never configurable). Rejected — different task types have different needs (rare-finding pathology benefits from higher N; routine classification works with 3).
- **Mandate N=7 to match the rumoured FDA "standard".** Rejected after verification — no such FDA mandate exists. Cost-blowout consequences would have been real for a non-existent constraint.
- **Majority-pixel as the default fusion for segmentation.** Rejected — fast but loses information at mask boundaries where STAPLE shines. Available as an opt-in fast path.
- **Global per-annotator experience score** (one number across all modalities). Rejected — a histopathology expert and a retinal-imaging expert are not interchangeable. Per-modality + per-annotation-type is the right granularity.
- **Skip the bias-prevention sampling and rely on supervisor review.** Rejected — supervisors review individual annotations, not aggregate distribution; bias only becomes visible after the campaign completes and the dataset is published.
- **Skip intra-rater reliability — rely only on inter-rater (vs gold, vs peers).** Rejected — inter-rater catches skill gaps but not fatigue, drift, or sample-ambiguity. Medical-imaging certification programmes universally include self-consistency testing for a reason. The 5 % resampling cost is a fraction of the cost of releasing a campaign with undetected late-stage drift.
- **Reveal re-presentation to the annotator** ("you've seen this sample before — re-annotate it"). Rejected — destroys the blind condition that makes the measurement meaningful. Annotators try to remember their previous answer rather than annotate the case on its merits.
- **Re-present only "hard" samples for intra-rater testing.** Rejected — easy-case bias works both ways; restricting to hard cases overstates disagreement and disagrees with the standard stratification used in medical-imaging certification. Stratified random is the right shape.

## Amendments to prior ADRs

This ADR amends:

- **ADR-0006** — Decision 2 (role-based assignment) and Decision 3 (configurable n-annotators) are extended by Decisions 1–2 above. ADR-0006 acquires an "Amendments" section noting this cross-reference.
- **ADR-0008** — "IRR policy — defaults locked, per-campaign override" is extended by Decision 3 above (segmentation fusion algorithm). The Dice + Hausdorff acceptance metrics in ADR-0008 are unchanged; this ADR specifies the _aggregation_ algorithm that produces the fused mask Dice + Hausdorff are computed against. ADR-0008 acquires an "Amendments" section noting this cross-reference.
- **ADR-0007** unchanged — the tool-integration contract's capability matrix already supports all the annotation types referenced here.

## Amendments to this ADR

- **2026-05-16 — Extended by [ADR-0010](./0010-annotation-metadata-exposure-and-blinding.md).** Decision 1 step 5 (class-balance check) extends to **any declared stratification key** — `metadata.hospital_id`, `metadata.scanner_make`, bucketed demographics, etc. The 1.5× soft cap applies per-key, evaluated independently. Stratification keys can be in any visibility bucket (including `hidden`) — the router uses the value, the annotator may never see it.

## References

- [ADR-0006](./0006-annotation-integration-hub-orchestrator.md) — orchestrator model; amended by this ADR.
- [ADR-0007](./0007-annotation-tool-integration-contract.md) — tool-integration contract.
- [ADR-0008](./0008-annotation-persistence-and-provenance.md) — persistence + IRR + retention; amended by this ADR for segmentation fusion.
- ITU-T FG-AI4H DEL05-A03 (2023-01-28) — DRAFT data-annotation standard; 3-gate SOP, configurable N, IRR-driven decision boxes.
- ITU FG-AI4H Data Annotation Package presentation — annotation-management flow including "unionization strategy (special case for segmentation tasks)".
- [FDA — Good Machine Learning Practice Guiding Principles](https://www.fda.gov/medical-devices/software-medical-device-samd/good-machine-learning-practice-medical-device-development-guiding-principles) — quality-via-IRR + documented annotator criteria; **no specific N mandated**.
- [FDA — High Throughput Truthing (HTT) of Pathologist Annotations](https://www.fda.gov/science-research/fda-science-forum/high-throughput-truthing-htt-pathologist-annotations-reference-standard-validating-artificial) — example of 3+-annotator consensus methodology in pathology validation; project-specific, not regulatory.
- Warfield, Zou, Wells (2004) — "Simultaneous Truth and Performance Level Estimation (STAPLE): An Algorithm for the Validation of Image Segmentation", IEEE Trans. Med. Imag.
- Maier-Hein et al. (2024) — "Metrics reloaded: Recommendations for image analysis validation" (Dice + Hausdorff guidance referenced by ADR-0008).

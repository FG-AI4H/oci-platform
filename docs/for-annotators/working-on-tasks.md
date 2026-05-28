# Working on tasks

The per-task lifecycle from your point of view. The diagrams below are simplified — see [the 3-gate workflow](./3-gate-workflow.md) for the full state machine.

## Lifecycle

```
+-----------+   claim    +-------------+   submit   +-----------+
|  queued   |----------->| in progress |----------->| submitted |
+-----------+            +-------------+            +-----------+
                              |
                              | timeout / leave
                              v
                         +---------+
                         | expired |   (assignment reclaimed; task re-queued)
                         +---------+
```

The **task** is the work unit (one sample). The **assignment** is _your_ claim on a task at a given gate. A task can have several active assignments at once (one per annotator the gate requires) and many historical ones (replaced over time as people abandon and reclaim).

## Claim

The campaign page's **Claim next task** button is the only way to pick up work. There's no "browse and pick" — the router decides for you, per [ADR-0009](../adr/0009-annotation-task-assignment-and-multi-rater-policy.md) Decision 1:

1. **Predicate 1 (role match)** — only tasks whose current gate matches your role.
2. **Predicate 4 (bias-prevention cap)** — never push your share above 1.5× the per-campaign average. If you'd cross the cap, the next task in the queue gets handed to you instead.
3. **Predicate 6 (FIFO tiebreaker)** — among matching tasks, the oldest one wins.

(Predicates 2 / 3 / 5 — experience weighting, stratification, calibration cooldown — land in slice 3+ and 4. They will further filter what you see.)

The claim creates an `AnnotationTaskAssignment` row with status `PENDING`, then `IN_PROGRESS` once you open the annotation tool.

## Instructions acknowledgement

If the campaign has [published instructions](../for-operators/annotation-instructions-guide.md):

- The platform shows the **current** version of the instructions before letting you open the task. You click "acknowledged".
- Your acknowledgement is captured on the assignment row (`acknowledgedInstructionsVersion`).
- When you submit, the API checks that your acknowledged version matches the campaign's currently-published version. If the manager has updated instructions while you were working, the platform asks you to re-acknowledge the new version before submit.
- **Per-task notes** — short markdown overrides on individual samples — appear inline at the top of the task page. They don't require a separate acknowledge, but they're highlighted so you notice them.

A campaign with no instructions skips this step. You'll see a "no instructions published" banner — let the manager know.

## Submit

When you've labelled the sample in the annotation tool, return to the OCI tab and click **Submit**. The platform:

1. Validates that the submission payload is well-formed and complete for the task kind (per [#231](https://github.com/FG-AI4H/oci-platform/issues/231)):
   - **Classification**: a non-empty `label` field.
   - **Detection**: at least one bounding-box entry with `x` / `y` / `width` / `height` / `label`.
   - **Segmentation**: a mask reference (URL or inline encoding).
   - **Localisation**: at least one point with `x` / `y` / `label`.
   - **Multi-modal**: per-modality fields per the campaign's profile.
2. Cross-checks the campaign hasn't transitioned out of RUNNING since you claimed.
3. Cross-checks your acknowledged instructions version matches the current campaign pointer.
4. Counts your submission toward the gate's `N` requirement and triggers the gate-progression check (see [the 3-gate workflow](./3-gate-workflow.md)).
5. Releases your assignment slot so the next claim works.

### Completeness modes

Campaigns are configured in one of two completeness modes:

- **`soft-warn`** (default) — incomplete submissions get a warning toast but go through. You can override.
- **`hard-block`** — incomplete submissions get a 422 and you must fix them before submit.

The campaign manager configures this per ADR-0006. Either way, the platform records the completeness check result with your submission for the audit trail.

## Skip a task

Some tasks you legitimately can't do. Use **Skip** with a reason. The platform:

- Marks the task as `SKIPPED` at its current gate.
- Records your reason on the audit trail.
- Routes the task to the campaign manager's queue for review.

The manager can re-queue the task with a clarification, retire it (mark unfit for the campaign), or accept the skip. Either way the catalog feedback loop ([ADR-0011](../adr/0011-annotation-sample-rejection.md) Decision 4) tells the dataset host that this sample was problematic.

Skip reasons that the campaign manager wants to spot patterns in:

- `unreadable` — image quality issues, missing series.
- `wrong-modality` — this isn't what the campaign description said.
- `safety-concern` — PHI not fully de-identified, unexpected content.
- `out-of-scope` — sample doesn't match the campaign's inclusion criteria.
- `instructions-unclear` — you can't tell what to do; manager should update instructions.

Use plain text — there's no fixed taxonomy yet.

## Abandonment (you walked away)

If you claim a task and don't submit it within the campaign's abandonment timeout (default: 4 hours; configurable per campaign):

- The platform sets your assignment to `EXPIRED`.
- The task returns to the queue at its original gate.
- The router will hand it to someone else (or to you again, after FIFO has cycled past).
- **No penalty** is recorded against you — abandonment is treated as a normal lifecycle event, not a quality signal.

The abandonment sweeper runs every minute. If you come back within the timeout, your assignment is still IN_PROGRESS and you can submit normally.

This was [#229](https://github.com/FG-AI4H/oci-platform/issues/229).

## Calibration & IRR

The platform continuously scores **inter-rater agreement (IRR)**:

- Against **gold-standard samples** if the campaign manager has flagged any (samples with a known correct label that the campaign mixes into your queue without telling you which is which — per [#291](https://github.com/FG-AI4H/oci-platform/issues/291) and ADR-0009 Decision 4).
- Against **peer agreement** at gate-1 (Fleiss' κ, Cohen's κ, Krippendorff's α, Dice — chosen by the campaign manager).

If your running IRR drops below the campaign's threshold for two consecutive sweeps, you'll be flagged with `DRIFT`. The router will pause new assignments to you on this campaign, and the campaign manager will reach out for a calibration session (re-reading the instructions, doing a small batch with feedback, etc.). This is [#292](https://github.com/FG-AI4H/oci-platform/issues/292).

It is not a blame signal. Annotator drift is normal and is often caused by ambiguous instructions, not by individual error. Engage with the calibration step — it's how the campaign improves.

## Output license

The campaign manager declared a single output license at create-time. Your submissions are aggregated into a published annotation set under that license:

- **CC-BY-4.0** — any use including commercial; attribution required.
- **CC-BY-NC-4.0** — any non-commercial use; attribution required.
- **CC-BY-SA-4.0** — share-alike; downstream must use the same license.
- **CC0-1.0** — public domain; no attribution required.
- **`custom-restricted`** — campaign-specific terms; ask the manager.

Once the [annotator-agreement signing flow](./getting-started.md#3-sign-the-annotator-agreement-not-yet-wired--see-234) ships ([#234](https://github.com/FG-AI4H/oci-platform/issues/234)), you'll have explicitly acknowledged the campaign's output license before your first claim. The license itself applies to your submissions regardless — per [ADR-0012](../adr/0012-annotation-rights-licensing-annotator-agreement.md) Decision 3, the manager can only declare a non-commercial license when the source dataset's DUO terms or access tier allow it (this is enforced by the platform — see [#235](https://github.com/FG-AI4H/oci-platform/issues/235)).

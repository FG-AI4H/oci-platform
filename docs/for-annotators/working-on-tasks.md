# Working on tasks

The per-task lifecycle from your point of view. The diagrams below are simplified — see [the 3-gate workflow](./3-gate-workflow.md) for the full state machine.

## Lifecycle

```
+-----------+   start    +-------------+   submit   +-----------+
|  queued   |----------->| in progress |----------->| submitted |
+-----------+            +-------------+            +-----------+
      ^                     |        |
      |          skip       |        | timeout / leave
      +---------------------+        v
        (released; task       +---------+
         re-queued)           | expired |   (assignment reclaimed; task re-queued)
                              +---------+
```

The **task** is the work unit (one sample). The **assignment** is _your_ claim on a task at a given gate. A task can have several active assignments at once (one per annotator the gate requires) and many historical ones (replaced over time as people abandon and reclaim).

## Start

Opening the annotate page reserves nothing. Press **Start** to take a task; until you do, every slot stays open for the other annotators. There's no "browse and pick" — the router decides for you, per [ADR-0009](../adr/0009-annotation-task-assignment-and-multi-rater-policy.md) Decision 1:

1. **Predicate 1 (role match)** — only tasks whose current gate matches your role.
2. **Predicate 4 (bias-prevention cap)** — never push your share above 1.5× the per-campaign average. If you'd cross the cap, the next task in the queue gets handed to you instead.
3. **Predicate 6 (FIFO tiebreaker)** — among matching tasks, the oldest one wins.

(Predicates 2 / 3 / 5 — experience weighting, stratification, calibration cooldown — land in slice 3+ and 4. They will further filter what you see.)

Start creates an `AnnotationTaskAssignment` row with status `PENDING`. If you already hold a task in this campaign, the page shows it again instead, so reloading the page never takes a second one.

After you submit or skip, the page comes back with **Start the next task** already focused, so pressing Enter carries on.

## Instructions acknowledgement

If the campaign has [published instructions](../for-operators/annotation-instructions-guide.md):

- The platform shows the **current** version of the instructions before letting you open the task. You click "acknowledged".
- Your acknowledgement is captured on the assignment row (`acknowledgedInstructionsVersion`).
- When you submit, the API checks that your acknowledged version matches the campaign's currently-published version. If the manager has updated instructions while you were working, the platform asks you to re-acknowledge the new version before submit.
- **Per-task notes** — short markdown overrides on individual samples — appear inline at the top of the task page. They don't require a separate acknowledge, but they're highlighted so you notice them.

A campaign with no instructions skips this step. You'll see a "no instructions published" banner — let the manager know.

## Read the image

On campaigns over the platform's hosted images, the task shows the image itself, with no file name or other details that could hint at the answer. The image address is valid for a few minutes; if the image won't load, reload the page.

| Control                                      | Key                                             |
| -------------------------------------------- | ----------------------------------------------- |
| Fit to screen (also resets everything below) | F                                               |
| Zoom in / out                                | + / −                                           |
| Move around when zoomed                      | drag, or focus the image and use the arrow keys |
| Invert                                       | I                                               |
| Brighter / darker                            | B / Shift+B                                     |
| More / less contrast                         | C / Shift+C                                     |

The keys work anywhere on the page except while you are typing a comment.

## Answer

A classification campaign lists its answers as choices. Press the number shown next to an answer to pick it (0 is "Cannot assess" when the campaign offers it), then Enter to submit. You're back on the queue with **Start the next task** focused, so Enter starts the next image: the whole loop works from the keyboard.

At arbitration you see the same image and what each independent reader answered, with their comment, but never who gave which answer. You pick the **final label** from the campaign's answers the same way, and write the **reason** for it: the reason is required, and is stored and exported with the final label. You are never given a task you read yourself as an independent reader.

Campaigns of other kinds still take a free-form JSON answer, described below.

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
5. Brings you back to the queue. The page doesn't tell you where the task went next (another reader, arbitration, done): that would hint at whether the other readers agreed with you.

### Completeness modes

Campaigns are configured in one of two completeness modes:

- **`soft-warn`** (default) — incomplete submissions get a warning toast but go through. You can override.
- **`hard-block`** — incomplete submissions get a 422 and you must fix them before submit.

The campaign manager configures this per ADR-0006. Either way, the platform records the completeness check result with your submission for the audit trail.

## Skip a task

Press **Skip** to give a task back unread. The platform:

- Sets your assignment to `RELEASED` and records the skip on the audit trail.
- Opens the slot to the other annotators straight away.
- Offers you other tasks before this one. You only get it again if nothing else is left for you.

A skip carries no penalty and doesn't count toward your share of the campaign.

Skip doesn't report anything about the sample. If an image is unusable (poor quality, wrong modality, not fully de-identified, outside the campaign's inclusion criteria) or the instructions don't tell you what to do, skip it **and tell the campaign manager**. Reporting a sample as unfit from the task page ([ADR-0011](../adr/0011-annotation-sample-rejection.md)) is not built yet.

This was [#646](https://github.com/FG-AI4H/oci-platform/issues/646).

## Abandonment (you walked away)

If you claim a task and don't submit it within the campaign's abandonment timeout (default: 24 hours; configurable per campaign from 1 hour to 7 days):

- The platform sets your assignment to `EXPIRED`.
- The task returns to the queue at its original gate.
- The router will hand it to someone else (or to you again, after FIFO has cycled past).
- **No penalty** is recorded against you — abandonment is treated as a normal lifecycle event, not a quality signal.

Timed-out assignments are released whenever anyone in the campaign asks for their next task, so a task you abandoned goes back into the queue without waiting for a background job. Passing the timeout does not by itself release your assignment: until someone in the campaign (you included) asks for a task, it stays open and you can still submit. Once it has been released, your submission is refused; press Start to pick it up again. Reloading the page within the timeout gives you back the same task.

This was [#229](https://github.com/FG-AI4H/oci-platform/issues/229), and [#647](https://github.com/FG-AI4H/oci-platform/issues/647) for the release on pull.

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

# For annotators

You've been invited to label data on an OCI campaign. As an annotator, you:

- **Claim tasks** from one or more campaigns you've been added to.
- **Read the campaign's instructions** and acknowledge them before submitting.
- **Submit your label** through the campaign's annotation tool.
- **Leave a task** if you can't finish it — someone else will pick it up.

The platform handles the bookkeeping (routing, gate progression, IRR scoring, provenance) so you can focus on the labelling. This section explains what you'll see and what's expected of you.

| Guide                                                                   | Read when                                                                                                                                                             |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Getting started](./getting-started.md)                                 | First time on a campaign — what to set up before you claim your first task.                                                                                           |
| [Working on tasks](./working-on-tasks.md)                               | The per-task lifecycle: claim → instructions ack → submit, plus what happens when you walk away.                                                                      |
| [The 3-gate workflow](./3-gate-workflow.md)                             | You're curious why a task you submitted is now showing "AWAITING_ARBITRATION" or "AWAITING_EXPERT" — or what arbitration / expert reviewers actually do.              |
| [Your rights, your work, the licensing](./your-rights-and-licensing.md) | You've been asked to sign an annotator agreement and want the plain-English version before clicking through.                                                          |
| [Annotation tool integrations](../for-developers/annotation-module.md)  | You're switching between campaigns that use different annotation tools (CVAT, MD.ai, RedBrick AI…) and want the developer-side overview of how OCI hands off to them. |

## Quick orientation

- A **campaign** is one labelling project — one dataset, one task kind (classification / detection / segmentation / …), one set of instructions, one output license.
- Each **task** is a single sample (an image, a study, a record) that needs `N` annotators to label it. `N` defaults to 3 (per [ADR-0009](../adr/0009-annotation-task-assignment-and-multi-rater-policy.md)). You only label each task once.
- Tasks move through **gates**: independent annotations first, then arbitration if your group disagrees, then expert review if arbitration can't resolve it. See [the 3-gate workflow](./3-gate-workflow.md). You only see the tasks that match your role at the current gate.
- The platform **routes** tasks to you by role + FIFO + bias-prevention cap — no annotator should ever receive more than 1.5× the average share for a campaign. You don't have to choose which tasks to take; the queue gives you the next one.
- If you **walk away** from a task without submitting, the platform reclaims your assignment after a timeout and reassigns it to someone else. No penalty — life happens.
- **Inter-rater agreement (IRR)** is computed continuously. If your agreement against ground truth or your peers drifts below the campaign's threshold, you'll be flagged for **calibration** before you can keep going on that campaign (per [ADR-0009](../adr/0009-annotation-task-assignment-and-multi-rater-policy.md) Decisions 4 + 5). It's a coaching signal, not a blame signal.
- Your name does not appear on the published dataset — annotators are credited as a group, not individually (per [ADR-0012](../adr/0012-annotation-rights-licensing-annotator-agreement.md) Decision 4). Aggregate counts (e.g. "n=42 annotators") are public.

## What you'll need

- An OCI account in the `annotator` Cognito group (or `arbitration-annotator` / `expert-reviewer` if you've been invited at a higher gate). The campaign manager or your institution's GI-AI4H contact provisions this.
- A signed **annotator agreement** for the campaign you're joining (one-time per campaign). The platform shows you the agreement before your first claim; submission is blocked until you've signed. See [your rights and licensing](./your-rights-and-licensing.md).
- A modern browser and a stable connection — the annotation tool (CVAT, MD.ai, RedBrick AI, or whatever the campaign manager chose) runs in a separate tab.
- Familiarity with the **domain** the campaign covers. The campaign manager can also publish per-campaign instructions and per-sample notes; read those before you start (see [working on tasks](./working-on-tasks.md)).

## Where to ask

- The campaign manager is your first point of contact — every campaign has a named manager visible at the top of the campaign page.
- **Stuck on a sample?** Skip it. The campaign manager reviews skipped samples and either re-queues them with a clarification or accepts the skip. Use the reason field — it improves the instructions for everyone.
- **Disagree with an arbitration decision?** Flag the task for supervisor review (per [ADR-0011](../adr/0011-annotation-sample-rejection.md)). The supervisor can roll back the gate or invite the expert reviewer.
- Email: `oci-platform@itu.int`.

# Getting started

This is the first-time flow: from "I've been invited to a campaign" to "I've just submitted my first task."

## 1. Sign in

The OCI uses Amazon Cognito for sign-in. Your account was created by the campaign manager (or your institution's GI-AI4H contact) and you'll have been notified by email.

- The web app lives at `https://oci.ai4h.net` in production, `https://int.oci.ai4h.net` for integration, and `https://dev.oci.ai4h.net` for development. The campaign manager will tell you which one to use.
- MFA is required for the `annotator` role only in **prod** (per the platform security baseline). Set it up on first login — the platform walks you through it.
- If your sign-in lands you on a dashboard with no campaigns visible, you haven't been added to one yet. Email the campaign manager.

## 2. Open a campaign

Your dashboard shows every campaign you're a member of. Click into one — the campaign detail page tells you:

- The dataset being labelled (linked to its catalog entry — read the [DUO terms](../for-hosts/duo-terms-guide.md) and intended use if you're curious how it was collected).
- The task kind — classification, detection, segmentation, localisation, or multi-modal.
- The annotation tool the campaign uses (you'll be handed off to it for the actual labelling work).
- `N` — how many annotators are required per sample at the independent gate.
- The output license (CC-BY-4.0 / CC-BY-NC-4.0 / CC-BY-SA-4.0 / CC0-1.0 / custom-restricted — see [your rights and licensing](./your-rights-and-licensing.md)).
- The status (DRAFT / READY / RUNNING / COMPLETED / ARCHIVED). You can only claim tasks from a RUNNING campaign.

## 3. Sign the annotator agreement _(not yet wired — see [#234](https://github.com/FG-AI4H/oci-platform/issues/234))_

> **Status today:** the platform does **not** currently gate task claims on a signed annotator agreement. [ADR-0012](../adr/0012-annotation-rights-licensing-annotator-agreement.md) Decision 1 mandates this gate, and the implementation is tracked in [#234](https://github.com/FG-AI4H/oci-platform/issues/234) (E12). Once #234 ships, the platform will show you that campaign's annotator agreement before your first claim and block claims until you've signed. Until then, your annotations on dev / int are governed by the campaign's declared output license — but no signed acknowledgement is captured. We'll back-fill the signature on first sign once the flow lands.
>
> If you are an annotator on a **production** campaign and have not been asked to sign, contact the campaign manager. ADR-0012-conformant campaigns should not be running in prod until #234 ships.

When the flow is live, the agreement will cover (per [ADR-0012](../adr/0012-annotation-rights-licensing-annotator-agreement.md) Decision 1):

- That the labels you create are **work-for-hire** — the labels belong to the campaign, not to you personally.
- The **output license** the campaign manager has declared. This determines who can use the labels you produce, and for what.
- The **data subject consent** the dataset carries (DUO terms — what people whose data this is have agreed to).
- That you can withdraw from the campaign at any time, but the labels you've already submitted stay (you can't selectively un-label).

It's a one-time per-campaign click-through, and re-signing is required when the agreement template version updates (#234 DoD).

Read [your rights and licensing](./your-rights-and-licensing.md) for the plain-English version; the agreement itself, once shipped, is the contract — the platform's summary is not.

## 4. Read the campaign instructions

Most campaigns publish per-campaign instructions — a Markdown page the campaign manager wrote that tells you how to interpret edge cases, what counts as "positive," what to do when the image is unreadable, and so on.

- The platform shows you the instructions **before your first task** on a campaign — you have to acknowledge them.
- The instructions are **versioned**. When the campaign manager updates them mid-campaign, the platform asks you to re-acknowledge the new version on your next claim.
- Some samples carry **per-task notes** — short markdown overrides for tricky edge cases. These appear inline on the task page next to the campaign-level instructions.
- You can pop the instructions back open at any time via a sticky button on the task page.

If a campaign has no instructions, ask the campaign manager. Unwritten instructions are a recipe for low IRR.

## 5. Claim your first task

Click **Claim next task** on the campaign page. The router picks one for you based on:

- Your role (`annotator` for independent gate, `arbitration-annotator` for arbitration, `expert-reviewer` for expert review).
- FIFO — the longest-queued task that matches your role wins.
- A **bias-prevention cap** — you'll never be given a task that would push your share of the campaign above 1.5× the per-annotator average.
- (Slice 3+) Stratification across sub-populations; experience-weighted ranking; calibration cooldown.

You won't see "all available tasks" — just the one the router picked. If you can't work on it (you've seen the patient ID before, you don't have the equipment, you're conflicted out for any reason), submit a skip with a reason. The campaign manager reviews skips.

## 6. Do the work

The platform hands you off to the campaign's annotation tool (CVAT, MD.ai, RedBrick AI, etc.) with a signed handoff URL. Label the sample there.

The tool's UI is the tool's UI — that's by design. OCI doesn't reimplement labelling; it orchestrates campaigns across tools.

## 7. Submit

When you're done, click **Submit**. The platform:

- Records your label and the instructions version you acknowledged (provenance — see [ADR-0008](../adr/0008-annotation-persistence-and-provenance.md)).
- Checks completeness for the task kind (every required field present per [the completeness predicate](../adr/0006-annotation-integration-hub-orchestrator.md) #231).
- Counts your submission toward the gate's `N` requirement.
- Frees you to claim the next task.

If your campaign uses **hard-block** completeness mode, missing required fields will refuse the submit. If it uses **soft-warn**, you'll see a warning but can override.

## What's next

- Read [working on tasks](./working-on-tasks.md) for the lifecycle details — claim, ack, submit, abandonment.
- Read [the 3-gate workflow](./3-gate-workflow.md) if you're curious what happens to your label after you hit submit.
- Most annotators only need to read this page once. Bookmark the campaign URL and you're set.

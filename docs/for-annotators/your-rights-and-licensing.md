# Your rights, your work, the licensing

The plain-English version of [ADR-0012](../adr/0012-annotation-rights-licensing-annotator-agreement.md) — the architectural decision governing annotator agreements, output licensing, attribution, and your right to withdraw. **The ADR is the authoritative source; this page is the explainer.** When in doubt, read the ADR and ask the campaign manager.

> **Implementation status:** the **annotator-agreement signing gate** described below is **not yet wired into the platform**. [#234](https://github.com/FG-AI4H/oci-platform/issues/234) tracks the implementation; until it ships you can claim tasks without signing. The output-license enforcement (#235), instructions versioning (#230), and audit-trail capture (#257) are live. ADR-0012's substantive policy — work-for-hire, output license tiers, group attribution, right to withdraw, GDPR posture — governs every annotation regardless of whether the click-through flow is built yet.

## The annotator agreement (one per campaign) — _planned, see [#234](https://github.com/FG-AI4H/oci-platform/issues/234)_

Once [#234](https://github.com/FG-AI4H/oci-platform/issues/234) ships, before your first claim on a campaign the OCI will show you that campaign's annotator agreement. You won't be able to claim a task until you've signed.

It's a **work-for-hire** agreement (ADR-0012 Decision 1). In plain language:

- The labels you create are owned by the campaign — they're aggregated into a published annotation set and released under the campaign's declared output license.
- You don't retain individual copyright on the labels. They're work-product, not your personal IP.
- You're free to describe your participation ("I labelled images for the OCI XYZ campaign") in your CV, papers, or talks. You're not free to redistribute the labels themselves outside the campaign.

The agreement has two variants:

1. **Paid annotators** — institutional contract, you're compensated for your time.
2. **Volunteer annotators** — no compensation; participation is your contribution to the public good (typical for academic / GI-AI4H campaigns).

The variant is fixed per campaign. The OCI shows you which one applies before you sign.

## What the agreement discloses

Per ADR-0012 Decision 2, every annotator agreement — paid or volunteer — discloses:

### Data subject consent

The dataset you'll be annotating carries DUO consent codes (Data Use Ontology — see the [DUO terms guide](../for-hosts/duo-terms-guide.md)). These are the consent terms the patients / participants in the source data agreed to. The agreement summarises the ones that constrain _your_ work:

- **`NCU` (non-commercial use only)** — labels from this campaign can only be released under non-commercial licenses. The campaign manager cannot declare CC-BY-4.0; only CC-BY-NC-4.0 or stricter.
- **`PUB` (publication required)** — the campaign manager has committed to publishing methods and results. Your work is part of that publication record.
- **`GS` (genetic studies only)** — your labels are bound to genetic-studies use only.
- **`COL` (collaboration required)** — downstream use requires a collaboration agreement with the host institution.

The OCI enforces these at the platform level — you don't have to track them yourself. But you should know what your work is governed by.

### Output license

The campaign manager declared one of:

- **CC-BY-4.0** — any use, including commercial. Requires attribution (to the campaign, not to you individually).
- **CC-BY-NC-4.0** — non-commercial use only. Required when the source dataset carries NCU.
- **CC-BY-SA-4.0** — share-alike: downstream uses must be released under the same license.
- **CC0-1.0** — public domain. No restrictions, no attribution required.
- **`custom-restricted`** — campaign-specific terms (e.g. consortium-only use). The agreement spells these out.

The license is **immutable** once the campaign transitions out of DRAFT ([#235](https://github.com/FG-AI4H/oci-platform/issues/235)). Your labels will be released under this license — not a less-restrictive one, not a more-restrictive one. If the campaign manager later wants to change it, they have to clone the campaign and start over.

### Use of the labels

The agreement specifies:

- The **intended use** — what AI model the labels will train / evaluate. (You can verify this against the IUS on the campaign page.)
- The **publication plan** — peer-reviewed paper, regulatory submission, public dataset release, internal evaluation only, etc.
- **Retention** — how long the labels are kept after the campaign closes. OCI's default is the full retention horizon declared in the host's DUA; campaigns can shorten it but not extend it.

## How you're credited

Per ADR-0012 Decision 4, **annotators are credited as a group, not individually**:

- The published annotation set acknowledges "n=42 annotators" (or whatever the count is). Your name is not on the dataset.
- Papers published from the campaign cite the campaign manager as PI and acknowledge the annotator pool collectively.
- This is intentional: it protects you (annotation work can be ethically and politically sensitive) and it prevents the contributorship from becoming a CV competition.

If you want individual credit for your contribution, talk to the campaign manager **before signing** — some campaigns offer opt-in named acknowledgements in the paper. This is per-campaign, not platform-wide.

## Your right to withdraw

You can withdraw from a campaign at any time:

- Click **Leave campaign** on the campaign page. The OCI removes you from the routing pool — you won't see new tasks.
- Any task you've claimed but not yet submitted is released back to the queue.
- **Labels you've already submitted stay.** This is the GDPR Article 17 posture per ADR-0012 Decision 5: you can't selectively un-label, because the work has already been aggregated and is part of the campaign's evidence record.

The exception is **personal data about you** (your name, sign-in metadata, IRR scores tied to your identity). You can request deletion of that via the platform's data-subject-rights flow — your labels are then disassociated from your identifier but remain in the campaign.

If you want a full audit of what data the OCI holds about you and your work, contact the platform operator (`oci-platform@itu.int`).

## Calibration: not a punishment

If your IRR drifts below threshold (per [ADR-0009](../adr/0009-annotation-task-assignment-and-multi-rater-policy.md) Decision 4 + [#292](https://github.com/FG-AI4H/oci-platform/issues/292)), the platform pauses new assignments and the campaign manager reaches out.

This is **coaching**, not disciplinary:

- Drift is most commonly caused by ambiguous instructions or by the campaign drifting into edge cases it wasn't scoped for.
- The calibration session re-grounds you with examples, often surfaces an instruction update that helps everyone, and resumes your assignments.
- Drift is not recorded against your reputation. The IRR signal is per-campaign and isn't shared with other campaigns or institutions.

If you feel the calibration flag was unfair, escalate to the campaign manager's supervisor (see the campaign page footer for who that is).

## Disputes

If you disagree with how a label of yours was handled (a gate-2 arbitrator overrode you, a gate-3 expert reviewer made a call you think was wrong, your skip was rejected, your annotation was rejected per ADR-0011), you can:

1. **Flag the task for supervisor review.** Click the flag button on the task; explain in plain text.
2. **Email the campaign manager.** The manager's email is on the campaign page.
3. **Escalate to the platform operator** at `oci-platform@itu.int`. This is the last resort and is for genuine ethical / safety concerns (PHI exposure, dataset misrepresentation, etc.), not for label disagreements.

The platform's audit trail captures every action — claims, submissions, gate transitions, skips, supervisor decisions — under your assignment IDs. You can request a copy.

## Where to ask

- **Read the actual agreement** before you sign. This page is the explainer; the agreement is the contract.
- For policy questions about ADR-0012: open a discussion on [GitHub](https://github.com/FG-AI4H/oci-platform/discussions).
- For platform-operator questions: `oci-platform@itu.int`.
- For your institution's specific guidance: your local GI-AI4H contact.

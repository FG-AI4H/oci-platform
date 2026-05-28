# Writing annotation instructions

Per-campaign instructions are the single biggest lever for annotator agreement (IRR). Clear instructions reduce drift, reduce arbitration load, and produce ground-truth labels regulators will accept. This guide is for campaign managers — the people who write instructions.

Background: the per-task / per-campaign instructions feature was [#230](https://github.com/FG-AI4H/oci-platform/issues/230). Read [the annotator-facing handbook](../for-annotators/) to understand how annotators experience your instructions before you write them.

## What the platform gives you

- **A single Markdown document per campaign**, versioned by content hash. Edits create a new version; identical content does not.
- **Annotators acknowledge** the current version before claiming their first task on the campaign, and re-acknowledge whenever you publish a new version mid-campaign.
- The version they acknowledged is captured **per submission** as part of the annotation provenance (joins `tool_version` + `schema_version` per [ADR-0008](../adr/0008-annotation-persistence-and-provenance.md)).
- **Per-task notes** — short Markdown overrides — let you attach special-attention notes to individual samples without touching the campaign-level document.
- **Embedded media** — up to 20 image/video references per instructions page. The Markdown is sanitised at render time.

The body is capped at **64 KB**. If you need more, you're probably writing a SOP that belongs in a separate document — link out to it.

## Structure: what to include

Every set of campaign instructions should cover, in roughly this order:

### 1. One-line task

What is the annotator being asked to do, in 15 words or fewer.

> Label each chest X-ray for the presence or absence of pneumonia.

Vague openings like "Annotate the data carefully" are useless and cause drift. Be concrete about the decision.

### 2. The label space

For classification, the exact set of allowed labels. For detection / segmentation / localisation, what counts as an "object" and what the units are.

> Allowed labels: `pneumonia`, `no-pneumonia`, `equivocal`.
> Use `equivocal` only when you're genuinely unsure — not as a hedge.

If a label is ambiguous (e.g. "abnormal"), define it operationally. If two labels can co-occur, say so explicitly.

### 3. Positive examples

Show 3–6 worked examples of the most common positives, with the correct label and a one-line rationale. Embed the images.

```markdown
### Positive examples

![Lobar pneumonia, right lower lobe](https://example.com/instructions/pna-1.png)
**Label:** `pneumonia` — clear consolidation in the right lower lobe with air bronchograms.

![Bilateral airspace disease](https://example.com/instructions/pna-2.png)
**Label:** `pneumonia` — bilateral patchy airspace disease consistent with bacterial pneumonia.
```

### 4. Negative examples

Same form, for the most common negatives. Especially valuable for samples that look positive but aren't (the classic source of false positives in your trained model).

### 5. Edge cases

This is where IRR is won or lost. Walk through:

- Borderline cases (what counts as "subtle" findings).
- Multi-finding cases (when does the secondary finding get its own label).
- Image-quality cases (when to skip vs. annotate).
- Demographic / device variation if the dataset spans modalities or sources.

Number them. Annotators will refer back to specific edge-case sections during arbitration.

### 6. What to skip

Be explicit about which samples should be **skipped** (using the skip button) versus labelled:

- Severe motion artefact, unreadable.
- Wrong modality (e.g. CT slipped into a chest-X-ray campaign).
- Suspected PHI leakage (de-identification failed; legend visible).

Give the **skip reason vocabulary** you want — e.g. `unreadable`, `wrong-modality`, `phi-concern`, `out-of-scope`. The platform stores the reason verbatim and your reasons feed the catalog feedback loop ([ADR-0011](../adr/0011-annotation-sample-rejection.md) Decision 4).

### 7. Tool-specific notes

If you're using CVAT, MD.ai, RedBrick AI, or another tool, the annotator interacts with the tool — not OCI — during the actual labelling step. Include tool-specific instructions here:

- Which annotation type to use (polygon vs. bounding box vs. brush).
- Default attribute values.
- How to handle multi-instance segmentations.

You don't have to repeat the tool's documentation. Link to it. But the tool-specific conventions for _this_ campaign go here.

### 8. How to flag concerns

Make the escalation path explicit:

> Use the **Skip** button with reason `phi-concern` for any sample where you suspect identifying information is still visible. The campaign manager (me — `pi@example.org`) will review within 1 business day.

Annotators will assume "no path, no problem" otherwise. Spelling it out reduces the rate of silent quality issues.

## What NOT to do

- **Don't bury the label space in prose.** Annotators skim. Put the allowed labels in a heading-anchored section with a code block, not in a paragraph.
- **Don't write a literature review.** A 10-page introduction loses every annotator. Save context for a separate "background" link.
- **Don't reference internal documents** that annotators can't access. The instructions are the canonical reference for the annotator role — if you cite something, link to it publicly or include it inline.
- **Don't change semantics in a "minor edit."** If you broaden a label definition mid-campaign, that's a _major_ update — call it out at the top of the new version, and consider re-calibrating annotators before continuing. (The platform's IRR drift detector — [#292](https://github.com/FG-AI4H/oci-platform/issues/292) — will likely flag drift after such a change; that's by design.)
- **Don't omit edge-case sections "to keep things simple."** The platform's submission rate stays high; the IRR plummets. The 3-gate workflow then catches the drift, but only after wasted work.

## Versioning

Every save publishes a new version with a content-hash-derived `version` string (e.g. `a7f3c2e9b1c84e5d`). The platform:

- **Skips no-op republishes** — saving identical content does not produce a new version, so you can safely "publish" repeatedly without churning the version table.
- **Forces re-acknowledgement** on the _next_ claim each active annotator makes after a new version is published. They see the new version with a "what changed" banner (you'll see this in [#230 follow-up](https://github.com/FG-AI4H/oci-platform/issues/230) — the diff view is on the roadmap).
- **Captures the acknowledged version** on every submission. Auditors can pull the exact instructions content the annotator agreed to before producing their label.

This makes instructions edits **safe** mid-campaign — but it also makes them visible. Don't rewrite history; publish a new version with a note.

## Per-task notes (special-attention overrides)

For unusual samples that warrant special handling (a known difficult case from the validation set, a sample the host flagged after publication, a borderline edge case you want every annotator to see), use **per-task notes**:

- Open the task in the manager view.
- Add a Markdown note (capped at 4 KB).
- The note appears inline on the task page next to the campaign-level instructions.

Use sparingly — fewer than ~5% of samples should carry per-task notes. If you find yourself adding notes to half the tasks, the campaign-level instructions are too thin.

## Worked example

Here's the structure of a good instructions document, with section anchors:

```markdown
# Pneumonia detection — chest X-rays

## 1. The task

Label each chest X-ray for `pneumonia` / `no-pneumonia` / `equivocal`. One label per study.

## 2. The label space

- `pneumonia` — radiological evidence of pneumonia (consolidation, airspace disease, bronchograms).
- `no-pneumonia` — no pneumonia. Other findings may be present.
- `equivocal` — genuine uncertainty. Use sparingly.

## 3. Positive examples

[images + one-liners]

## 4. Negative examples

[images + one-liners — focus on false-positive look-alikes: atelectasis, pleural effusion, pulmonary oedema]

## 5. Edge cases

1. Pneumonia with concurrent pleural effusion → label `pneumonia` (the secondary finding doesn't change the primary).
2. Treatment-related airspace disease (post-radiation, post-chemo) → `equivocal`. Flag in the comment.
3. Pediatric patients (<5 yo) → exclude. Skip with reason `out-of-scope`.
4. ICU/portable studies with extensive support equipment overlying findings → use clinical judgment; skip only if truly uninterpretable.

## 6. What to skip

- Severe motion artefact obscuring lung fields → `unreadable`.
- CT/MRI/ultrasound slipped into the queue → `wrong-modality`.
- Identifying patient information visible (patient ID printed on film) → `phi-concern`.

## 7. Tool notes (CVAT)

- This campaign uses CVAT classification mode. Select one label per study from the dropdown.
- Do not draw bounding boxes — the campaign collects classification only.

## 8. Concerns

- PHI / safety concerns: skip with reason `phi-concern`. I'll review within 1 business day.
- Instructions unclear: skip with reason `instructions-unclear` and a one-line description. I'll update for everyone.
- Email: pi@example.org. Slack: #oci-pneumonia-campaign.
```

Aim for **2–5 KB** of well-structured instructions. Going beyond 10 KB usually means you're scope-creeping the campaign.

## Closing the loop

After the campaign hits its first few hundred submissions:

- Look at the **gate-2 (arbitration) rate**. High (>15%) means annotators disagree often — the instructions probably don't cover an edge case. Pull the gate-2 arbitration notes and update.
- Look at the **skip rate**. If `instructions-unclear` is in your top three skip reasons, update.
- Look at **IRR drift flags**. Drift on multiple annotators at the same time is an instructions problem, not an annotator problem.

The platform makes mid-campaign instructions edits cheap — _use them_. Don't ship a campaign with thin instructions and hope.

## References

- [#230](https://github.com/FG-AI4H/oci-platform/issues/230) — feature issue.
- [ADR-0006](../adr/0006-annotation-integration-hub-orchestrator.md) — orchestrator architecture (instructions provenance is part of the audit trail).
- [ADR-0008](../adr/0008-annotation-persistence-and-provenance.md) — provenance shape (`instructionsVersion` joins `toolVersion` + `schemaVersion`).
- [ADR-0009](../adr/0009-annotation-task-assignment-and-multi-rater-policy.md) — calibration drift (Decision 4) and how it interacts with instructions updates.
- [For-annotators handbook](../for-annotators/) — what annotators see and how they read your instructions.

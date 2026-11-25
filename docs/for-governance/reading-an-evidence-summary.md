# Reading an evidence summary

> English version of a guide written in French first: [reading-an-evidence-summary.fr.md](./reading-an-evidence-summary.fr.md).

This guide is for the person who has to judge a model on the record: a reviewer, a regulator, a decision-maker. An evidence summary is about **one** submission: one predictions file from one model, scored on one evaluation task. It fits on two A4 pages and says what the model is for, what it was tested on, how, with what results, for which patients, and what is missing.

## Opening it

The summary is open to the submission's author, administrators, evaluation reviewers and regulators. A platform administrator gives those two roles. Anyone else sees **Not available to you**.

To find it: **Evaluation** at the top of the page, then the task, then the method name of a result. At the bottom of the result page, click **Evidence summary**.

The **Print or save as PDF** button turns it into a document. The summary is computed when you open it, and the header says when (**Generated**). A printed copy is a snapshot as of that date.

## The header and **At a glance**

The header gives the method name the author chose, the task, the dates in UTC and the submission's identifier.

The **At a glance** box first says where the result stands:

- **Published result**: produced by an approved version of the evaluation method;
- **Provisional result**: the method version has not been approved yet; its status may change;
- **Retracted result**: the version was rejected or withdrawn; do not rely on it;
- **Result without a reviewed method**: no method version is linked to the result, so no review stands behind it;
- **No result**: the submission was not scored.

Every scored submission is linked to the version of the method that produced it. A recent result therefore reads **Provisional result** until that version is approved, then **Published result**. **Result without a reviewed method** applies only to results scored before method versions were recorded.

Then come the two main measures and the number of gaps, with a link to section 6.

## 1. Intended use and risk tier

This section takes the model card the author linked: what the model does, for which patients, who reads its output, in which settings, whether it acts alone or under a clinician's confirmation, its foreseeable misuse and its contraindications. The **Risk tier**, from I to IV, is derived from those answers; the author does not choose it.

To check: does the task tested answer the question the intended use raises? A card that is a **draft** or **submitted for review** has not been reviewed yet. With no card linked, the section says so, and it is a gap.

## 2. Data

The test dataset: its version, its **Licence**, its **Source**, how the data were collected, and the number of items in the reference set. The **reference labels** are the right answers. The section says how they were made: how many readers per item, their qualification, how disagreements were settled, and how well they agreed.

Two points to watch:

- the version shown is the latest published one: the task names the dataset, not a version;
- synthetic data are flagged. They show that the platform works, not how good the model is on patients.

## 3. Evaluation method

The procedure that computed the figures, its version and its **Review status**: **Declared, not reviewed**, **Under review**, **Approved**, **Rejected** or **Withdrawn**. A version is reviewed by a reviewer who is not its author. The decision is dated and comes with the **Reviewer’s rationale**.

## 4. Performance

The table gives each measure, its value, its **95% CI** and what it is **Based on**.

- **Sensitivity**: of the cases with the finding, the share the model flagged.
- **Specificity**: of the cases without it, the share the model did not flag.
- **Positive predictive value**: of the cases flagged, the share that have the finding. **Negative predictive value**: of the cases not flagged, the share that do not. Both depend on how common the finding is in this set; they change in another population.
- **95% CI**: the range in which the true value plausibly lies, given the number of cases. A wide range means an uncertain figure.
- **Based on**: the number of cases each rate rests on.

A table crosses the **Reference** with the **Model’s answer**: true and false positives, true and false negatives. These figures can be compared only with other results on the same task.

## 5. Results by subgroup

The same measures, computed on each group of patients, for example by sex or age band. A model can do well on average and worse for one group: this is where it shows.

**Small groups are not shown.** The rule protects patients in a small group, who could be recognised, and avoids figures too uncertain to use:

- a group with fewer than 11 scored items shows as **Not reported**;
- a measure that rests on fewer than 11 items is replaced by **Withheld**;
- when one group is hidden, another may be hidden with it, so that it cannot be worked out from the total and the other groups;
- **n/a** means not estimable: no item of the group enters the calculation.

The rule applies to everyone, the author and administrators included: nobody can see those figures. A hidden group is a hole in the evidence, and section 6 counts it. Read differences between groups with care: their intervals are wider.

## 6. What this evidence does not show

This is the list of **gaps**. The platform draws it up from what it holds. Each line is a fact about the evidence, not a judgement of the model, and points to its section (for example _Section 4_). Examples:

- no model card linked, or a card that is not published;
- synthetic test data, or reference labels with no description, or made by one reader;
- an evaluation method that is not reviewed, or not approved yet;
- fewer than 50 cases with the finding: the sensitivity is imprecise;
- incomplete coverage, or subgroups missing or withheld.

"No gap" does not mean the model is fit for use. It means the platform found none of these shortcomings. It cannot tell whether the test data resemble your patients, or whether the model is useful in practice.

## 7. Trace

The submission's events in the audit trail, oldest first: its **No.**, its **Time (UTC)**, the **Event** (**Submitted**, **Scored**, **Failed**, or a link to a model card) and its **Record hash**. The full hash of the last event is printed under the table.

**What the hashes prove.** Every event in the audit trail carries a hash computed over its content and over the hash of the event just before it in the whole trail. If a stored event is changed, its hash no longer matches, nor do the ones after it. That shows when the chain is verified. The hashes therefore show that these events were recorded, in this order, at these times, and have not been changed since without it showing. The events also carry the hash of the predictions file: whoever holds the file can show that it is the one that was scored.

**What they do not prove:**

- that the result is right, the method sound or the model safe;
- which model produced the file: the platform receives a file, not the model;
- that the reference labels are correct;
- that no change happened: they make a change visible, they do not prevent it, and only if someone verifies;
- the exact time from an independent source: it is the platform's clock.

The numbers are not consecutive: other events of the platform fall between them.

**Verifying.** A regulator opens the **Audit trail** from the link at the top of the page; an administrator, from the **Admin** page. Its **Verify chain** button recomputes every hash, and a JSON export of the trail lets you compare the hashes with those on the printed summary. Keep that copy: the same event must always have the same hash.

# Submitting predictions to an evaluation and reading the result

> English version of a guide written in French first: [submitting-predictions.fr.md](./submitting-predictions.fr.md).

This guide takes you from an evaluation task to your result. A spreadsheet is enough: you need no technical background.

A few words used throughout:

- a **task** is a question asked of a dataset, for example: _is the finding present on this image?_;
- an **item** is one image or case in the task;
- a **label** is your answer for one item;
- the **reference labels** are the right answers. The platform keeps them and shows them to no one. The evidence summary also calls them the "reference set".

## Before you start

- **An account**, to submit for scoring. Checking the format needs none. If an account was created for you, you received an e-mail with a temporary password that works for 3 days. The first time you sign in, you choose your own password.
- **The language.** At the top of every page, the **FR** button shows the interface in French and **EN** in English.

## 1. Open the task

Click **Evaluation** at the top of the page, then the task's name. Its page says what is scored, on which dataset, and lists the results so far. Click **Submit predictions**. The page that opens has three numbered steps.

## 2. Get the template

In the step **Get the template**, click **Download template**. It is a spreadsheet file (CSV) with one line per item and an empty column for your labels.

If the file opens with everything in one column, take the **semicolon-separated template** just below instead. Both are accepted.

## 3. Fill in the labels

In the step **Fill in the labels**, the page says what to type in the `label` column, with an example:

- for a **binary finding** task, 1 where the finding is present, 0 where it is not. The `score` column is optional: the model's confidence that the finding is present, from 0 to 1. Filled in for every item, it adds an area under the ROC curve to the result;
- for a **grading** or **classification** task, a whole number from 0 to the highest grade or class.

Do not change the identifiers or the first line. To leave an item out, delete its line: it is not scored, and coverage goes down. Save as CSV, not as a spreadsheet workbook.

## 4. Check the format

In the step **Check the format, then submit**:

1. Give a **Method name**, for example “first reading” or “model v2”. It is shown publicly with the result, so leave people's names out.
2. Choose your file under **Predictions file**.
3. Click **Check format**.

The check tells you what to correct: an identifier the task does not have, a line that appears twice, a label outside the range. It scores nothing, records nothing and uses none of your scored submissions. Repeat it as often as you like. When all is well, the page says **The format is valid**. If you choose another file, check the new one.

## 5. Choose your model card

Once you are signed in, you see the **Model card** list: the models you have declared, with their version and status. Choose the one this result is evidence for. The result will be listed on its card, and the evidence summary can say what the model is for.

This choice is optional; the default is **No model card**. If the list is empty, the **Declare a model** link takes you to the form: see [Declaring a model](./declaring-a-model.md).

You can change this choice later on the result page: choose a card under **Linked card**, then click **Save**. Only your own cards are offered, except those that have been withdrawn.

## 6. Submit for scoring

Click **Submit for scoring**. When you are not signed in, the page shows **Sign in to submit for scoring** instead.

The number of scored submissions is limited, per week and for the whole task. What you have left is written under the button. A file refused on its format does not count.

Your result page then opens. **Waiting for the result**: reload it a little later. **This file was not scored**: the reason is written below, and **Check a corrected file** takes you back to the check.

A scored result is public: it is listed on the task page with its method name.

## 7. Read the result

The **Metrics** card gives each measure with a sentence that explains it. For a binary finding task:

| Measure                            | In plain words                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Sensitivity**                    | Of the cases where the finding is present, the share your file flagged. Low, it means missed cases.                         |
| **Specificity**                    | Of the cases without the finding, the share your file did not flag. Low, it means false alarms.                             |
| **Positive predictive value**      | Of the cases flagged, the share that really have the finding. It depends on how common the finding is in this set.          |
| **Negative predictive value**      | Of the cases not flagged, the share that really do not have it. It also depends on how common the finding is.               |
| **Balanced accuracy**              | The average of sensitivity and specificity. Results are ordered by it: flagging everything, or nothing, does not pay.       |
| **Area under the ROC curve (AUC)** | How well your scores place positive cases ahead of negative ones, from 0.5 (chance) to 1. Only when every item has a score. |
| **Prevalence**                     | The share of positive cases in the scored set: a property of the data, not of your file.                                    |
| **Coverage**                       | The share of the task's items your file answers.                                                                            |

Under each rate:

- **95% CI**, the 95% confidence interval: the range in which the true rate plausibly lies, given how many cases it rests on. Few cases give a wide range, so an uncertain figure;
- **_40 of 50_**, for example: the number of cases the rate is computed on.

The **Counts** card shows the four boxes these rates come from: true positives, false negatives, false positives, true negatives. For a grading task, the main measure is **QWK**, the agreement with the reference grades.

The **Results by subgroup** card, when the task has one, gives the same measures per group of patients. Small groups are not shown: see [Reading an evidence summary](../for-governance/reading-an-evidence-summary.md#5-results-by-subgroup).

These measures compare with other results on the same task, and with no other.

## 8. What "provisional" means

Every result is produced by an **evaluation method**: the procedure that compares your file with the reference labels and computes the measures. Each version of a method goes through a review, done by someone other than its author.

- **published**: the method version was approved. Only a published result gets a rank on the task page and counts in published reporting.
- **provisional**: the version is not approved yet. The figures are shown, but no review stands behind them yet. No rank, no place in published reporting. The result becomes published if the method is approved, withdrawn if it is rejected.

Your result is linked to the version of the method that produced it, for example `oci-predictions-scoring@1.0.0`. Until a reviewer approves that version, it is **provisional**. Once they approve it, the same result becomes **published** and gets a rank: you have nothing to submit again.

Two other cases:

- **before method versions**: a result scored before the platform recorded method versions. It is never published.
- If no version of the method is open, the submission is refused with the message "Not submitted: this task cannot take scored submissions just now…". Nothing is scored and none of your scored submissions is used. Tell the organisers. The format check always works.

## 9. Open the evidence summary

At the bottom of the result page, click **Evidence summary**. On two A4 pages it brings together what the model does, what it was tested on, how, with what results, for which patients, and what is missing. **Print or save as PDF** turns it into a document to pass on.

You can see it because it is your submission. Administrators, evaluation reviewers and regulators can see it too. To read it section by section: [Reading an evidence summary](../for-governance/reading-an-evidence-summary.md).

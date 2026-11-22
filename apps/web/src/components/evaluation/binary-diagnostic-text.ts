/**
 * Every user-facing sentence for a binary-finding task (`BINARY_DIAGNOSTIC`,
 * #650), in one object. The task page, the submission page, the submit page
 * and the format check all read their wording from here, so moving the
 * evaluation pages to message files is a matter of moving this object.
 *
 * Plain data and small functions only: no JSX, no formatting of numbers (that
 * stays in `metrics.ts`). Interpolated values arrive already formatted.
 */
export const BINARY_DIAGNOSTIC_TEXT = {
  taskKindLabel: 'Binary finding',

  /** What a reader is told when the task has no positive class in words. */
  positiveClassFallback: 'Finding present',

  about: {
    description: 'What is being scored, on which dataset, and which finding counts as positive.',
    positiveClassTerm: 'Positive class',
    positiveClass: (name: string) =>
      `${name}, written as label 1. Sensitivity and the positive predictive value are about this class.`,
    positiveClassMissing:
      'Not stated for this task. Label 1 means the finding is present, label 0 that it is absent.',
    classesTerm: 'Labels',
    classes: '1 for positive, 0 for negative',
  },

  results: {
    ordering:
      'Ordered best first by balanced accuracy, the average of sensitivity and specificity, so a file cannot rank high by flagging every item or none.',
    intervals:
      'Each rate is shown with its 95% confidence interval (Wilson score): the range the true rate plausibly lies in, given how many items it rests on. AUC appears only for a submission that gave a score for every item.',
  },

  metric: {
    balancedAccuracy: {
      label: 'Balanced accuracy',
      explanation: 'The average of sensitivity and specificity. Results are ordered by it.',
    },
    sensitivity: {
      label: 'Sensitivity',
      explanation: (positive: string) =>
        `Of the items that are positive (${positive}), the share this file labelled positive.`,
    },
    specificity: {
      label: 'Specificity',
      explanation: 'Of the items that are negative, the share this file labelled negative.',
    },
    positivePredictiveValue: {
      label: 'Positive predictive value',
      explanation: (positive: string) =>
        `Of the items this file labelled positive, the share that are positive (${positive}). Depends on how common the finding is in this set.`,
    },
    negativePredictiveValue: {
      label: 'Negative predictive value',
      explanation:
        'Of the items this file labelled negative, the share that are negative. Depends on how common the finding is in this set.',
    },
    accuracy: {
      label: 'Accuracy',
      explanation: 'The share of items given the reference label.',
    },
    prevalence: {
      label: 'Prevalence',
      explanation: (positive: string) =>
        `The share of scored items that are positive (${positive}) in the reference labels. It is a property of the evaluation set, not of the file.`,
    },
    auc: {
      label: 'Area under the ROC curve (AUC)',
      explanation:
        'How well the scores rank positive items above negative ones, from 0 to 1. 0.5 is chance and 1 a perfect ranking.',
    },
    coverage: {
      label: 'Coverage',
      explanation:
        'The share of the task’s items this file gave a label for. Items left out are not scored.',
    },
  },

  /** "95% CI 67% to 88.8%". The bounds arrive formatted. */
  interval: (lower: string, upper: string) => `95% CI ${lower} to ${upper}`,
  /** Screen-reader form of the same interval. */
  intervalSpoken: (lower: string, upper: string) => `95% confidence interval ${lower} to ${upper}`,
  /** "40 of 50": what a proportion rests on. */
  basis: (numerator: string, denominator: string) => `${numerator} of ${denominator}`,
  aucBasis: (resamples: string) =>
    `Interval from ${resamples} bootstrap resamples with a fixed seed, so the same file gets the same interval.`,
  notEstimable: 'Not estimable',
  notEstimableReason: 'No item in the set falls in this rate’s denominator.',
  notEstimableBalanced:
    'Needs both sensitivity and specificity, and the scored items hold only one reference class.',
  aucAbsent: 'Not reported',
  aucAbsentReason:
    'AUC needs a score for every scored item, and this file did not give one for each.',

  confusion: {
    title: 'Counts',
    description:
      'Each scored item falls in one cell: its reference label down the side, the label this file gave across the top. Every rate above is a ratio of these counts.',
    tableLabel: 'Counts of scored items by reference label and submitted label',
    corner: 'Reference ↓ · File →',
    positive: (name: string) => `Positive: ${name}`,
    negative: 'Negative',
    truePositive: 'True positives',
    falseNegative: 'False negatives',
    falsePositive: 'False positives',
    trueNegative: 'True negatives',
  },

  submit: {
    fillIn: (positive: string) =>
      `In the label column, type 1 where the finding is positive (${positive}) and 0 where it is not.`,
    scoreHint:
      'The score column is optional: the model’s confidence that the finding is present, a number from 0 to 1 such as 0.83. Give it for every item and the result includes an AUC; leave it empty and the item is scored on its label alone.',
    templateDescription: (items: string) =>
      `A spreadsheet file with one line for each of the ${items} in this task, an empty column for your labels and an optional column for scores.`,
  },

  formatCheck: {
    scoresRefusedTitle: 'Scores this task does not take',
    scoresRefusedDetail:
      'This task takes one label per item and no score. Delete the score column, or the "score" values in a JSON file.',
    allScored:
      'Every matched line has a score, so the result can include an AUC: it is reported when the scored items include both positive and negative cases.',
    noneScored: 'No line has a score, so the result will not include an AUC. That is allowed.',
    someUnscored: (count: string) =>
      `${count} matched ${count === '1' ? 'line has' : 'lines have'} no score, so the result will not include an AUC. That is allowed; add a score to every line to get one.`,
  },
} as const;

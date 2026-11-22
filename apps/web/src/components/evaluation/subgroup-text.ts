/**
 * Every user-facing sentence about results by subgroup (#410), in one object:
 * the section on a submission's page, the line on the task page and the
 * comparison page all read their wording from here, so moving them to message
 * files is a matter of moving this object.
 *
 * Plain data and small functions only: no JSX, no number formatting (that is
 * in `metrics.ts` and `subgroup-table.ts`). Interpolated values arrive formatted.
 */
export const SUBGROUP_TEXT = {
  section: {
    title: 'Results by subgroup',
    description:
      'The same figures, computed on the items of each group only. A model can have a good overall result and still do worse for one group of patients: this is where that shows.',
    byField: (field: string) => `By ${field.toLowerCase()}`,
    tableLabel: (field: string) => `Results by ${field.toLowerCase()}`,
    groupColumn: 'Group',
    itemsColumn: 'Items',
    overallRow: 'All scored items',
    itemsOf: (scored: string, total: string) => `${scored} of ${total}`,
  },

  suppression: {
    /** In place of a withheld group's figures. */
    notReported: 'Not reported',
    notReportedSpoken: (group: string) =>
      `Not reported for ${group}: the group is too small to publish, or is withheld so that a smaller group cannot be worked out.`,
    /** In place of a rate withheld inside a published group. */
    rateWithheld: 'Withheld',
    rateWithheldSpoken:
      'Withheld: it rests on fewer than the minimum number of items, or would let such a number be worked out.',
    notEstimable: 'n/a',
    notEstimableSpoken: 'Not estimable: no item of this group falls in this rate’s denominator.',
    note: (min: string) =>
      `Groups with fewer than ${min} scored items are not reported, and neither is any figure resting on fewer than ${min} items. Where one group is withheld, another may be withheld with it, so that the withheld figures cannot be worked out from the overall result and the other groups. The same rule applies to every reader, the submitter and administrators included.`,
  },

  caution: {
    title: 'Read group results with care',
    body: 'Each group’s figures rest on fewer items than the overall result, so they are less certain. A difference between groups of this size can arise by chance; a large difference that also appears on another dataset is the signal to act on.',
    intervals:
      'The ranges under each rate are 95% confidence intervals. They are wider for a group than for the whole set, because a group holds fewer items.',
  },

  /** A short form of a 95% interval under a group's rate: "62–85%". */
  intervalShort: (lower: string, upper: string) => `${lower}–${upper}`,
  intervalSpoken: (lower: string, upper: string) => `95% confidence interval ${lower} to ${upper}`,

  task: {
    fieldsTerm: 'Subgroups',
    fields: (list: string) =>
      `Results are also reported by ${list}. Which item belongs to which group is held by the platform, like the reference labels.`,
    rowLink: 'Results by subgroup',
    compareTitle: 'Compare two results by subgroup',
    compareDescription:
      'Put two submissions side by side, group by group. Two models with the same overall result can differ for one group of patients.',
    compareFirst: 'First result',
    compareSecond: 'Second result',
    compareSubmit: 'Compare by subgroup',
    compareNeedsTwo: 'Two scored submissions are needed to compare.',
  },

  compare: {
    eyebrow: 'Comparison by subgroup',
    title: (a: string, b: string) => `${a} and ${b}`,
    metaTitle: (slug: string) => `Compare by subgroup — ${slug} — OCI Evaluation`,
    metaDescription: (slug: string) =>
      `Two results of the ${slug} evaluation task, side by side for each subgroup.`,
    metricChoice: 'Figure shown',
    difference: 'Difference',
    differenceSpoken: (b: string, a: string) => `${b} minus ${a}`,
    points: (value: string) => `${value} pts`,
    notComparable:
      'These two results cannot be compared by subgroup: one of them has no results by subgroup.',
    differentTask: 'Both results must belong to this task.',
    pickTwo: 'Choose two different scored submissions of this task to compare.',
    back: 'Back to the task',
    explain:
      'The difference is the second result minus the first, in percentage points. A group withheld in either result is withheld in the comparison.',
  },
} as const;

import type { EvaluationTaskKindDb, TaskKindScores } from '@oci/shared-types';

/**
 * How a submission's metrics are named, formatted and explained. Shared by the
 * task page (one row per submission) and the submission's own page (#645), so a
 * number reads the same in both places. No JSX here: the vocabulary is plain
 * data and is unit-tested under Vitest's node environment.
 */

/**
 * QWK stays a 0–1-scale figure (and can be negative — worse than chance),
 * so it is never rendered as a percentage. `signDisplay: 'negative'` keeps
 * the minus sign without prefixing positives with a `+`.
 */
const QWK_FORMATTER = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
  signDisplay: 'negative',
});

/** The bounded 0–1 rates read better as percentages. */
const RATE_FORMATTER = new Intl.NumberFormat('en-GB', {
  style: 'percent',
  maximumFractionDigits: 1,
});

export const formatRate = (value: number) => RATE_FORMATTER.format(value);

export const TASK_KIND_LABEL: Record<EvaluationTaskKindDb, string> = {
  GRADING: 'Grading',
  CLASSIFICATION: 'Classification',
};

export interface MetricCell {
  label: string;
  /** Formatted value; `null` when the submission has no scores. */
  value: string | null;
  /** One sentence saying what the number measures, for a reader new to it. */
  explanation: string;
}

/**
 * The metrics for a submission, chosen by the scoring family that produced
 * them (ADR-0020).
 *
 * There is deliberately no metric set common to every kind: quadratic-weighted
 * kappa is meaningless for nominal categories, where predicting a neighbouring
 * class is not "closer" to correct, and per-class F1 says nothing about an
 * ordinal scale. So the cells change with the kind rather than showing blanks
 * for metrics that do not exist.
 *
 * The first cell is the kind's primary metric — the one the API orders by.
 *
 * An unscored submission (PENDING / FAILED) carries no scores at all, so its
 * cells are taken from the TASK's kind rather than guessed: every submission
 * on a task shares that task's kind, which keeps the shape stable instead of
 * reflowing as results arrive.
 */
export function metricCells(
  task: { taskKind: EvaluationTaskKindDb; referableThreshold: number },
  scores: TaskKindScores | null,
): MetricCell[] {
  const kind = scores?.kind ?? task.taskKind;
  const coverage =
    'The share of the task’s items this file gave a label for. Items left out are not scored.';

  if (kind === 'CLASSIFICATION') {
    const m = scores?.kind === 'CLASSIFICATION' ? scores.metrics : null;
    return [
      {
        label: 'Macro F1',
        value: m ? formatRate(m.macroF1) : null,
        explanation:
          'The average of the per-class F1 scores, each class weighing the same however many items it has.',
      },
      {
        label: 'Balanced accuracy',
        value: m ? formatRate(m.balancedAccuracy) : null,
        explanation: 'The average, over the classes, of the share of each class that was found.',
      },
      {
        label: 'Accuracy',
        value: m ? formatRate(m.accuracy) : null,
        explanation: 'The share of items given exactly the reference label.',
      },
      {
        label: 'Micro F1',
        value: m ? formatRate(m.microF1) : null,
        explanation: 'F1 over all items pooled. Equal to accuracy when each item has one label.',
      },
      { label: 'Coverage', value: m ? formatRate(m.coverage) : null, explanation: coverage },
    ];
  }

  const t = task.referableThreshold.toLocaleString('en-GB');
  const m = scores?.kind === 'GRADING' ? scores.metrics : null;
  return [
    {
      label: 'QWK',
      value: m ? QWK_FORMATTER.format(m.qwk) : null,
      explanation:
        'Quadratic-weighted kappa: agreement with the reference grades, from −1 to 1. 1 is perfect, 0 is what chance would give, and a grade that is far off costs more than a near miss.',
    },
    {
      label: 'Accuracy',
      value: m ? formatRate(m.accuracy) : null,
      explanation: 'The share of items given exactly the reference grade.',
    },
    {
      label: 'Referable sensitivity',
      value: m ? formatRate(m.referableSensitivity) : null,
      explanation: `Of the items whose reference grade is ${t} or more, the share this file also graded ${t} or more.`,
    },
    {
      label: 'Referable specificity',
      value: m ? formatRate(m.referableSpecificity) : null,
      explanation: `Of the items whose reference grade is below ${t}, the share this file also graded below ${t}.`,
    },
    { label: 'Coverage', value: m ? formatRate(m.coverage) : null, explanation: coverage },
  ];
}

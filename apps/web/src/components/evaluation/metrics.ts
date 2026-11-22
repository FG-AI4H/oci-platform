import type {
  AucEstimate,
  BinaryDiagnosticScores,
  EvaluationTaskKindDb,
  ProportionEstimate,
  TaskKindScores,
} from '@oci/shared-types';
import { BINARY_DIAGNOSTIC_TEXT as BD } from './binary-diagnostic-text';

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

/** AUC is a 0–1 figure like QWK, never a percentage. */
const AUC_FORMATTER = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

const COUNT_FORMATTER = new Intl.NumberFormat('en-GB');

export const TASK_KIND_LABEL: Record<EvaluationTaskKindDb, string> = {
  GRADING: 'Grading',
  CLASSIFICATION: 'Classification',
  BINARY_DIAGNOSTIC: BD.taskKindLabel,
};

export interface MetricCell {
  /** Stable key; the label may be translated. */
  key: string;
  label: string;
  /** Formatted value; `null` when the submission has no scores. */
  value: string | null;
  /** One sentence saying what the number measures, for a reader new to it. */
  explanation: string;
  /** The 95% interval, written and spoken. Binary-finding tasks only. */
  interval?: { text: string; spoken: string } | null;
  /** What the figure rests on, e.g. "40 of 50". */
  basis?: string | null;
  /**
   * Why a scored submission has no value here (a rate with no denominator, an
   * AUC without scores). Shown in place of the value.
   */
  absent?: { label: string; reason: string } | null;
}

/** The positive class as the pages name it. */
export function positiveClassOf(task: { positiveClassName?: string | null }): string {
  return task.positiveClassName ?? BD.positiveClassFallback;
}

function proportionCell(
  key: string,
  label: string,
  explanation: string,
  scored: boolean,
  p: ProportionEstimate | null,
): MetricCell {
  if (!p) {
    return {
      key,
      label,
      value: null,
      explanation,
      absent: scored ? { label: BD.notEstimable, reason: BD.notEstimableReason } : null,
    };
  }
  const lower = formatRate(p.lower);
  const upper = formatRate(p.upper);
  return {
    key,
    label,
    value: formatRate(p.estimate),
    explanation,
    interval: { text: BD.interval(lower, upper), spoken: BD.intervalSpoken(lower, upper) },
    basis: BD.basis(COUNT_FORMATTER.format(p.numerator), COUNT_FORMATTER.format(p.denominator)),
  };
}

function aucCell(scored: boolean, auc: AucEstimate | null): MetricCell {
  const { label, explanation } = BD.metric.auc;
  if (!auc) {
    return {
      key: 'auc',
      label,
      value: null,
      explanation,
      absent: scored ? { label: BD.aucAbsent, reason: BD.aucAbsentReason } : null,
    };
  }
  const lower = AUC_FORMATTER.format(auc.lower);
  const upper = AUC_FORMATTER.format(auc.upper);
  // How the interval was made goes with the explanation, not on the value
  // line: it is a sentence, not a count, and would crowd the figure.
  return {
    key: 'auc',
    label,
    value: AUC_FORMATTER.format(auc.estimate),
    explanation: `${explanation} ${BD.aucBasis(COUNT_FORMATTER.format(auc.resamples))}`,
    interval: { text: BD.interval(lower, upper), spoken: BD.intervalSpoken(lower, upper) },
    basis: null,
  };
}

/**
 * The cells of a binary-finding result. `row` is the task page's one line per
 * submission: the headline, the four rates a diagnostic reader looks for, and
 * AUC. `full` adds accuracy, prevalence and coverage for the submission page.
 */
export function binaryDiagnosticCells(
  m: BinaryDiagnosticScores | null,
  positive: string,
  scope: 'row' | 'full' = 'full',
): MetricCell[] {
  const scored = m !== null;
  const t = BD.metric;
  const cells: MetricCell[] = [
    {
      key: 'balancedAccuracy',
      label: t.balancedAccuracy.label,
      value: m && m.balancedAccuracy !== null ? formatRate(m.balancedAccuracy) : null,
      explanation: t.balancedAccuracy.explanation,
      // Not estimable when the scored items hold only one reference class.
      absent:
        m && m.balancedAccuracy === null
          ? { label: BD.notEstimable, reason: BD.notEstimableBalanced }
          : null,
    },
    proportionCell(
      'sensitivity',
      t.sensitivity.label,
      t.sensitivity.explanation(positive),
      scored,
      m?.sensitivity ?? null,
    ),
    proportionCell(
      'specificity',
      t.specificity.label,
      t.specificity.explanation,
      scored,
      m?.specificity ?? null,
    ),
    proportionCell(
      'positivePredictiveValue',
      t.positivePredictiveValue.label,
      t.positivePredictiveValue.explanation(positive),
      scored,
      m?.positivePredictiveValue ?? null,
    ),
    proportionCell(
      'negativePredictiveValue',
      t.negativePredictiveValue.label,
      t.negativePredictiveValue.explanation,
      scored,
      m?.negativePredictiveValue ?? null,
    ),
    aucCell(scored, m?.auc ?? null),
  ];
  if (scope === 'row') return cells;
  return [
    ...cells,
    proportionCell(
      'accuracy',
      t.accuracy.label,
      t.accuracy.explanation,
      scored,
      m?.accuracy ?? null,
    ),
    proportionCell(
      'prevalence',
      t.prevalence.label,
      t.prevalence.explanation(positive),
      scored,
      m?.prevalence ?? null,
    ),
    {
      key: 'coverage',
      label: t.coverage.label,
      value: m ? formatRate(m.coverage) : null,
      explanation: t.coverage.explanation,
    },
  ];
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
  task: {
    taskKind: EvaluationTaskKindDb;
    referableThreshold: number;
    positiveClassName?: string | null;
  },
  scores: TaskKindScores | null,
  scope: 'row' | 'full' = 'full',
): MetricCell[] {
  const kind = scores?.kind ?? task.taskKind;
  const coverage =
    'The share of the task’s items this file gave a label for. Items left out are not scored.';

  if (kind === 'BINARY_DIAGNOSTIC') {
    const m = scores?.kind === 'BINARY_DIAGNOSTIC' ? scores.metrics : null;
    return binaryDiagnosticCells(m, positiveClassOf(task), scope);
  }

  if (kind === 'CLASSIFICATION') {
    const m = scores?.kind === 'CLASSIFICATION' ? scores.metrics : null;
    return [
      {
        key: 'macroF1',
        label: 'Macro F1',
        value: m ? formatRate(m.macroF1) : null,
        explanation:
          'The average of the per-class F1 scores, each class weighing the same however many items it has.',
      },
      {
        key: 'balancedAccuracy',
        label: 'Balanced accuracy',
        value: m ? formatRate(m.balancedAccuracy) : null,
        explanation: 'The average, over the classes, of the share of each class that was found.',
      },
      {
        key: 'accuracy',
        label: 'Accuracy',
        value: m ? formatRate(m.accuracy) : null,
        explanation: 'The share of items given exactly the reference label.',
      },
      {
        key: 'microF1',
        label: 'Micro F1',
        value: m ? formatRate(m.microF1) : null,
        explanation: 'F1 over all items pooled. Equal to accuracy when each item has one label.',
      },
      {
        key: 'coverage',
        label: 'Coverage',
        value: m ? formatRate(m.coverage) : null,
        explanation: coverage,
      },
    ];
  }

  const t = task.referableThreshold.toLocaleString('en-GB');
  const m = scores?.kind === 'GRADING' ? scores.metrics : null;
  return [
    {
      key: 'qwk',
      label: 'QWK',
      value: m ? QWK_FORMATTER.format(m.qwk) : null,
      explanation:
        'Quadratic-weighted kappa: agreement with the reference grades, from −1 to 1. 1 is perfect, 0 is what chance would give, and a grade that is far off costs more than a near miss.',
    },
    {
      key: 'accuracy',
      label: 'Accuracy',
      value: m ? formatRate(m.accuracy) : null,
      explanation: 'The share of items given exactly the reference grade.',
    },
    {
      key: 'referableSensitivity',
      label: 'Referable sensitivity',
      value: m ? formatRate(m.referableSensitivity) : null,
      explanation: `Of the items whose reference grade is ${t} or more, the share this file also graded ${t} or more.`,
    },
    {
      key: 'referableSpecificity',
      label: 'Referable specificity',
      value: m ? formatRate(m.referableSpecificity) : null,
      explanation: `Of the items whose reference grade is below ${t}, the share this file also graded below ${t}.`,
    },
    {
      key: 'coverage',
      label: 'Coverage',
      value: m ? formatRate(m.coverage) : null,
      explanation: coverage,
    },
  ];
}

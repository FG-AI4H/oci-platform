import type {
  AucEstimate,
  BinaryDiagnosticScores,
  EvaluationTaskKindDb,
  ProportionEstimate,
  TaskKindScores,
} from '@oci/shared-types';
import type { Formatters } from '../../i18n/format';
import type { EvaluationI18n } from './i18n';

/**
 * How a submission's metrics are named, formatted and explained. Shared by the
 * task page (one row per submission) and the submission's own page (#645), so a
 * number reads the same in both places. No JSX here: the vocabulary comes from
 * the `Evaluation` messages (#654) and the numbers from the interface
 * language's formatters, and both are unit-tested under Vitest's node
 * environment.
 */

/** The bounded 0–1 rates read better as percentages: `85.3%`, `85,3 %`. */
export const formatRate = (f: Formatters, value: number) =>
  f.percent(value, { maximumFractionDigits: 1 });

/**
 * QWK stays a 0–1-scale figure (and can be negative — worse than chance),
 * so it is never rendered as a percentage. `signDisplay: 'negative'` keeps
 * the minus sign without prefixing positives with a `+`.
 */
export const formatQwk = (f: Formatters, value: number) =>
  f.number(value, { minimumFractionDigits: 3, maximumFractionDigits: 3, signDisplay: 'negative' });

/** AUC is a 0–1 figure like QWK, never a percentage. */
const formatAuc = (f: Formatters, value: number) =>
  f.number(value, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** The task kind as a badge names it. */
export function taskKindLabel({ t }: EvaluationI18n, kind: EvaluationTaskKindDb): string {
  return t(`taskKind.${kind}`);
}

export interface MetricCell {
  /** Stable key; the label is translated. */
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
export function positiveClassOf(
  { t }: EvaluationI18n,
  task: { positiveClassName?: string | null },
): string {
  return task.positiveClassName ?? t('binary.positiveClassFallback');
}

function proportionCell(
  { t, f }: EvaluationI18n,
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
      absent: scored
        ? { label: t('binary.notEstimable'), reason: t('binary.notEstimableReason') }
        : null,
    };
  }
  const bounds = { lower: formatRate(f, p.lower), upper: formatRate(f, p.upper) };
  return {
    key,
    label,
    value: formatRate(f, p.estimate),
    explanation,
    interval: { text: t('binary.interval', bounds), spoken: t('binary.intervalSpoken', bounds) },
    basis: t('binary.basis', {
      numerator: f.number(p.numerator),
      denominator: f.number(p.denominator),
    }),
  };
}

function aucCell({ t, f }: EvaluationI18n, scored: boolean, auc: AucEstimate | null): MetricCell {
  const label = t('metric.binary.auc.label');
  const explanation = t('metric.binary.auc.explanation');
  if (!auc) {
    return {
      key: 'auc',
      label,
      value: null,
      explanation,
      absent: scored ? { label: t('binary.aucAbsent'), reason: t('binary.aucAbsentReason') } : null,
    };
  }
  const bounds = { lower: formatAuc(f, auc.lower), upper: formatAuc(f, auc.upper) };
  // How the interval was made goes with the explanation, not on the value
  // line: it is a sentence, not a count, and would crowd the figure.
  return {
    key: 'auc',
    label,
    value: formatAuc(f, auc.estimate),
    explanation: `${explanation} ${t('binary.aucBasis', { resamples: f.number(auc.resamples) })}`,
    interval: { text: t('binary.interval', bounds), spoken: t('binary.intervalSpoken', bounds) },
    basis: null,
  };
}

/**
 * The cells of a binary-finding result. `row` is the task page's one line per
 * submission: the headline, the four rates a diagnostic reader looks for, and
 * AUC. `full` adds accuracy, prevalence and coverage for the submission page.
 */
export function binaryDiagnosticCells(
  i18n: EvaluationI18n,
  m: BinaryDiagnosticScores | null,
  positive: string,
  scope: 'row' | 'full' = 'full',
): MetricCell[] {
  const { t, f } = i18n;
  const scored = m !== null;
  const cells: MetricCell[] = [
    {
      key: 'balancedAccuracy',
      label: t('metric.balancedAccuracy'),
      value: m && m.balancedAccuracy !== null ? formatRate(f, m.balancedAccuracy) : null,
      explanation: t('metric.binary.balancedAccuracy'),
      // Not estimable when the scored items hold only one reference class.
      absent:
        m && m.balancedAccuracy === null
          ? { label: t('binary.notEstimable'), reason: t('binary.notEstimableBalanced') }
          : null,
    },
    proportionCell(
      i18n,
      'sensitivity',
      t('metric.binary.sensitivity.label'),
      t('metric.binary.sensitivity.explanation', { positive }),
      scored,
      m?.sensitivity ?? null,
    ),
    proportionCell(
      i18n,
      'specificity',
      t('metric.binary.specificity.label'),
      t('metric.binary.specificity.explanation'),
      scored,
      m?.specificity ?? null,
    ),
    proportionCell(
      i18n,
      'positivePredictiveValue',
      t('metric.binary.positivePredictiveValue.label'),
      t('metric.binary.positivePredictiveValue.explanation', { positive }),
      scored,
      m?.positivePredictiveValue ?? null,
    ),
    proportionCell(
      i18n,
      'negativePredictiveValue',
      t('metric.binary.negativePredictiveValue.label'),
      t('metric.binary.negativePredictiveValue.explanation'),
      scored,
      m?.negativePredictiveValue ?? null,
    ),
    aucCell(i18n, scored, m?.auc ?? null),
  ];
  if (scope === 'row') return cells;
  return [
    ...cells,
    proportionCell(
      i18n,
      'accuracy',
      t('metric.accuracy'),
      t('metric.binary.accuracy'),
      scored,
      m?.accuracy ?? null,
    ),
    proportionCell(
      i18n,
      'prevalence',
      t('metric.binary.prevalence.label'),
      t('metric.binary.prevalence.explanation', { positive }),
      scored,
      m?.prevalence ?? null,
    ),
    {
      key: 'coverage',
      label: t('metric.coverage.label'),
      value: m ? formatRate(f, m.coverage) : null,
      explanation: t('metric.coverage.explanation'),
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
  i18n: EvaluationI18n,
  task: {
    taskKind: EvaluationTaskKindDb;
    referableThreshold: number;
    positiveClassName?: string | null;
  },
  scores: TaskKindScores | null,
  scope: 'row' | 'full' = 'full',
): MetricCell[] {
  const { t, f } = i18n;
  const kind = scores?.kind ?? task.taskKind;
  const coverage = (value: number | undefined): MetricCell => ({
    key: 'coverage',
    label: t('metric.coverage.label'),
    value: value === undefined ? null : formatRate(f, value),
    explanation: t('metric.coverage.explanation'),
  });

  if (kind === 'BINARY_DIAGNOSTIC') {
    const m = scores?.kind === 'BINARY_DIAGNOSTIC' ? scores.metrics : null;
    return binaryDiagnosticCells(i18n, m, positiveClassOf(i18n, task), scope);
  }

  if (kind === 'CLASSIFICATION') {
    const m = scores?.kind === 'CLASSIFICATION' ? scores.metrics : null;
    return [
      {
        key: 'macroF1',
        label: t('metric.classification.macroF1.label'),
        value: m ? formatRate(f, m.macroF1) : null,
        explanation: t('metric.classification.macroF1.explanation'),
      },
      {
        key: 'balancedAccuracy',
        label: t('metric.balancedAccuracy'),
        value: m ? formatRate(f, m.balancedAccuracy) : null,
        explanation: t('metric.classification.balancedAccuracy'),
      },
      {
        key: 'accuracy',
        label: t('metric.accuracy'),
        value: m ? formatRate(f, m.accuracy) : null,
        explanation: t('metric.classification.accuracy'),
      },
      {
        key: 'microF1',
        label: t('metric.classification.microF1.label'),
        value: m ? formatRate(f, m.microF1) : null,
        explanation: t('metric.classification.microF1.explanation'),
      },
      coverage(m?.coverage),
    ];
  }

  const threshold = f.number(task.referableThreshold);
  const m = scores?.kind === 'GRADING' ? scores.metrics : null;
  return [
    {
      key: 'qwk',
      label: t('metric.grading.qwk.label'),
      value: m ? formatQwk(f, m.qwk) : null,
      explanation: t('metric.grading.qwk.explanation'),
    },
    {
      key: 'accuracy',
      label: t('metric.accuracy'),
      value: m ? formatRate(f, m.accuracy) : null,
      explanation: t('metric.grading.accuracy'),
    },
    {
      key: 'referableSensitivity',
      label: t('metric.grading.referableSensitivity.label'),
      value: m ? formatRate(f, m.referableSensitivity) : null,
      explanation: t('metric.grading.referableSensitivity.explanation', { threshold }),
    },
    {
      key: 'referableSpecificity',
      label: t('metric.grading.referableSpecificity.label'),
      value: m ? formatRate(f, m.referableSpecificity) : null,
      explanation: t('metric.grading.referableSpecificity.explanation', { threshold }),
    },
    coverage(m?.coverage),
  ];
}

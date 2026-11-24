import type {
  EvaluationTaskKindDb,
  EvidenceGap,
  ProportionEstimate,
  SubgroupMetrics,
  SubgroupResults,
  TaskKindScores,
} from '@oci/shared-types';
import type { Formatters } from '../../../../../../i18n/format';

/**
 * The evidence summary's figures as the page prints them (#652): which
 * measures a task kind shows, formatted in the interface language. No JSX
 * and no wording, so it runs under Vitest's node environment; the page puts
 * the words around it from the `EvidenceSummary` namespace.
 *
 * It never decides what to withhold. The API sends subgroup results already
 * suppressed (ADR-0030); a withheld group arrives without figures and is
 * shown as withheld.
 */

/* eslint-disable security/detect-object-injection --
 * Every computed member access below indexes a parsed object with a key of
 * a closed literal union (`MetricKey`, the task kind), narrowed before use. */

export type MetricKey =
  | 'sensitivity'
  | 'specificity'
  | 'positivePredictiveValue'
  | 'negativePredictiveValue'
  | 'balancedAccuracy'
  | 'auc'
  | 'accuracy'
  | 'prevalence'
  | 'coverage'
  | 'macroF1'
  | 'qwk'
  | 'referableSensitivity'
  | 'referableSpecificity';

export interface FormattedInterval {
  lower: string;
  upper: string;
}

export interface MetricRow {
  key: MetricKey;
  /** Null when there is no figure; `absent` says why. */
  value: string | null;
  interval: FormattedInterval | null;
  basis: { numerator: string; denominator: string } | null;
  /** AUC only: the bootstrap resamples its interval rests on. */
  resamples: string | null;
  absent: 'notEstimable' | 'aucNeedsScores' | null;
}

/** A rate, with one decimal: `85.3%`, `85,3 %`. */
export const rate = (f: Formatters, v: number) => f.percent(v, { maximumFractionDigits: 1 });

/** A 0–1 or −1–1 statistic that is not a rate (kappa, AUC): three decimals. */
export const statistic = (f: Formatters, v: number) =>
  f.number(v, { minimumFractionDigits: 3, maximumFractionDigits: 3, signDisplay: 'negative' });

function proportionRow(key: MetricKey, p: ProportionEstimate | null, f: Formatters): MetricRow {
  if (!p) {
    return {
      key,
      value: null,
      interval: null,
      basis: null,
      resamples: null,
      absent: 'notEstimable',
    };
  }
  return {
    key,
    value: rate(f, p.estimate),
    interval: { lower: rate(f, p.lower), upper: rate(f, p.upper) },
    basis: { numerator: f.number(p.numerator), denominator: f.number(p.denominator) },
    resamples: null,
    absent: null,
  };
}

function plainRow(key: MetricKey, value: number | null, f: Formatters, isRate = true): MetricRow {
  return {
    key,
    value: value === null ? null : isRate ? rate(f, value) : statistic(f, value),
    interval: null,
    basis: null,
    resamples: null,
    absent: value === null ? 'notEstimable' : null,
  };
}

/**
 * The measures of a result, headline first: the first two are what the "at a
 * glance" box shows. The set changes with the scoring family (ADR-0020);
 * there is no measure common to all of them.
 */
export function metricRows(scores: TaskKindScores, f: Formatters): MetricRow[] {
  switch (scores.kind) {
    case 'BINARY_DIAGNOSTIC': {
      const m = scores.metrics;
      return [
        proportionRow('sensitivity', m.sensitivity, f),
        proportionRow('specificity', m.specificity, f),
        proportionRow('positivePredictiveValue', m.positivePredictiveValue, f),
        proportionRow('negativePredictiveValue', m.negativePredictiveValue, f),
        plainRow('balancedAccuracy', m.balancedAccuracy, f),
        m.auc
          ? {
              key: 'auc',
              value: statistic(f, m.auc.estimate),
              interval: { lower: statistic(f, m.auc.lower), upper: statistic(f, m.auc.upper) },
              basis: null,
              resamples: f.number(m.auc.resamples),
              absent: null,
            }
          : {
              key: 'auc',
              value: null,
              interval: null,
              basis: null,
              resamples: null,
              absent: 'aucNeedsScores',
            },
        proportionRow('accuracy', m.accuracy, f),
        proportionRow('prevalence', m.prevalence, f),
        plainRow('coverage', m.coverage, f),
      ];
    }
    case 'CLASSIFICATION': {
      const m = scores.metrics;
      return [
        plainRow('macroF1', m.macroF1, f),
        plainRow('balancedAccuracy', m.balancedAccuracy, f),
        plainRow('accuracy', m.accuracy, f),
        plainRow('coverage', m.coverage, f),
      ];
    }
    case 'GRADING': {
      const m = scores.metrics;
      return [
        plainRow('qwk', m.qwk, f, false),
        plainRow('accuracy', m.accuracy, f),
        plainRow('referableSensitivity', m.referableSensitivity, f),
        plainRow('referableSpecificity', m.referableSpecificity, f),
        plainRow('coverage', m.coverage, f),
      ];
    }
  }
}

/**
 * Sensitivity, specificity and the predictive values, with their intervals
 * and counts: of a binary finding, or derived from a two-class result (#652).
 */
export function diagnosticRows(
  d: {
    sensitivity: ProportionEstimate | null;
    specificity: ProportionEstimate | null;
    positivePredictiveValue: ProportionEstimate | null;
    negativePredictiveValue: ProportionEstimate | null;
  },
  f: Formatters,
): MetricRow[] {
  return [
    proportionRow('sensitivity', d.sensitivity, f),
    proportionRow('specificity', d.specificity, f),
    proportionRow('positivePredictiveValue', d.positivePredictiveValue, f),
    proportionRow('negativePredictiveValue', d.negativePredictiveValue, f),
  ];
}

// ---- Results by subgroup -----------------------------------------------------

/** The columns of a group table, as the submission page shows them (#410). */
export const SUBGROUP_COLUMNS: Record<EvaluationTaskKindDb, MetricKey[]> = {
  CLASSIFICATION: ['macroF1', 'accuracy', 'balancedAccuracy'],
  GRADING: ['qwk', 'accuracy', 'referableSensitivity', 'referableSpecificity'],
  BINARY_DIAGNOSTIC: ['sensitivity', 'specificity', 'accuracy'],
};

export interface SubgroupFigure {
  state: 'value' | 'withheld' | 'na';
  /** The figure, when `state` is `value`. */
  text: string | null;
  interval: FormattedInterval | null;
}

export interface SubgroupRowView {
  key: string;
  label: string;
  kind: 'overall' | 'group' | 'suppressed';
  /** Scored items, and the group's items when the file left some out. */
  items: { scored: string; total: string | null } | null;
  /** One per column; empty for a suppressed group. */
  figures: SubgroupFigure[];
}

export interface SubgroupTableView {
  key: string;
  label: string;
  columns: MetricKey[];
  rows: SubgroupRowView[];
}

const NA: SubgroupFigure = { state: 'na', text: null, interval: null };
const WITHHELD: SubgroupFigure = { state: 'withheld', text: null, interval: null };

function figureOf(value: number | null | undefined, f: Formatters, isRate = true): SubgroupFigure {
  if (value === null || value === undefined) return NA;
  return {
    state: 'value',
    text: isRate ? rate(f, value) : statistic(f, value),
    interval: null,
  };
}

function proportionFigure(p: ProportionEstimate | null, f: Formatters): SubgroupFigure {
  if (!p) return NA;
  return {
    state: 'value',
    text: rate(f, p.estimate),
    interval: { lower: rate(f, p.lower), upper: rate(f, p.upper) },
  };
}

function groupFigure(m: SubgroupMetrics, key: MetricKey, f: Formatters): SubgroupFigure {
  switch (m.kind) {
    case 'CLASSIFICATION':
      return key === 'macroF1' || key === 'accuracy' || key === 'balancedAccuracy'
        ? figureOf(m[key], f)
        : NA;
    case 'GRADING':
      if (key === 'referableSensitivity' || key === 'referableSpecificity') {
        return m.ratesWithheld ? WITHHELD : figureOf(m[key], f);
      }
      if (key === 'qwk') return figureOf(m.qwk, f, false);
      return key === 'accuracy' ? figureOf(m.accuracy, f) : NA;
    case 'BINARY_DIAGNOSTIC':
      if (key === 'accuracy') return proportionFigure(m.accuracy, f);
      if (key === 'sensitivity' || key === 'specificity') {
        return m.ratesWithheld ? WITHHELD : proportionFigure(m[key], f);
      }
      return NA;
  }
}

function overallFigure(scores: TaskKindScores, key: MetricKey, f: Formatters): SubgroupFigure {
  switch (scores.kind) {
    case 'CLASSIFICATION': {
      const m = scores.metrics;
      return key === 'macroF1' || key === 'accuracy' || key === 'balancedAccuracy'
        ? figureOf(m[key], f)
        : NA;
    }
    case 'GRADING': {
      const m = scores.metrics;
      if (key === 'qwk') return figureOf(m.qwk, f, false);
      return key === 'accuracy' || key === 'referableSensitivity' || key === 'referableSpecificity'
        ? figureOf(m[key], f)
        : NA;
    }
    case 'BINARY_DIAGNOSTIC': {
      const m = scores.metrics;
      return key === 'sensitivity' || key === 'specificity' || key === 'accuracy'
        ? proportionFigure(m[key], f)
        : NA;
    }
  }
}

/** Scored items of the whole set, where the scores carry the counts. */
export function scoredItems(scores: TaskKindScores): number | null {
  if (scores.kind === 'CLASSIFICATION') {
    return scores.metrics.perClass.reduce((n, c) => n + c.support, 0);
  }
  if (scores.kind === 'BINARY_DIAGNOSTIC') {
    const m = scores.metrics;
    return m.truePositives + m.falsePositives + m.trueNegatives + m.falseNegatives;
  }
  return null;
}

/** One table per declared field: the whole set first, then each group as stored. */
export function subgroupViews(
  results: SubgroupResults,
  scores: TaskKindScores,
  f: Formatters,
  overallLabel: string,
): SubgroupTableView[] {
  const columns = SUBGROUP_COLUMNS[scores.kind];
  const overallCount = scoredItems(scores);
  return results.fields.map((field) => ({
    key: field.key,
    label: field.label,
    columns,
    rows: [
      {
        key: '__overall',
        label: overallLabel,
        kind: 'overall',
        items: overallCount === null ? null : { scored: f.number(overallCount), total: null },
        figures: columns.map((k) => overallFigure(scores, k, f)),
      },
      ...field.cells.map(
        (cell): SubgroupRowView =>
          cell.status === 'SUPPRESSED'
            ? { key: cell.value, label: cell.label, kind: 'suppressed', items: null, figures: [] }
            : {
                key: cell.value,
                label: cell.label,
                kind: 'group',
                items: {
                  scored: f.number(cell.scoredCount),
                  total: cell.scoredCount === cell.itemCount ? null : f.number(cell.itemCount),
                },
                figures: columns.map((k) => groupFigure(cell.metrics, k, f)),
              },
      ),
    ],
  }));
}

// ---- Gaps and trace ----------------------------------------------------------

/**
 * A gap's values ready for its sentence: counts in the language's digits, a
 * share as a percentage. Codes (a status, a task kind, an event type) pass
 * through for the message's `select` or as written.
 */
export function gapValues(gap: EvidenceGap, f: Formatters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(gap.params)) {
    if (typeof value === 'string') out[name] = value;
    else out[name] = name === 'coverage' ? rate(f, value) : f.number(value);
  }
  return out;
}

/** The gaps grouped by section, in order, for the "in section N" mark. */
export function gapsBySection(gaps: readonly EvidenceGap[]): Map<number, EvidenceGap[]> {
  const out = new Map<number, EvidenceGap[]>();
  for (const gap of [...gaps].sort((a, b) => a.section - b.section)) {
    out.set(gap.section, [...(out.get(gap.section) ?? []), gap]);
  }
  return out;
}

/** A hash shortened for a table cell; the full value is in the title and the export. */
export function shortHash(digest: string | null): string {
  if (!digest) return '—';
  return digest.length > 12 ? `${digest.slice(0, 12)}…` : digest;
}

/** The evaluation events the page names in words; anything else shows its code. */
export type KnownEvent = 'submitted' | 'scored' | 'failed';

export function knownEvent(eventType: string): KnownEvent | null {
  switch (eventType) {
    case 'evaluation.submitted':
      return 'submitted';
    case 'evaluation.scored':
      return 'scored';
    case 'evaluation.failed':
      return 'failed';
    default:
      return null;
  }
}

/** A long free-text manifest field, cut at a word for the printed page. */
export function excerpt(text: string, max = 280): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const head = text.slice(0, max);
  const space = head.lastIndexOf(' ');
  return { text: `${(space > max * 0.6 ? head.slice(0, space) : head).trimEnd()}…`, cut: true };
}

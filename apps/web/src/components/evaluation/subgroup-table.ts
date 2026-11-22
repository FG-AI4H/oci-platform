import type {
  EvaluationTaskKindDb,
  ProportionEstimate,
  SubgroupCell,
  SubgroupFieldResult,
  SubgroupMetrics,
  SubgroupResults,
  TaskKindScores,
} from '@oci/shared-types';
import { BINARY_DIAGNOSTIC_TEXT as BD } from './binary-diagnostic-text';
import { formatQwk, formatRate } from './metrics';
import { SUBGROUP_TEXT as T } from './subgroup-text';

/**
 * Results by subgroup as tables (#410): which columns a task kind shows, and
 * what each cell says. No JSX, so it is unit-tested under Vitest's node
 * environment and the page only lays the model out.
 *
 * The API has already withheld what may not be published; this module never
 * decides what to hide. It only says, in words, that something was withheld.
 */

/* eslint-disable security/detect-object-injection --
 * Every computed member access indexes a closed record or a parsed object
 * with a key of a closed literal union (`SubgroupMetricKey`, the task kind),
 * narrowed before use. No request string reaches an index. */

const COUNT = new Intl.NumberFormat('en-GB');

/** A figure a column can show. */
export type SubgroupMetricKey =
  | 'qwk'
  | 'accuracy'
  | 'balancedAccuracy'
  | 'macroF1'
  | 'referableSensitivity'
  | 'referableSpecificity'
  | 'sensitivity'
  | 'specificity';

const LABEL: Record<SubgroupMetricKey, string> = {
  qwk: 'QWK',
  accuracy: 'Accuracy',
  balancedAccuracy: 'Balanced accuracy',
  macroF1: 'Macro F1',
  referableSensitivity: 'Referable sensitivity',
  referableSpecificity: 'Referable specificity',
  sensitivity: BD.metric.sensitivity.label,
  specificity: BD.metric.specificity.label,
};

/**
 * The columns of a group table, headline first. Kept to what reads at 375 px:
 * a binary task shows sensitivity, specificity and accuracy (the predictive
 * values depend on prevalence, which differs by group by construction).
 */
export const SUBGROUP_COLUMNS: Record<EvaluationTaskKindDb, SubgroupMetricKey[]> = {
  CLASSIFICATION: ['macroF1', 'accuracy', 'balancedAccuracy'],
  GRADING: ['qwk', 'accuracy', 'referableSensitivity', 'referableSpecificity'],
  BINARY_DIAGNOSTIC: ['sensitivity', 'specificity', 'accuracy'],
};

/** The figures the comparison page offers, headline first. */
export const COMPARE_METRICS: Record<EvaluationTaskKindDb, SubgroupMetricKey[]> = {
  CLASSIFICATION: ['macroF1', 'accuracy', 'balancedAccuracy'],
  GRADING: ['qwk', 'accuracy', 'referableSensitivity', 'referableSpecificity'],
  BINARY_DIAGNOSTIC: ['balancedAccuracy', 'sensitivity', 'specificity', 'accuracy'],
};

export const metricLabel = (key: SubgroupMetricKey) => LABEL[key];

/** One figure as the table prints it. */
export interface FigureCell {
  /** What is printed. */
  text: string;
  /** The 95% interval in short form, binary rates only. */
  interval?: string;
  /** Read by a screen reader in place of `text` + `interval`, when they need words. */
  spoken?: string;
  state: 'value' | 'withheld' | 'na';
  /** The raw number, for the comparison's difference. */
  value: number | null;
}

export interface SubgroupRow {
  key: string;
  label: string;
  kind: 'overall' | 'group' | 'suppressed';
  /** One per column; empty for a suppressed row. */
  cells: FigureCell[];
  /** "67" or "45 of 60"; null where not known. */
  items: string | null;
}

export interface SubgroupTable {
  key: string;
  label: string;
  columns: { key: SubgroupMetricKey; label: string }[];
  rows: SubgroupRow[];
}

/** A figure is a rate (shown as a percentage) unless it is QWK. */
const isRate = (key: SubgroupMetricKey) => key !== 'qwk';

function numberCell(key: SubgroupMetricKey, value: number | null | undefined): FigureCell {
  if (value === null || value === undefined) {
    return {
      text: T.suppression.notEstimable,
      spoken: T.suppression.notEstimableSpoken,
      state: 'na',
      value: null,
    };
  }
  return { text: isRate(key) ? formatRate(value) : formatQwk(value), state: 'value', value };
}

function proportionCell(p: ProportionEstimate | null, withheld: boolean): FigureCell {
  if (withheld) {
    return {
      text: T.suppression.rateWithheld,
      spoken: T.suppression.rateWithheldSpoken,
      state: 'withheld',
      value: null,
    };
  }
  if (!p) {
    return {
      text: T.suppression.notEstimable,
      spoken: T.suppression.notEstimableSpoken,
      state: 'na',
      value: null,
    };
  }
  const lower = formatRate(p.lower);
  const upper = formatRate(p.upper);
  return {
    text: formatRate(p.estimate),
    interval: T.intervalShort(lower, upper),
    spoken: `${formatRate(p.estimate)}, ${T.intervalSpoken(lower, upper)}`,
    state: 'value',
    value: p.estimate,
  };
}

/** One figure of one published group. */
export function groupFigure(m: SubgroupMetrics, key: SubgroupMetricKey): FigureCell {
  switch (m.kind) {
    case 'CLASSIFICATION':
      return numberCell(
        key,
        key === 'macroF1' || key === 'accuracy' || key === 'balancedAccuracy' ? m[key] : null,
      );
    case 'GRADING':
      if (key === 'referableSensitivity' || key === 'referableSpecificity') {
        return m.ratesWithheld
          ? {
              text: T.suppression.rateWithheld,
              spoken: T.suppression.rateWithheldSpoken,
              state: 'withheld',
              value: null,
            }
          : numberCell(key, m[key]);
      }
      return numberCell(key, key === 'qwk' || key === 'accuracy' ? m[key] : null);
    case 'BINARY_DIAGNOSTIC':
      if (key === 'accuracy') return proportionCell(m.accuracy, false);
      if (key === 'sensitivity' || key === 'specificity')
        return proportionCell(m[key], m.ratesWithheld);
      if (key === 'balancedAccuracy') {
        return m.ratesWithheld
          ? {
              text: T.suppression.rateWithheld,
              spoken: T.suppression.rateWithheldSpoken,
              state: 'withheld',
              value: null,
            }
          : numberCell(key, m.balancedAccuracy);
      }
      return numberCell(key, null);
  }
}

/** One figure of the whole-set result, for the first row of every table. */
export function overallFigure(scores: TaskKindScores, key: SubgroupMetricKey): FigureCell {
  switch (scores.kind) {
    case 'CLASSIFICATION': {
      const m = scores.metrics;
      return numberCell(
        key,
        key === 'macroF1' || key === 'accuracy' || key === 'balancedAccuracy' ? m[key] : null,
      );
    }
    case 'GRADING': {
      const m = scores.metrics;
      return numberCell(
        key,
        key === 'qwk' ||
          key === 'accuracy' ||
          key === 'referableSensitivity' ||
          key === 'referableSpecificity'
          ? m[key]
          : null,
      );
    }
    case 'BINARY_DIAGNOSTIC': {
      const m = scores.metrics;
      if (key === 'sensitivity' || key === 'specificity' || key === 'accuracy')
        return proportionCell(m[key], false);
      if (key === 'balancedAccuracy') return numberCell(key, m.balancedAccuracy);
      return numberCell(key, null);
    }
  }
}

/** Scored items of the whole set, where the scores say so. */
function overallItems(scores: TaskKindScores): string | null {
  if (scores.kind === 'CLASSIFICATION') {
    return COUNT.format(scores.metrics.perClass.reduce((n, c) => n + c.support, 0));
  }
  if (scores.kind === 'BINARY_DIAGNOSTIC') {
    const m = scores.metrics;
    return COUNT.format(m.truePositives + m.falsePositives + m.trueNegatives + m.falseNegatives);
  }
  return null;
}

function groupItems(cell: Extract<SubgroupCell, { status: 'REPORTED' }>): string {
  return cell.scoredCount === cell.itemCount
    ? COUNT.format(cell.scoredCount)
    : T.section.itemsOf(COUNT.format(cell.scoredCount), COUNT.format(cell.itemCount));
}

/** The table of one field: the whole-set row, then one row per declared group. */
export function subgroupTable(field: SubgroupFieldResult, scores: TaskKindScores): SubgroupTable {
  const keys = SUBGROUP_COLUMNS[scores.kind];
  const rows: SubgroupRow[] = [
    {
      key: '__overall',
      label: T.section.overallRow,
      kind: 'overall',
      cells: keys.map((k) => overallFigure(scores, k)),
      items: overallItems(scores),
    },
    ...field.cells.map(
      (cell): SubgroupRow =>
        cell.status === 'SUPPRESSED'
          ? { key: cell.value, label: cell.label, kind: 'suppressed', cells: [], items: null }
          : {
              key: cell.value,
              label: cell.label,
              kind: 'group',
              cells: keys.map((k) => groupFigure(cell.metrics, k)),
              items: groupItems(cell),
            },
    ),
  ];
  return {
    key: field.key,
    label: field.label,
    columns: keys.map((k) => ({ key: k, label: LABEL[k] })),
    rows,
  };
}

/** Every field's table, in the declared order. */
export function subgroupTables(results: SubgroupResults, scores: TaskKindScores): SubgroupTable[] {
  return results.fields.map((f) => subgroupTable(f, scores));
}

// ---- Comparison of two results -------------------------------------------

export interface CompareRow {
  key: string;
  label: string;
  kind: 'overall' | 'group' | 'suppressed';
  a: FigureCell | null;
  b: FigureCell | null;
  /** B minus A, formatted, when both are numbers. */
  difference: string | null;
  /** The raw difference, for emphasis. */
  differenceValue: number | null;
}

export interface CompareTable {
  key: string;
  label: string;
  rows: CompareRow[];
}

const SIGNED_POINTS = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});
const SIGNED_QWK = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
  signDisplay: 'exceptZero',
});

function formatDifference(key: SubgroupMetricKey, d: number): string {
  // A rate's difference in percentage points; QWK's on its own scale.
  return isRate(key) ? T.compare.points(SIGNED_POINTS.format(d * 100)) : SIGNED_QWK.format(d);
}

function compareRow(
  key: string,
  label: string,
  kind: CompareRow['kind'],
  metric: SubgroupMetricKey,
  a: FigureCell | null,
  b: FigureCell | null,
): CompareRow {
  const d = a?.value != null && b?.value != null ? b.value - a.value : null;
  return {
    key,
    label,
    kind,
    a,
    b,
    difference: d === null ? null : formatDifference(metric, d),
    differenceValue: d,
  };
}

/**
 * Two results of one task, side by side for one figure, per field. A group
 * withheld in either result is withheld in the comparison: the comparison
 * never shows half of a withheld pair.
 */
export function compareTables(
  metric: SubgroupMetricKey,
  a: { scores: TaskKindScores; subgroups: SubgroupResults },
  b: { scores: TaskKindScores; subgroups: SubgroupResults },
): CompareTable[] {
  return a.subgroups.fields.map((fa) => {
    const fb = b.subgroups.fields.find((f) => f.key === fa.key);
    const rows: CompareRow[] = [
      compareRow(
        '__overall',
        T.section.overallRow,
        'overall',
        metric,
        overallFigure(a.scores, metric),
        overallFigure(b.scores, metric),
      ),
    ];
    for (const ca of fa.cells) {
      const cb = fb?.cells.find((c) => c.value === ca.value);
      if (ca.status !== 'REPORTED' || cb?.status !== 'REPORTED') {
        rows.push(compareRow(ca.value, ca.label, 'suppressed', metric, null, null));
      } else {
        rows.push(
          compareRow(
            ca.value,
            ca.label,
            'group',
            metric,
            groupFigure(ca.metrics, metric),
            groupFigure(cb.metrics, metric),
          ),
        );
      }
    }
    return { key: fa.key, label: fa.label, rows };
  });
}

import type {
  EvaluationTaskKindDb,
  ProportionEstimate,
  SubgroupCell,
  SubgroupFieldResult,
  SubgroupMetrics,
  SubgroupResults,
  TaskKindScores,
} from '@oci/shared-types';
import type { EvaluationI18n } from './i18n';
import { formatQwk, formatRate } from './metrics';

/**
 * Results by subgroup as tables (#410): which columns a task kind shows, and
 * what each cell says, in the interface language (#654). No JSX, so it is
 * unit-tested under Vitest's node environment and the page only lays the
 * model out.
 *
 * The API has already withheld what may not be published; this module never
 * decides what to hide. It only says, in words, that something was withheld.
 *
 * The field and group labels (`Sex`, `Female`) come from the task's
 * declaration through the API and are shown as declared.
 */

/* eslint-disable security/detect-object-injection --
 * Every computed member access indexes a closed record or a parsed object
 * with a key of a closed literal union (`SubgroupMetricKey`, the task kind),
 * narrowed before use. No request string reaches an index. */

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

/** A figure's column heading. */
export function metricLabel({ t }: EvaluationI18n, key: SubgroupMetricKey): string {
  switch (key) {
    case 'qwk':
      return t('metric.grading.qwk.label');
    case 'accuracy':
      return t('metric.accuracy');
    case 'balancedAccuracy':
      return t('metric.balancedAccuracy');
    case 'macroF1':
      return t('metric.classification.macroF1.label');
    case 'referableSensitivity':
      return t('metric.grading.referableSensitivity.label');
    case 'referableSpecificity':
      return t('metric.grading.referableSpecificity.label');
    case 'sensitivity':
      return t('metric.binary.sensitivity.label');
    case 'specificity':
      return t('metric.binary.specificity.label');
  }
}

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

function withheldCell({ t }: EvaluationI18n): FigureCell {
  return {
    text: t('subgroup.suppression.rateWithheld'),
    spoken: t('subgroup.suppression.rateWithheldSpoken'),
    state: 'withheld',
    value: null,
  };
}

function notEstimableCell({ t }: EvaluationI18n): FigureCell {
  return {
    text: t('subgroup.suppression.notEstimable'),
    spoken: t('subgroup.suppression.notEstimableSpoken'),
    state: 'na',
    value: null,
  };
}

function numberCell(
  i18n: EvaluationI18n,
  key: SubgroupMetricKey,
  value: number | null | undefined,
): FigureCell {
  if (value === null || value === undefined) return notEstimableCell(i18n);
  return {
    text: isRate(key) ? formatRate(i18n.f, value) : formatQwk(i18n.f, value),
    state: 'value',
    value,
  };
}

function proportionCell(
  i18n: EvaluationI18n,
  p: ProportionEstimate | null,
  withheld: boolean,
): FigureCell {
  if (withheld) return withheldCell(i18n);
  if (!p) return notEstimableCell(i18n);
  const { t, f } = i18n;
  const bounds = { lower: formatRate(f, p.lower), upper: formatRate(f, p.upper) };
  const text = formatRate(f, p.estimate);
  return {
    text,
    interval: t('subgroup.intervalShort', bounds),
    spoken: `${text}, ${t('subgroup.intervalSpoken', bounds)}`,
    state: 'value',
    value: p.estimate,
  };
}

/** One figure of one published group. */
export function groupFigure(
  i18n: EvaluationI18n,
  m: SubgroupMetrics,
  key: SubgroupMetricKey,
): FigureCell {
  switch (m.kind) {
    case 'CLASSIFICATION':
      return numberCell(
        i18n,
        key,
        key === 'macroF1' || key === 'accuracy' || key === 'balancedAccuracy' ? m[key] : null,
      );
    case 'GRADING':
      if (key === 'referableSensitivity' || key === 'referableSpecificity') {
        return m.ratesWithheld ? withheldCell(i18n) : numberCell(i18n, key, m[key]);
      }
      return numberCell(i18n, key, key === 'qwk' || key === 'accuracy' ? m[key] : null);
    case 'BINARY_DIAGNOSTIC':
      if (key === 'accuracy') return proportionCell(i18n, m.accuracy, false);
      if (key === 'sensitivity' || key === 'specificity')
        return proportionCell(i18n, m[key], m.ratesWithheld);
      if (key === 'balancedAccuracy') {
        return m.ratesWithheld ? withheldCell(i18n) : numberCell(i18n, key, m.balancedAccuracy);
      }
      return numberCell(i18n, key, null);
  }
}

/** One figure of the whole-set result, for the first row of every table. */
export function overallFigure(
  i18n: EvaluationI18n,
  scores: TaskKindScores,
  key: SubgroupMetricKey,
): FigureCell {
  switch (scores.kind) {
    case 'CLASSIFICATION': {
      const m = scores.metrics;
      return numberCell(
        i18n,
        key,
        key === 'macroF1' || key === 'accuracy' || key === 'balancedAccuracy' ? m[key] : null,
      );
    }
    case 'GRADING': {
      const m = scores.metrics;
      return numberCell(
        i18n,
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
        return proportionCell(i18n, m[key], false);
      if (key === 'balancedAccuracy') return numberCell(i18n, key, m.balancedAccuracy);
      return numberCell(i18n, key, null);
    }
  }
}

/** Scored items of the whole set, where the scores say so. */
function overallItems({ f }: EvaluationI18n, scores: TaskKindScores): string | null {
  if (scores.kind === 'CLASSIFICATION') {
    return f.number(scores.metrics.perClass.reduce((n, c) => n + c.support, 0));
  }
  if (scores.kind === 'BINARY_DIAGNOSTIC') {
    const m = scores.metrics;
    return f.number(m.truePositives + m.falsePositives + m.trueNegatives + m.falseNegatives);
  }
  return null;
}

function groupItems(
  { t, f }: EvaluationI18n,
  cell: Extract<SubgroupCell, { status: 'REPORTED' }>,
): string {
  return cell.scoredCount === cell.itemCount
    ? f.number(cell.scoredCount)
    : t('subgroup.section.itemsOf', {
        scored: f.number(cell.scoredCount),
        total: f.number(cell.itemCount),
      });
}

/** The table of one field: the whole-set row, then one row per declared group. */
export function subgroupTable(
  i18n: EvaluationI18n,
  field: SubgroupFieldResult,
  scores: TaskKindScores,
): SubgroupTable {
  const keys = SUBGROUP_COLUMNS[scores.kind];
  const rows: SubgroupRow[] = [
    {
      key: '__overall',
      label: i18n.t('subgroup.section.overallRow'),
      kind: 'overall',
      cells: keys.map((k) => overallFigure(i18n, scores, k)),
      items: overallItems(i18n, scores),
    },
    ...field.cells.map(
      (cell): SubgroupRow =>
        cell.status === 'SUPPRESSED'
          ? { key: cell.value, label: cell.label, kind: 'suppressed', cells: [], items: null }
          : {
              key: cell.value,
              label: cell.label,
              kind: 'group',
              cells: keys.map((k) => groupFigure(i18n, cell.metrics, k)),
              items: groupItems(i18n, cell),
            },
    ),
  ];
  return {
    key: field.key,
    label: field.label,
    columns: keys.map((k) => ({ key: k, label: metricLabel(i18n, k) })),
    rows,
  };
}

/** Every field's table, in the declared order. */
export function subgroupTables(
  i18n: EvaluationI18n,
  results: SubgroupResults,
  scores: TaskKindScores,
): SubgroupTable[] {
  return results.fields.map((field) => subgroupTable(i18n, field, scores));
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

function formatDifference({ t, f }: EvaluationI18n, key: SubgroupMetricKey, d: number): string {
  // A rate's difference in percentage points; QWK's on its own scale.
  return isRate(key)
    ? t('subgroup.compare.points', {
        value: f.number(d * 100, { maximumFractionDigits: 1, signDisplay: 'exceptZero' }),
      })
    : f.number(d, {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
        signDisplay: 'exceptZero',
      });
}

function compareRow(
  i18n: EvaluationI18n,
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
    difference: d === null ? null : formatDifference(i18n, metric, d),
    differenceValue: d,
  };
}

/**
 * Two results of one task, side by side for one figure, per field. A group
 * withheld in either result is withheld in the comparison: the comparison
 * never shows half of a withheld pair.
 */
export function compareTables(
  i18n: EvaluationI18n,
  metric: SubgroupMetricKey,
  a: { scores: TaskKindScores; subgroups: SubgroupResults },
  b: { scores: TaskKindScores; subgroups: SubgroupResults },
): CompareTable[] {
  return a.subgroups.fields.map((fa) => {
    const fb = b.subgroups.fields.find((f) => f.key === fa.key);
    const rows: CompareRow[] = [
      compareRow(
        i18n,
        '__overall',
        i18n.t('subgroup.section.overallRow'),
        'overall',
        metric,
        overallFigure(i18n, a.scores, metric),
        overallFigure(i18n, b.scores, metric),
      ),
    ];
    for (const ca of fa.cells) {
      const cb = fb?.cells.find((c) => c.value === ca.value);
      if (ca.status !== 'REPORTED' || cb?.status !== 'REPORTED') {
        rows.push(compareRow(i18n, ca.value, ca.label, 'suppressed', metric, null, null));
      } else {
        rows.push(
          compareRow(
            i18n,
            ca.value,
            ca.label,
            'group',
            metric,
            groupFigure(i18n, ca.metrics, metric),
            groupFigure(i18n, cb.metrics, metric),
          ),
        );
      }
    }
    return { key: fa.key, label: fa.label, rows };
  });
}

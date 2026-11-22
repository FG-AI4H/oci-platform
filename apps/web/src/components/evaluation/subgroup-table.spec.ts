import type { SubgroupResults, TaskKindScores } from '@oci/shared-types';
import { describe, expect, it } from 'vitest';
import { compareTables, subgroupTable, subgroupTables } from './subgroup-table';

const classification = (accuracy: number): TaskKindScores => ({
  kind: 'CLASSIFICATION',
  metrics: {
    accuracy,
    balancedAccuracy: accuracy,
    macroF1: accuracy,
    microF1: accuracy,
    perClass: [
      { label: 0, precision: 1, recall: 1, f1: 1, support: 120 },
      { label: 1, precision: 1, recall: 1, f1: 1, support: 80 },
    ],
    coverage: 1,
  },
});

const byBand = (sixtyPlus: number): SubgroupResults => ({
  minCellSize: 11,
  fields: [
    {
      key: 'ageBand',
      label: 'Age band',
      cells: [
        {
          status: 'REPORTED',
          value: '18-39',
          label: '18 to 39',
          itemCount: 67,
          scoredCount: 67,
          metrics: {
            kind: 'CLASSIFICATION',
            accuracy: 0.97,
            balancedAccuracy: 0.97,
            macroF1: 0.97,
          },
        },
        { status: 'SUPPRESSED', value: '40-59', label: '40 to 59' },
        {
          status: 'REPORTED',
          value: '60+',
          label: '60 and over',
          itemCount: 67,
          scoredCount: 60,
          metrics: {
            kind: 'CLASSIFICATION',
            accuracy: sixtyPlus,
            balancedAccuracy: sixtyPlus,
            macroF1: sixtyPlus,
          },
        },
      ],
    },
  ],
});

describe('subgroupTable', () => {
  const table = subgroupTable(byBand(0.7313).fields[0]!, classification(0.9));

  it('leads with the whole set, then the groups in their declared order', () => {
    expect(table.rows.map((r) => [r.kind, r.label])).toEqual([
      ['overall', 'All scored items'],
      ['group', '18 to 39'],
      ['suppressed', '40 to 59'],
      ['group', '60 and over'],
    ]);
    expect(table.columns.map((c) => c.label)).toEqual([
      'Macro F1',
      'Accuracy',
      'Balanced accuracy',
    ]);
  });

  it('prints the figures as percentages and the counts the group rests on', () => {
    expect(table.rows[0]?.cells.map((c) => c.text)).toEqual(['90%', '90%', '90%']);
    expect(table.rows[0]?.items).toBe('200');
    expect(table.rows[3]?.cells[1]?.text).toBe('73.1%');
    expect(table.rows[3]?.items).toBe('60 of 67');
  });

  it('gives a withheld group no figure and no count', () => {
    expect(table.rows[2]).toEqual({
      key: '40-59',
      label: '40 to 59',
      kind: 'suppressed',
      cells: [],
      items: null,
    });
  });
});

describe('binary groups', () => {
  const p = (estimate: number, lower: number, upper: number) => ({
    estimate,
    lower,
    upper,
    numerator: 20,
    denominator: 25,
  });
  const scores: TaskKindScores = {
    kind: 'BINARY_DIAGNOSTIC',
    metrics: {
      truePositives: 40,
      falsePositives: 5,
      trueNegatives: 45,
      falseNegatives: 10,
      prevalence: p(0.5, 0.4, 0.6),
      sensitivity: p(0.8, 0.67, 0.89),
      specificity: p(0.9, 0.79, 0.96),
      positivePredictiveValue: p(0.89, 0.77, 0.95),
      negativePredictiveValue: p(0.82, 0.7, 0.9),
      accuracy: p(0.85, 0.77, 0.91),
      balancedAccuracy: 0.85,
      auc: null,
      coverage: 1,
    },
  };
  const results: SubgroupResults = {
    minCellSize: 11,
    fields: [
      {
        key: 'sex',
        label: 'Sex',
        cells: [
          {
            status: 'REPORTED',
            value: 'F',
            label: 'Female',
            itemCount: 50,
            scoredCount: 50,
            metrics: {
              kind: 'BINARY_DIAGNOSTIC',
              accuracy: p(0.86, 0.74, 0.93),
              prevalence: null,
              sensitivity: null,
              specificity: null,
              positivePredictiveValue: null,
              negativePredictiveValue: null,
              balancedAccuracy: null,
              auc: null,
              ratesWithheld: true,
            },
          },
        ],
      },
    ],
  };

  it('shows each rate with its interval, and a withheld rate as withheld, in words', () => {
    const [table] = subgroupTables(results, scores);
    expect(table?.columns.map((c) => c.key)).toEqual(['sensitivity', 'specificity', 'accuracy']);
    expect(table?.rows[0]?.cells[0]).toMatchObject({ text: '80%', interval: '67%–89%' });
    const group = table?.rows[1]?.cells ?? [];
    expect(group.map((c) => c.state)).toEqual(['withheld', 'withheld', 'value']);
    expect(group[0]?.spoken).toMatch(/^Withheld/);
    expect(group[2]).toMatchObject({ text: '86%', interval: '74%–93%' });
    expect(table?.rows[0]?.items).toBe('100');
  });
});

describe('compareTables', () => {
  const tables = compareTables(
    'accuracy',
    { scores: classification(0.9), subgroups: byBand(0.8955) },
    { scores: classification(0.9), subgroups: byBand(0.7313) },
  );

  it('puts the two results side by side and gives B minus A in percentage points', () => {
    const rows = tables[0]?.rows ?? [];
    expect(rows.map((r) => [r.label, r.a?.text ?? null, r.b?.text ?? null, r.difference])).toEqual([
      ['All scored items', '90%', '90%', '0 pts'],
      ['18 to 39', '97%', '97%', '0 pts'],
      ['40 to 59', null, null, null],
      ['60 and over', '89.6%', '73.1%', '-16.4 pts'],
    ]);
    expect(rows[3]?.differenceValue).toBeLessThan(0);
  });

  it('withholds a group withheld in either result', () => {
    const other = byBand(0.7313);
    other.fields[0]!.cells[0] = { status: 'SUPPRESSED', value: '18-39', label: '18 to 39' };
    const t = compareTables(
      'accuracy',
      { scores: classification(0.9), subgroups: byBand(0.8955) },
      { scores: classification(0.9), subgroups: other },
    );
    expect(t[0]?.rows[1]).toMatchObject({ kind: 'suppressed', a: null, b: null });
  });
});

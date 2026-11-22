/* eslint-disable security/detect-object-injection --
 * Test fixtures: arrays indexed by loop counters and records keyed by the
 * fixture's own item ids. */
import { SubgroupResultsSchema, type SubgroupField } from '@oci/shared-types';
import { describe, expect, it } from 'vitest';

import { scoreBinaryDiagnostic } from './scoring-binary-diagnostic.js';
import { scoreClassification } from './scoring-classification.js';
import { scoreSubmission } from './scoring.js';
import { scoreSubgroups, type SubgroupConfig } from './subgroup-scoring.js';

const N = 11;

const SEX: SubgroupField = {
  key: 'sex',
  label: 'Sex',
  values: [
    { value: 'F', label: 'Female' },
    { value: 'M', label: 'Male' },
  ],
};
const BAND: SubgroupField = {
  key: 'ageBand',
  label: 'Age band',
  values: [
    { value: '18-39', label: '18 to 39' },
    { value: '40-59', label: '40 to 59' },
    { value: '60+', label: '60 and over' },
  ],
};

/** Items `id000…`, with a field assignment chosen per index. */
function items(n: number, assign: (i: number) => Record<string, string>) {
  const ids = Array.from({ length: n }, (_, i) => `id${String(i).padStart(3, '0')}`);
  const values = Object.fromEntries(ids.map((id, i) => [id, assign(i)]));
  return { ids, values };
}

const pick = (rec: Record<string, number>, ids: string[]) =>
  Object.fromEntries(ids.filter((id) => id in rec).map((id) => [id, rec[id]!]));

describe('scoreSubgroups — no field declared', () => {
  it('returns null, so nothing is stored', () => {
    expect(
      scoreSubgroups({
        kind: 'CLASSIFICATION',
        groundTruth: { a: 0 },
        predictions: { a: 0 },
        config: { numClasses: 2 },
        subgroups: null,
        minCellSize: N,
      }),
    ).toBeNull();
  });
});

describe('scoreSubgroups — CLASSIFICATION', () => {
  // 120 items: 60 F, 60 M; age bands 40 / 40 / 40. The file is wrong on every
  // fourth 60+ item and right elsewhere.
  const { ids, values } = items(120, (i) => ({
    sex: i % 2 === 0 ? 'F' : 'M',
    ageBand: ['18-39', '40-59', '60+'][i % 3]!,
  }));
  const groundTruth = Object.fromEntries(ids.map((id, i) => [id, i % 5 === 0 ? 1 : 0]));
  const predictions = Object.fromEntries(
    ids.map((id, i) => {
      const wrong = values[id]?.ageBand === '60+' && i % 4 === 0;
      return [id, wrong ? 1 - groundTruth[id]! : groundTruth[id]!];
    }),
  );
  const config: SubgroupConfig = { fields: [SEX, BAND], values };
  const result = scoreSubgroups({
    kind: 'CLASSIFICATION',
    groundTruth,
    predictions,
    config: { numClasses: 2 },
    subgroups: config,
    minCellSize: N,
  });

  it('validates against the published schema', () => {
    expect(SubgroupResultsSchema.parse(result)).toEqual(result);
  });

  it('keeps the declared order of fields and values, with their labels', () => {
    expect(result?.fields.map((f) => [f.key, f.label, f.cells.map((c) => c.value)])).toEqual([
      ['sex', 'Sex', ['F', 'M']],
      ['ageBand', 'Age band', ['18-39', '40-59', '60+']],
    ]);
    expect(result?.minCellSize).toBe(N);
  });

  it('each group carries the classification scorer’s own figures on its items, and no per-class table', () => {
    const band = result?.fields[1];
    for (const cell of band?.cells ?? []) {
      expect(cell.status).toBe('REPORTED');
      if (cell.status !== 'REPORTED') continue;
      const groupIds = ids.filter((id) => values[id]?.ageBand === cell.value);
      const direct = scoreClassification({
        groundTruth: pick(groundTruth, groupIds),
        predictions: pick(predictions, groupIds),
        numClasses: 2,
      });
      expect(cell.metrics).toStrictEqual({
        kind: 'CLASSIFICATION',
        accuracy: direct.accuracy,
        balancedAccuracy: direct.balancedAccuracy,
        macroF1: direct.macroF1,
      });
      expect([cell.itemCount, cell.scoredCount]).toEqual([40, 40]);
    }
  });

  it('shows the drop in the one band where the file is wrong', () => {
    const accuracy = (result?.fields[1]?.cells ?? []).map((c) =>
      c.status === 'REPORTED' && c.metrics.kind === 'CLASSIFICATION' ? c.metrics.accuracy : null,
    );
    expect(accuracy.slice(0, 2)).toEqual([1, 1]);
    expect(accuracy[2]).toBeLessThan(0.8);
  });

  it('counts only the items the file labelled as scored', () => {
    const partial = { ...predictions };
    for (const id of ids.slice(0, 30)) delete partial[id];
    const r = scoreSubgroups({
      kind: 'CLASSIFICATION',
      groundTruth,
      predictions: partial,
      config: { numClasses: 2 },
      subgroups: config,
      minCellSize: N,
    });
    const f = r?.fields[0]?.cells[0];
    expect(f?.status === 'REPORTED' ? [f.itemCount, f.scoredCount] : null).toEqual([60, 45]);
  });
});

describe('scoreSubgroups — suppression', () => {
  // A site field with one small site: 4 items of 104.
  const SITE: SubgroupField = {
    key: 'site',
    label: 'Site',
    values: [
      { value: 'A', label: 'Site A' },
      { value: 'B', label: 'Site B' },
      { value: 'C', label: 'Site C' },
    ],
  };
  const { ids, values } = items(104, (i) => ({ site: i < 4 ? 'C' : i < 34 ? 'B' : 'A' }));
  const groundTruth = Object.fromEntries(ids.map((id, i) => [id, i % 3 === 0 ? 1 : 0]));
  const predictions = { ...groundTruth };
  const run = (minCellSize: number) =>
    scoreSubgroups({
      kind: 'CLASSIFICATION',
      groundTruth,
      predictions,
      config: { numClasses: 2 },
      subgroups: { fields: [SITE], values },
      minCellSize,
    });

  it('stores a withheld group with its value and label and nothing else', () => {
    const cells = run(N)?.fields[0]?.cells ?? [];
    expect(cells[2]).toStrictEqual({ status: 'SUPPRESSED', value: 'C', label: 'Site C' });
  });

  it('withholds the next smallest group too, so the small one is not total minus the rest', () => {
    const cells = run(N)?.fields[0]?.cells ?? [];
    expect(cells.map((c) => c.status)).toEqual(['REPORTED', 'SUPPRESSED', 'SUPPRESSED']);
    // What a reader can work out: the task's 104 items minus the published ones.
    const published = cells.reduce((s, c) => s + (c.status === 'REPORTED' ? c.itemCount : 0), 0);
    expect(104 - published).toBeGreaterThanOrEqual(N);
  });

  it('publishes every group when the threshold is low enough (the threshold is what decides)', () => {
    expect(run(4)?.fields[0]?.cells.map((c) => c.status)).toEqual([
      'REPORTED',
      'REPORTED',
      'REPORTED',
    ]);
    expect(run(4)?.minCellSize).toBe(4);
  });
});

describe('scoreSubgroups — BINARY_DIAGNOSTIC', () => {
  // 100 items: F / M alternate. F has 25 positives; M has only 5.
  const { ids, values } = items(100, (i) => ({ sex: i % 2 === 0 ? 'F' : 'M' }));
  const groundTruth = Object.fromEntries(
    ids.map((id, i) => [id, (i % 2 === 0 && i < 50) || (i % 2 === 1 && i < 10) ? 1 : 0]),
  );
  const predictions = Object.fromEntries(
    ids.map((id, i) => [id, i % 7 === 0 ? 1 - groundTruth[id]! : groundTruth[id]!]),
  );
  const itemScores = Object.fromEntries(ids.map((id) => [id, predictions[id] === 1 ? 0.8 : 0.2]));
  const result = scoreSubgroups({
    kind: 'BINARY_DIAGNOSTIC',
    groundTruth,
    predictions,
    itemScores,
    config: { numClasses: 2, referableThreshold: 1 },
    subgroups: { fields: [SEX], values },
    minCellSize: N,
  });

  it('validates against the published schema', () => {
    expect(SubgroupResultsSchema.parse(result)).toEqual(result);
  });

  it('withholds the rates of both groups when one has fewer than 11 positives, and keeps accuracy with its interval', () => {
    const [f, m] = result?.fields[0]?.cells ?? [];
    for (const cell of [f, m]) {
      expect(cell?.status).toBe('REPORTED');
      if (cell?.status !== 'REPORTED' || cell.metrics.kind !== 'BINARY_DIAGNOSTIC') continue;
      // M has 5 positives; F's 25 would give them as the total minus 25.
      expect(cell.metrics.ratesWithheld).toBe(true);
      expect(cell.metrics.sensitivity).toBeNull();
      expect(cell.metrics.prevalence).toBeNull();
      expect(cell.metrics.auc).toBeNull();
      const groupIds = ids.filter((id) => values[id]?.sex === cell.value);
      const direct = scoreBinaryDiagnostic({
        groundTruth: pick(groundTruth, groupIds),
        predictions: pick(predictions, groupIds),
      });
      expect(cell.metrics.accuracy).toStrictEqual(direct.accuracy);
    }
  });

  it('publishes the rates with their Wilson intervals when every denominator is 11 or more', () => {
    const balanced = Object.fromEntries(ids.map((id, i) => [id, i % 4 < 2 ? 1 : 0]));
    const preds = Object.fromEntries(
      ids.map((id, i) => [id, i % 9 === 0 ? 1 - balanced[id]! : balanced[id]!]),
    );
    const r = scoreSubgroups({
      kind: 'BINARY_DIAGNOSTIC',
      groundTruth: balanced,
      predictions: preds,
      itemScores: Object.fromEntries(ids.map((id) => [id, preds[id] === 1 ? 0.9 : 0.1])),
      config: { numClasses: 2, referableThreshold: 1 },
      subgroups: { fields: [SEX], values },
      minCellSize: N,
    });
    const f = r?.fields[0]?.cells[0];
    if (f?.status !== 'REPORTED' || f.metrics.kind !== 'BINARY_DIAGNOSTIC') {
      throw new Error('expected a reported binary group');
    }
    const groupIds = ids.filter((id) => values[id]?.sex === 'F');
    const direct = scoreBinaryDiagnostic({
      groundTruth: pick(balanced, groupIds),
      predictions: pick(preds, groupIds),
      itemScores: pick(
        Object.fromEntries(ids.map((id) => [id, preds[id] === 1 ? 0.9 : 0.1])),
        groupIds,
      ),
    });
    expect(f.metrics.ratesWithheld).toBe(false);
    expect(f.metrics.sensitivity).toStrictEqual(direct.sensitivity);
    expect(f.metrics.specificity).toStrictEqual(direct.specificity);
    expect(f.metrics.auc).toStrictEqual(direct.auc);
    // A group's interval is wider than the overall one: it rests on fewer items.
    const overall = scoreBinaryDiagnostic({ groundTruth: balanced, predictions: preds });
    const width = (p: { lower: number; upper: number } | null) => (p ? p.upper - p.lower : 0);
    expect(width(f.metrics.sensitivity)).toBeGreaterThan(width(overall.sensitivity));
  });
});

describe('scoreSubgroups — GRADING', () => {
  // 60 items, 30 per sex; F holds no referable item at all.
  const { ids, values } = items(60, (i) => ({ sex: i % 2 === 0 ? 'F' : 'M' }));
  const groundTruth = Object.fromEntries(
    ids.map((id, i) => [id, i % 2 === 0 ? i % 2 : 2 + (i % 3)]),
  );
  const predictions = { ...groundTruth };

  it('reports a referable rate whose denominator is empty as null, not 0', () => {
    const r = scoreSubgroups({
      kind: 'GRADING',
      groundTruth,
      predictions,
      config: { numClasses: 5, referableThreshold: 2 },
      subgroups: { fields: [SEX], values },
      minCellSize: N,
    });
    const f = r?.fields[0]?.cells[0];
    if (f?.status !== 'REPORTED' || f.metrics.kind !== 'GRADING') throw new Error('expected F');
    expect(f.metrics.referableSensitivity).toBeNull();
    expect(f.metrics.referableSpecificity).toBe(1);
    const direct = scoreSubmission({
      groundTruth: pick(
        groundTruth,
        ids.filter((id) => values[id]?.sex === 'F'),
      ),
      predictions: pick(
        predictions,
        ids.filter((id) => values[id]?.sex === 'F'),
      ),
      numClasses: 5,
      referableThreshold: 2,
    });
    expect([f.metrics.qwk, f.metrics.accuracy]).toEqual([direct.qwk, direct.accuracy]);
  });
});

import type { SubmissionValidationCheck, SubmissionValidationReport } from '@oci/shared-types';
import { describe, expect, it } from 'vitest';
import { buildFormatReport, MAX_LISTED_ITEM_IDS } from './format-report';
import { metricCells } from './metrics';

const TASK = {
  itemIds: ['img_a', 'img_b', 'img_c', 'img_d'],
  numClasses: 2,
  taskKind: 'CLASSIFICATION' as const,
};
const BINARY_TASK = { ...TASK, taskKind: 'BINARY_DIAGNOSTIC' as const };

function check(
  name: SubmissionValidationCheck['name'],
  ok: boolean,
  itemIds: string[] = [],
): SubmissionValidationCheck {
  return { name, ok, detail: `api detail for ${name}`, itemIds, itemIdCount: itemIds.length };
}

function report(
  checks: SubmissionValidationCheck[],
  recognised: number,
): SubmissionValidationReport {
  return {
    intent: 'VALIDATION',
    mode: 'PREDICTIONS',
    taskSlug: 'chest-xr',
    ok: checks.every((c) => c.ok),
    scores: null,
    submissionId: null,
    quotaConsumed: false,
    checks,
    itemIdSummary: { submitted: 0, recognised, unrecognised: 0, notPredicted: 0 },
  };
}

const row = (imageId: string, grade = 0) => ({ imageId, grade });

describe('buildFormatReport (#645)', () => {
  it('passes a clean file and lists the items it leaves out', () => {
    const view = buildFormatReport({
      report: report([check('PAYLOAD_SHAPE', true), check('DUPLICATE_ITEM_IDS', true)], 2),
      predictions: [row('img_a'), row('img_c')],
      task: TASK,
    });
    expect(view).toEqual({
      ok: true,
      rowCount: 2,
      taskItemCount: 4,
      recognised: 2,
      problems: [],
      missing: { itemIds: ['img_b', 'img_d'], count: 2 },
      scoreNote: null,
    });
  });

  it('names duplicate, unknown and out-of-range identifiers in the reader’s terms', () => {
    const view = buildFormatReport({
      report: report(
        [
          check('PAYLOAD_SHAPE', true),
          check('DUPLICATE_ITEM_IDS', false, ['img_a']),
          check('LABEL_RANGE', false, ['img_b']),
          check('ITEM_IDS_RECOGNISED', false, ['img_z']),
        ],
        2,
      ),
      predictions: [row('img_a'), row('img_a'), row('img_b', 7), row('img_z')],
      task: TASK,
    });

    expect(view.ok).toBe(false);
    expect(view.problems.map((p) => [p.key, p.itemIds])).toEqual([
      ['duplicates', ['img_a']],
      ['labels', ['img_b']],
      ['unknown', ['img_z']],
    ]);
    expect(view.problems[1]?.detail).toBe(
      'A label is a whole number from 0 to 1. These items have a different value.',
    );
    // The API's endpoint-facing wording is not what a spreadsheet user reads.
    expect(JSON.stringify(view.problems)).not.toContain('api detail');
  });

  it('says so when no identifier belongs to the task at all', () => {
    const view = buildFormatReport({
      report: report([check('ITEM_IDS_RECOGNISED', false, ['x', 'y'])], 0),
      predictions: [row('x'), row('y')],
      task: TASK,
    });
    expect(view.problems[0]?.detail).toMatch(/^None of the identifiers in the file belong/);
    expect(view.missing.count).toBe(4);
  });

  it('caps the missing list and still counts every missing item', () => {
    const itemIds = Array.from({ length: 50 }, (_, i) => `img_${String(i).padStart(2, '0')}`);
    const view = buildFormatReport({
      report: report([check('PAYLOAD_SHAPE', true)], 1),
      predictions: [row('img_00')],
      task: { itemIds, numClasses: 2, taskKind: 'CLASSIFICATION' },
    });
    expect(view.missing.itemIds).toHaveLength(MAX_LISTED_ITEM_IDS);
    expect(view.missing.count).toBe(49);
  });

  it('keeps the API’s verdict when a check it does not know fails', () => {
    const view = buildFormatReport({
      report: report([check('DISPATCH_AVAILABLE', false)], 1),
      predictions: [row('img_a')],
      task: TASK,
    });
    expect(view.ok).toBe(false);
    expect(view.problems).toEqual([
      {
        key: 'other',
        title: 'Check failed',
        detail: 'api detail for DISPATCH_AVAILABLE',
        itemIds: [],
        itemIdCount: 0,
      },
    ]);
  });
});

describe('metricCells (#645)', () => {
  it('leads a grading task with QWK and explains the referable split at its threshold', () => {
    const cells = metricCells(
      { taskKind: 'GRADING', referableThreshold: 1 },
      {
        kind: 'GRADING',
        metrics: {
          qwk: -0.25,
          accuracy: 0.6667,
          referableSensitivity: 0.5,
          referableSpecificity: 1,
          coverage: 0.75,
        },
      },
    );
    expect(cells.map((c) => [c.label, c.value])).toEqual([
      ['QWK', '-0.250'],
      ['Accuracy', '66.7%'],
      ['Referable sensitivity', '50%'],
      ['Referable specificity', '100%'],
      ['Coverage', '75%'],
    ]);
    expect(cells[2]?.explanation).toBe(
      'Of the items whose reference grade is 1 or more, the share this file also graded 1 or more.',
    );
  });

  it('leads a classification task with macro F1 and has no ordinal metric', () => {
    const cells = metricCells(
      { taskKind: 'CLASSIFICATION', referableThreshold: 1 },
      {
        kind: 'CLASSIFICATION',
        metrics: {
          accuracy: 0.75,
          balancedAccuracy: 0.6667,
          macroF1: 0.6,
          microF1: 0.75,
          perClass: [],
          coverage: 1,
        },
      },
    );
    expect(cells.map((c) => c.label)).toEqual([
      'Macro F1',
      'Balanced accuracy',
      'Accuracy',
      'Micro F1',
      'Coverage',
    ]);
    expect(cells[0]?.value).toBe('60%');
  });

  it('takes the cells from the task kind when there are no scores, with no values', () => {
    const cells = metricCells({ taskKind: 'CLASSIFICATION', referableThreshold: 1 }, null);
    expect(cells[0]?.label).toBe('Macro F1');
    expect(cells.every((c) => c.value === null)).toBe(true);
  });
});

describe('buildFormatReport — scores (#650)', () => {
  it('restates a refused score in the reader’s terms', () => {
    const view = buildFormatReport({
      report: report(
        [
          {
            name: 'PAYLOAD_SHAPE',
            ok: false,
            detail:
              '1 prediction row(s) carry a score. This task takes one label per item and no score; remove the score values.',
            itemIds: ['img_a'],
            itemIdCount: 1,
          },
        ],
        1,
      ),
      predictions: [{ imageId: 'img_a', grade: 1, score: 0.4 }],
      task: TASK,
    });
    expect(view.problems).toEqual([
      expect.objectContaining({
        key: 'scores',
        title: 'Scores this task does not take',
        itemIds: ['img_a'],
      }),
    ]);
    expect(view.scoreNote).toBeNull();
  });

  it.each([
    [
      [
        { imageId: 'img_a', grade: 1, score: 0.9 },
        { imageId: 'img_b', grade: 0, score: 0.2 },
        { imageId: 'img_zz', grade: 0 },
      ],
      'Every matched line has a score, so the result can include an AUC: it is reported when the scored items include both positive and negative cases.',
    ],
    [
      [row('img_a'), row('img_b')],
      'No line has a score, so the result will not include an AUC. That is allowed.',
    ],
    [
      [{ imageId: 'img_a', grade: 1, score: 0.9 }, row('img_b')],
      '1 matched line has no score, so the result will not include an AUC. That is allowed; add a score to every line to get one.',
    ],
  ])('says whether a binary result will include an AUC (%#)', (predictions, note) => {
    const view = buildFormatReport({
      report: report([check('PAYLOAD_SHAPE', true)], 2),
      predictions,
      task: BINARY_TASK,
    });
    expect(view.ok).toBe(true);
    expect(view.scoreNote).toBe(note);
  });
});

describe('buildFormatReport — no score note without a matched line (#650)', () => {
  it('says nothing about scores when no line belongs to the task', () => {
    const view = buildFormatReport({
      report: report([check('ITEM_IDS_RECOGNISED', false, ['zz'])], 0),
      predictions: [{ imageId: 'zz', grade: 1, score: 0.9 }],
      task: BINARY_TASK,
    });
    expect(view.scoreNote).toBeNull();
  });
});

describe('metricCells — binary finding (#650)', () => {
  const p = (
    numerator: number,
    denominator: number,
    estimate: number,
    lower: number,
    upper: number,
  ) => ({
    estimate,
    lower,
    upper,
    numerator,
    denominator,
  });
  const metrics = {
    truePositives: 40,
    falsePositives: 5,
    trueNegatives: 45,
    falseNegatives: 10,
    prevalence: p(50, 100, 0.5, 0.4038, 0.5962),
    sensitivity: p(40, 50, 0.8, 0.6696, 0.8876),
    specificity: p(45, 50, 0.9, 0.7864, 0.9565),
    positivePredictiveValue: p(40, 45, 0.8889, 0.765, 0.9516),
    negativePredictiveValue: p(45, 55, 0.8182, 0.6967, 0.8981),
    accuracy: p(85, 100, 0.85, 0.7672, 0.9069),
    balancedAccuracy: 0.85,
    auc: null,
    coverage: 1,
  };
  const task = {
    taskKind: 'BINARY_DIAGNOSTIC' as const,
    referableThreshold: 1,
    positiveClassName: 'Pneumothorax present',
  };

  it('names every metric in full, with its interval and what it rests on', () => {
    const cells = metricCells(task, { kind: 'BINARY_DIAGNOSTIC', metrics });
    expect(cells.map((c) => c.label)).toEqual([
      'Balanced accuracy',
      'Sensitivity',
      'Specificity',
      'Positive predictive value',
      'Negative predictive value',
      'Area under the ROC curve (AUC)',
      'Accuracy',
      'Prevalence',
      'Coverage',
    ]);
    const sensitivity = cells[1];
    expect(sensitivity?.value).toBe('80%');
    expect(sensitivity?.interval?.text).toBe('95% CI 67% to 88.8%');
    expect(sensitivity?.basis).toBe('40 of 50');
    expect(sensitivity?.explanation).toContain('Pneumothorax present');
  });

  it('says why AUC is missing on a scored submission, and leaves it blank on an unscored one', () => {
    const scored = metricCells(task, { kind: 'BINARY_DIAGNOSTIC', metrics });
    expect(scored.find((c) => c.key === 'auc')?.absent?.label).toBe('Not reported');
    const unscored = metricCells(task, null);
    expect(unscored.every((c) => c.value === null && !c.absent)).toBe(true);
  });

  it('formats AUC on a 0 to 1 scale, not as a percentage', () => {
    const cells = metricCells(task, {
      kind: 'BINARY_DIAGNOSTIC',
      metrics: {
        ...metrics,
        auc: { estimate: 0.875, lower: 0.5, upper: 1, resamples: 2000, seed: 650 },
      },
    });
    const auc = cells.find((c) => c.key === 'auc');
    expect(auc?.value).toBe('0.875');
    expect(auc?.interval?.text).toBe('95% CI 0.500 to 1.000');
  });

  it('keeps the task page row to the headline, the four rates and AUC', () => {
    expect(metricCells(task, null, 'row')).toHaveLength(6);
  });

  it('falls back to "Finding present" when the task names no positive class', () => {
    const cells = metricCells({ ...task, positiveClassName: null }, null);
    expect(cells[1]?.explanation).toContain('Finding present');
  });

  it('shows a not-estimable balanced accuracy in words, never as 0%', () => {
    const cells = metricCells(task, {
      kind: 'BINARY_DIAGNOSTIC',
      metrics: { ...metrics, specificity: null, balancedAccuracy: null },
    });
    expect(cells[0]?.value).toBeNull();
    expect(cells[0]?.absent?.label).toBe('Not estimable');
  });
});

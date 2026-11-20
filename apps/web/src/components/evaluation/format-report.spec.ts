import type { SubmissionValidationCheck, SubmissionValidationReport } from '@oci/shared-types';
import { describe, expect, it } from 'vitest';
import { buildFormatReport, MAX_LISTED_ITEM_IDS } from './format-report';
import { metricCells } from './metrics';

const TASK = { itemIds: ['img_a', 'img_b', 'img_c', 'img_d'], numClasses: 2 };

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
      task: { itemIds, numClasses: 2 },
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

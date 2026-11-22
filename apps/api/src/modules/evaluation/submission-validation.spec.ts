import { describe, expect, it } from 'vitest';
import { validatePredictionsInterface } from './submission-validation.js';

const TASK_ITEM_IDS = ['a', 'b', 'c'];

function checkOf(outcome: ReturnType<typeof validatePredictionsInterface>, name: string) {
  const found = outcome.checks.find((c) => c.name === name);
  if (!found) throw new Error(`no ${name} check`);
  return found;
}

describe('validatePredictionsInterface — the label range speaks the task kind (#650)', () => {
  const outOfRange = [
    { imageId: 'a', grade: 0 },
    { imageId: 'b', grade: 4 },
  ];

  it.each([
    ['GRADING', 'grade', 'Grades'],
    ['CLASSIFICATION', 'label', 'Labels'],
    ['BINARY_DIAGNOSTIC', 'label', 'Labels'],
  ] as const)('%s calls a value a %s', (taskKind, one, many) => {
    const outcome = validatePredictionsInterface({
      predictions: outOfRange,
      taskItemIds: TASK_ITEM_IDS,
      numClasses: 2,
      taskKind,
    });
    const range = checkOf(outcome, 'LABEL_RANGE');
    expect(range.ok).toBe(false);
    expect(range.detail).toBe(
      `1 prediction(s) carry a ${one} outside this task's range. ${many} must be integers in [0, 1] (numClasses = 2).`,
    );
    expect(range.itemIds).toEqual(['b']);
  });

  it('uses the same word when the range is respected', () => {
    const outcome = validatePredictionsInterface({
      predictions: [{ imageId: 'a', grade: 1 }],
      taskItemIds: TASK_ITEM_IDS,
      numClasses: 2,
      taskKind: 'CLASSIFICATION',
    });
    expect(checkOf(outcome, 'LABEL_RANGE').detail).toBe('Every label is an integer in [0, 1].');
  });
});

describe('validatePredictionsInterface — scores (#650)', () => {
  it.each(['GRADING', 'CLASSIFICATION'] as const)(
    'refuses a score on a %s task, naming the rows',
    (taskKind) => {
      const outcome = validatePredictionsInterface({
        predictions: [
          { imageId: 'a', grade: 1, score: 0.4 },
          { imageId: 'b', grade: 0 },
        ],
        taskItemIds: TASK_ITEM_IDS,
        numClasses: 2,
        taskKind,
      });
      const shape = checkOf(outcome, 'PAYLOAD_SHAPE');
      expect(outcome.ok).toBe(false);
      expect(shape.ok).toBe(false);
      expect(shape.detail).toContain('no score');
      expect(shape.itemIds).toEqual(['a']);
    },
  );

  it('accepts scores on a binary task and says the result can include an AUC', () => {
    const outcome = validatePredictionsInterface({
      predictions: [
        { imageId: 'a', grade: 1, score: 0.9 },
        { imageId: 'b', grade: 0, score: 0.1 },
        // Unknown to the task, so its missing score does not matter.
        { imageId: 'zz', grade: 0 },
      ],
      taskItemIds: TASK_ITEM_IDS,
      numClasses: 2,
      taskKind: 'BINARY_DIAGNOSTIC',
    });
    const shape = checkOf(outcome, 'PAYLOAD_SHAPE');
    expect(shape.ok).toBe(true);
    expect(shape.detail).toContain('can include an AUC');
  });

  it('warns, without failing, when some recognised rows have no score', () => {
    const outcome = validatePredictionsInterface({
      predictions: [
        { imageId: 'a', grade: 1, score: 0.9 },
        { imageId: 'b', grade: 0 },
      ],
      taskItemIds: TASK_ITEM_IDS,
      numClasses: 2,
      taskKind: 'BINARY_DIAGNOSTIC',
    });
    const shape = checkOf(outcome, 'PAYLOAD_SHAPE');
    expect(shape.ok).toBe(true);
    expect(outcome.ok).toBe(true);
    expect(shape.detail).toContain('1 recognised row(s) carry no score');
  });

  it('says plainly that labels alone give no AUC', () => {
    const outcome = validatePredictionsInterface({
      predictions: [{ imageId: 'a', grade: 1 }],
      taskItemIds: TASK_ITEM_IDS,
      numClasses: 2,
      taskKind: 'BINARY_DIAGNOSTIC',
    });
    expect(checkOf(outcome, 'PAYLOAD_SHAPE').detail).toContain('will not include an AUC');
  });
});

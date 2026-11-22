import { describe, expect, it } from 'vitest';
import { CreateEvaluationTaskRequestSchema, TaskKindScoresSchema } from './index.js';

describe('CreateEvaluationTaskRequestSchema — BINARY_DIAGNOSTIC (#650)', () => {
  const base = {
    slug: 'chest-finding',
    name: 'Chest X-ray finding',
    datasetSlug: 'chest-xr',
    groundTruth: { a: 1, b: 0 },
  };

  it('accepts a binary task that names its positive class', () => {
    const parsed = CreateEvaluationTaskRequestSchema.safeParse({
      ...base,
      taskKind: 'BINARY_DIAGNOSTIC',
      numClasses: 2,
      referableThreshold: 1,
      positiveClassName: '  Finding present ',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.positiveClassName).toBe('Finding present');
  });

  it('refuses a binary task without the positive class in words', () => {
    const parsed = CreateEvaluationTaskRequestSchema.safeParse({
      ...base,
      taskKind: 'BINARY_DIAGNOSTIC',
      numClasses: 2,
      referableThreshold: 1,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path.join('.'))).toContain('positiveClassName');
  });

  it('refuses a binary task with other than two classes', () => {
    const parsed = CreateEvaluationTaskRequestSchema.safeParse({
      ...base,
      taskKind: 'BINARY_DIAGNOSTIC',
      numClasses: 3,
      referableThreshold: 1,
      positiveClassName: 'Finding present',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path.join('.'))).toContain('numClasses');
  });

  it('refuses a positive class on a kind it does not apply to', () => {
    const parsed = CreateEvaluationTaskRequestSchema.safeParse({
      ...base,
      taskKind: 'CLASSIFICATION',
      numClasses: 2,
      referableThreshold: 1,
      positiveClassName: 'Finding present',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('TaskKindScoresSchema — BINARY_DIAGNOSTIC (#650)', () => {
  const proportion = {
    estimate: 0.8,
    lower: 0.6696,
    upper: 0.8876,
    numerator: 40,
    denominator: 50,
  };
  const metrics = {
    truePositives: 40,
    falsePositives: 5,
    trueNegatives: 45,
    falseNegatives: 10,
    prevalence: proportion,
    sensitivity: proportion,
    specificity: proportion,
    positivePredictiveValue: proportion,
    negativePredictiveValue: null,
    accuracy: proportion,
    balancedAccuracy: 0.85,
    auc: null,
    coverage: 1,
  };

  it('accepts the envelope, with a not-estimable rate and no AUC', () => {
    expect(TaskKindScoresSchema.safeParse({ kind: 'BINARY_DIAGNOSTIC', metrics }).success).toBe(
      true,
    );
  });

  it('refuses a proportion with a zero denominator: that is null, not a number', () => {
    const bad = { ...metrics, sensitivity: { ...proportion, denominator: 0 } };
    expect(
      TaskKindScoresSchema.safeParse({ kind: 'BINARY_DIAGNOSTIC', metrics: bad }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { ScoringError } from './scoring.js';
import { scoreClassification } from './scoring-classification.js';

// Float assertions use toBeCloseTo(expected, 4): every value below is hand-
// computed to ≤ 4 decimals and the implementation rounds to 4 decimals.
//
// Macro averages are taken over the UNROUNDED per-class values, so the
// expected macro figures are derived from exact fractions rather than from the
// rounded per-class numbers asserted alongside them.

describe('scoreClassification — mixed confusions (case 1)', () => {
  // N=3, six items, two per class.
  //   GT   a:0 b:0 c:1 d:1 e:2 f:2
  //   Pred a:0 b:1 c:1 d:1 e:2 f:0
  //
  // Confusion (rows = true, cols = pred):
  //   true0 -> [1, 1, 0]     (a correct, b -> 1)
  //   true1 -> [0, 2, 0]     (c, d correct)
  //   true2 -> [1, 0, 1]     (f -> 0, e correct)
  const groundTruth = { a: 0, b: 0, c: 1, d: 1, e: 2, f: 2 };
  const predictions = { a: 0, b: 1, c: 1, d: 1, e: 2, f: 0 };

  it('accuracy = 4/6 and microF1 equals it', () => {
    const s = scoreClassification({ groundTruth, predictions, numClasses: 3 });
    // Correct: a, c, d, e => 4/6.
    expect(s.accuracy).toBeCloseTo(0.6667, 4);
    // Single-label => sum(FP) = sum(FN) = 2, so micro P = micro R = 4/6 = F1.
    expect(s.microF1).toBeCloseTo(0.6667, 4);
    expect(s.coverage).toBeCloseTo(1, 4);
  });

  it('per-class precision / recall / F1 / support', () => {
    const s = scoreClassification({ groundTruth, predictions, numClasses: 3 });
    expect(s.perClass).toHaveLength(3);

    // class 0: TP=1 (a), FP=1 (f predicted 0), FN=1 (b) => P=1/2, R=1/2, F1=1/2
    expect(s.perClass[0]).toMatchObject({ label: 0, support: 2 });
    expect(s.perClass[0]!.precision).toBeCloseTo(0.5, 4);
    expect(s.perClass[0]!.recall).toBeCloseTo(0.5, 4);
    expect(s.perClass[0]!.f1).toBeCloseTo(0.5, 4);

    // class 1: TP=2 (c,d), FP=1 (b predicted 1), FN=0 => P=2/3, R=1,
    //          F1 = 2*(2/3)*1 / (2/3 + 1) = (4/3)/(5/3) = 4/5
    expect(s.perClass[1]!.precision).toBeCloseTo(0.6667, 4);
    expect(s.perClass[1]!.recall).toBeCloseTo(1, 4);
    expect(s.perClass[1]!.f1).toBeCloseTo(0.8, 4);
    expect(s.perClass[1]!.support).toBe(2);

    // class 2: TP=1 (e), FP=0, FN=1 (f) => P=1, R=1/2, F1 = 2*1*0.5/1.5 = 2/3
    expect(s.perClass[2]!.precision).toBeCloseTo(1, 4);
    expect(s.perClass[2]!.recall).toBeCloseTo(0.5, 4);
    expect(s.perClass[2]!.f1).toBeCloseTo(0.6667, 4);
    expect(s.perClass[2]!.support).toBe(2);
  });

  it('macro averages use unrounded per-class values', () => {
    const s = scoreClassification({ groundTruth, predictions, numClasses: 3 });
    // balancedAccuracy = mean recall = (1/2 + 1 + 1/2) / 3 = 2/3
    expect(s.balancedAccuracy).toBeCloseTo(0.6667, 4);
    // macroF1 = (1/2 + 4/5 + 2/3) / 3 = (59/30)/3 = 59/90 = 0.65555...
    expect(s.macroF1).toBeCloseTo(0.6556, 4);
  });
});

describe('scoreClassification — imbalance (case 2)', () => {
  // The case that justifies reporting balancedAccuracy at all: a model that
  // never predicts the minority class still scores 0.8 accuracy.
  const groundTruth: Record<string, number> = {};
  const predictions: Record<string, number> = {};
  for (let i = 0; i < 8; i++) {
    groundTruth[`maj${i}`] = 0;
    predictions[`maj${i}`] = 0;
  }
  for (let i = 0; i < 2; i++) {
    groundTruth[`min${i}`] = 1;
    predictions[`min${i}`] = 0;
  }

  it('accuracy 0.8 but balancedAccuracy 0.5 and macroF1 0.4444', () => {
    const s = scoreClassification({ groundTruth, predictions, numClasses: 2 });
    expect(s.accuracy).toBeCloseTo(0.8, 4);
    // class 0: TP=8, FP=2, FN=0 => P=0.8, R=1, F1 = 2*0.8*1/1.8 = 8/9
    // class 1: TP=0, FP=0, FN=2 => P=0, R=0, F1=0
    expect(s.perClass[0]!.f1).toBeCloseTo(0.8889, 4);
    expect(s.perClass[1]!.f1).toBeCloseTo(0, 4);
    // balancedAccuracy = (1 + 0)/2 = 0.5 — well below accuracy.
    expect(s.balancedAccuracy).toBeCloseTo(0.5, 4);
    // macroF1 = (8/9 + 0)/2 = 4/9
    expect(s.macroF1).toBeCloseTo(0.4444, 4);
    // micro still equals accuracy.
    expect(s.microF1).toBeCloseTo(0.8, 4);
  });
});

describe('scoreClassification — partial coverage and zero-support classes (case 3)', () => {
  // GT has 4 items across 3 classes; the submission predicts only 2 of them.
  const groundTruth = { a: 0, b: 1, c: 1, d: 2 };
  const predictions = { a: 0, c: 1 };

  it('coverage = 2/4 and metrics are computed over the matched set only', () => {
    const s = scoreClassification({ groundTruth, predictions, numClasses: 3 });
    expect(s.coverage).toBeCloseTo(0.5, 4);
    // Matched = {a, c}, both correct.
    expect(s.accuracy).toBeCloseTo(1, 4);
  });

  it('excludes zero-support classes from macro averages', () => {
    const s = scoreClassification({ groundTruth, predictions, numClasses: 3 });
    // class 2 has no matched ground-truth item.
    expect(s.perClass[2]!.support).toBe(0);
    expect(s.perClass[2]!.recall).toBeCloseTo(0, 4);
    // Averaging over supported classes {0, 1} only => both are 1. Including
    // class 2 would give 2/3 and penalise the submission for a class the
    // host's evaluation split does not contain.
    expect(s.balancedAccuracy).toBeCloseTo(1, 4);
    expect(s.macroF1).toBeCloseTo(1, 4);
  });
});

describe('scoreClassification — empty ground truth', () => {
  it('returns zeroed metrics rather than NaN', () => {
    const s = scoreClassification({ groundTruth: {}, predictions: {}, numClasses: 3 });
    expect(s.accuracy).toBe(0);
    expect(s.balancedAccuracy).toBe(0);
    expect(s.macroF1).toBe(0);
    expect(s.microF1).toBe(0);
    expect(s.coverage).toBe(0);
  });
});

describe('scoreClassification — rejects malformed labels', () => {
  it('throws ScoringError on a prediction label >= numClasses', () => {
    expect(() =>
      scoreClassification({ groundTruth: { a: 0 }, predictions: { a: 3 }, numClasses: 3 }),
    ).toThrow(ScoringError);
  });

  it('throws ScoringError on a negative prediction label', () => {
    expect(() =>
      scoreClassification({ groundTruth: { a: 0 }, predictions: { a: -1 }, numClasses: 3 }),
    ).toThrow(ScoringError);
  });

  it('throws ScoringError on a non-integer prediction label', () => {
    expect(() =>
      scoreClassification({ groundTruth: { a: 0 }, predictions: { a: 1.5 }, numClasses: 3 }),
    ).toThrow(ScoringError);
  });

  it('throws ScoringError on an out-of-range ground-truth label', () => {
    expect(() =>
      scoreClassification({ groundTruth: { a: 9 }, predictions: { a: 0 }, numClasses: 3 }),
    ).toThrow(ScoringError);
  });

  it('throws ScoringError on numClasses < 2', () => {
    expect(() =>
      scoreClassification({ groundTruth: { a: 0 }, predictions: { a: 0 }, numClasses: 1 }),
    ).toThrow(ScoringError);
  });
});

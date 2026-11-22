/* eslint-disable security/detect-object-injection --
 * Test fixtures: every computed key is an item id generated in this file or a
 * literal metric name from the `it.each` table, never outside input. */
import { describe, expect, it } from 'vitest';
import { ScoringError } from './scoring.js';
import {
  AUC_BOOTSTRAP_RESAMPLES,
  AUC_BOOTSTRAP_SEED,
  aucResamplesFor,
  aucWithBootstrap,
  scoreBinaryDiagnostic,
  wilsonInterval,
} from './scoring-binary-diagnostic.js';

/**
 * Build a ground truth and a predictions map with the given confusion counts.
 * Item ids are zero-padded so their sort order is their creation order.
 */
function fromCounts(c: { tp: number; fn: number; fp: number; tn: number }) {
  const groundTruth: Record<string, number> = {};
  const predictions: Record<string, number> = {};
  let i = 0;
  const add = (truth: number, predicted: number, n: number) => {
    for (let k = 0; k < n; k++) {
      const id = `item-${String(i++).padStart(4, '0')}`;
      groundTruth[id] = truth;
      predictions[id] = predicted;
    }
  };
  add(1, 1, c.tp);
  add(1, 0, c.fn);
  add(0, 1, c.fp);
  add(0, 0, c.tn);
  return { groundTruth, predictions };
}

describe('wilsonInterval — against published values', () => {
  // Newcombe RG (1998), "Two-sided confidence intervals for the single
  // proportion: comparison of seven methods", Stat Med 17:857-872, Table II,
  // method 3 (Wilson score, no continuity correction). Four of his worked
  // examples, which cover an interior proportion, a small one, zero and one.
  it.each([
    [81, 263, 0.2553, 0.3662],
    [15, 148, 0.0624, 0.1605],
    [0, 20, 0, 0.1611],
    [1, 29, 0.0061, 0.1718],
  ])('%i / %i → [%f, %f]', (x, n, lower, upper) => {
    const ci = wilsonInterval(x, n);
    expect(ci.lower).toBeCloseTo(lower, 4);
    expect(ci.upper).toBeCloseTo(upper, 4);
  });

  it('is exactly 0 at no successes and exactly 1 at all successes', () => {
    expect(wilsonInterval(0, 7).lower).toBe(0);
    expect(wilsonInterval(7, 7).upper).toBe(1);
  });

  it('stays inside [0, 1] and around the estimate for every count up to 60', () => {
    for (let n = 1; n <= 60; n++) {
      for (let x = 0; x <= n; x++) {
        const { lower, upper } = wilsonInterval(x, n);
        expect(lower).toBeGreaterThanOrEqual(0);
        expect(upper).toBeLessThanOrEqual(1);
        expect(lower).toBeLessThanOrEqual(x / n + 1e-12);
        expect(upper).toBeGreaterThanOrEqual(x / n - 1e-12);
      }
    }
  });

  it('refuses a count that is not a proportion', () => {
    expect(() => wilsonInterval(3, 0)).toThrow(RangeError);
    expect(() => wilsonInterval(4, 3)).toThrow(RangeError);
    expect(() => wilsonInterval(-1, 3)).toThrow(RangeError);
  });
});

describe('scoreBinaryDiagnostic — worked example with known counts and intervals', () => {
  // 100 scored items: 50 with the finding, 50 without. The model flags 40 of
  // the 50 positives and 5 of the 50 negatives. Interval bounds checked
  // independently with the closed-form Wilson formula (z = 1.959963984540054)
  // and rounded to 4 decimals.
  const { groundTruth, predictions } = fromCounts({ tp: 40, fn: 10, fp: 5, tn: 45 });
  const s = scoreBinaryDiagnostic({ groundTruth, predictions });

  it('counts the four cells', () => {
    expect(s).toMatchObject({
      truePositives: 40,
      falseNegatives: 10,
      falsePositives: 5,
      trueNegatives: 45,
    });
  });

  it.each([
    ['sensitivity', 40, 50, 0.8, 0.6696, 0.8876],
    ['specificity', 45, 50, 0.9, 0.7864, 0.9565],
    ['positivePredictiveValue', 40, 45, 0.8889, 0.765, 0.9516],
    ['negativePredictiveValue', 45, 55, 0.8182, 0.6967, 0.8981],
    ['accuracy', 85, 100, 0.85, 0.7672, 0.9069],
    ['prevalence', 50, 100, 0.5, 0.4038, 0.5962],
  ] as const)('%s = %i/%i = %f [%f, %f]', (key, num, den, estimate, lower, upper) => {
    expect(s[key]).toStrictEqual({ estimate, lower, upper, numerator: num, denominator: den });
  });

  it('orders by balanced accuracy, the mean of sensitivity and specificity', () => {
    expect(s.balancedAccuracy).toBe(0.85);
  });

  it('reports full coverage and no AUC when no score was sent', () => {
    expect(s.coverage).toBe(1);
    expect(s.auc).toBeNull();
  });
});

describe('scoreBinaryDiagnostic — positive class handling', () => {
  /** Swap 0 and 1 everywhere: the finding becomes its absence. */
  const invert = (rec: Record<string, number>) =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, 1 - v]));

  // A property test without a property-testing dependency: a fixed sweep of
  // confusion tables, including empty cells, run both ways round.
  const tables: { tp: number; fn: number; fp: number; tn: number }[] = [];
  for (const tp of [0, 1, 7, 30]) {
    for (const fn of [0, 2, 11]) {
      for (const fp of [0, 3, 13]) {
        for (const tn of [0, 1, 25]) tables.push({ tp, fn, fp, tn });
      }
    }
  }

  it.each(tables)(
    'inverting the labels swaps sensitivity/specificity and PPV/NPV (%o)',
    (counts) => {
      const { groundTruth, predictions } = fromCounts(counts);
      if (Object.keys(groundTruth).length === 0) return;
      const a = scoreBinaryDiagnostic({ groundTruth, predictions });
      const b = scoreBinaryDiagnostic({
        groundTruth: invert(groundTruth),
        predictions: invert(predictions),
      });
      expect(b.sensitivity).toStrictEqual(a.specificity);
      expect(b.specificity).toStrictEqual(a.sensitivity);
      expect(b.positivePredictiveValue).toStrictEqual(a.negativePredictiveValue);
      expect(b.negativePredictiveValue).toStrictEqual(a.positivePredictiveValue);
      expect(b.truePositives).toBe(a.trueNegatives);
      expect(b.falsePositives).toBe(a.falseNegatives);
      expect(b.accuracy).toStrictEqual(a.accuracy);
      expect(b.balancedAccuracy).toBe(a.balancedAccuracy);
      // Prevalence becomes its complement, and so does its interval.
      if (a.prevalence && b.prevalence) {
        expect(b.prevalence.numerator).toBe(a.prevalence.denominator - a.prevalence.numerator);
        expect(b.prevalence.lower).toBeCloseTo(1 - a.prevalence.upper, 4);
      }
    },
  );

  it('flagging everything gives sensitivity 100% and specificity 0%, not the reverse', () => {
    const s = scoreBinaryDiagnostic({
      groundTruth: { a: 1, b: 1, c: 0, d: 0, e: 0 },
      predictions: { a: 1, b: 1, c: 1, d: 1, e: 1 },
    });
    expect(s.sensitivity?.estimate).toBe(1);
    expect(s.specificity?.estimate).toBe(0);
    expect(s.positivePredictiveValue?.estimate).toBe(0.4);
    expect(s.negativePredictiveValue).toBeNull();
  });

  it('reports a rate with no denominator as not estimable, not as 0', () => {
    // No reference positive among the scored items.
    const s = scoreBinaryDiagnostic({
      groundTruth: { a: 0, b: 0 },
      predictions: { a: 0, b: 1 },
    });
    expect(s.sensitivity).toBeNull();
    expect(s.specificity?.estimate).toBe(0.5);
    // Balanced accuracy needs both rates: not estimable either, rather than a
    // headline 0% that would rank this file below one that is wrong throughout.
    expect(s.balancedAccuracy).toBeNull();
  });

  it('refuses a label other than 0 or 1, in the predictions or the ground truth', () => {
    expect(() => scoreBinaryDiagnostic({ groundTruth: { a: 1 }, predictions: { a: 2 } })).toThrow(
      ScoringError,
    );
    expect(() => scoreBinaryDiagnostic({ groundTruth: { a: 3 }, predictions: { a: 1 } })).toThrow(
      /ground-truth label/,
    );
  });

  it('scores the intersection and reports coverage', () => {
    const s = scoreBinaryDiagnostic({
      groundTruth: { a: 1, b: 0, c: 1, d: 0 },
      predictions: { a: 1, b: 0, zz: 1 },
    });
    expect(s.coverage).toBe(0.5);
    expect(s.truePositives + s.trueNegatives + s.falsePositives + s.falseNegatives).toBe(2);
  });
});

describe('scoreBinaryDiagnostic — scores and AUC', () => {
  // Three positives scored 0.9, 0.8, 0.4 and four negatives scored 0.7, 0.4,
  // 0.3, 0.2. Of the 12 positive-negative pairs, the positive ranks higher in
  // 10 and ties in 1 (0.4 vs 0.4): AUC = (10 + 0.5) / 12 = 0.875.
  const groundTruth = { p1: 1, p2: 1, p3: 1, n1: 0, n2: 0, n3: 0, n4: 0 };
  const predictions = { p1: 1, p2: 1, p3: 0, n1: 1, n2: 0, n3: 0, n4: 0 };
  const itemScores = { p1: 0.9, p2: 0.8, p3: 0.4, n1: 0.7, n2: 0.4, n3: 0.3, n4: 0.2 };

  it('computes the Mann-Whitney AUC, ties counting one half', () => {
    const s = scoreBinaryDiagnostic({ groundTruth, predictions, itemScores });
    expect(s.auc?.estimate).toBe(0.875);
    expect(s.auc?.resamples).toBe(AUC_BOOTSTRAP_RESAMPLES);
    expect(s.auc?.seed).toBe(AUC_BOOTSTRAP_SEED);
    expect(AUC_BOOTSTRAP_RESAMPLES).toBe(2000);
  });

  it('gives an interval that contains the estimate and is the same on every run', () => {
    const a = scoreBinaryDiagnostic({ groundTruth, predictions, itemScores }).auc;
    const b = scoreBinaryDiagnostic({ groundTruth, predictions, itemScores }).auc;
    expect(a).not.toBeNull();
    expect(b).toStrictEqual(a);
    expect(a!.lower).toBeLessThanOrEqual(a!.estimate);
    expect(a!.upper).toBeGreaterThanOrEqual(a!.estimate);
    expect(a!.lower).toBeGreaterThanOrEqual(0);
    expect(a!.upper).toBeLessThanOrEqual(1);
  });

  it('does not depend on the order the items arrive in', () => {
    const reversed = Object.fromEntries(Object.entries(itemScores).reverse());
    expect(scoreBinaryDiagnostic({ groundTruth, predictions, itemScores: reversed }).auc).toEqual(
      scoreBinaryDiagnostic({ groundTruth, predictions, itemScores }).auc,
    );
  });

  it('pins the interval for this example, so a change of seed or method is visible', () => {
    // Regression pin, not an independent check: recorded from this
    // implementation. If it moves, published AUC intervals move with it.
    const auc = scoreBinaryDiagnostic({ groundTruth, predictions, itemScores }).auc;
    expect(auc).toStrictEqual({
      estimate: 0.875,
      // Seven items: the interval is wide, as it should be.
      lower: 0.5,
      upper: 1,
      resamples: 2000,
      seed: 650,
    });
  });

  it('keeps 2,000 resamples up to 10,000 items, then shrinks within a budget, never below 200', () => {
    expect(aucResamplesFor(7)).toBe(2000);
    expect(aucResamplesFor(10_000)).toBe(2000);
    expect(aucResamplesFor(20_000)).toBe(1000);
    expect(aucResamplesFor(100_000)).toBe(200);
    expect(aucResamplesFor(1_000_000)).toBe(200);
  });

  it('a perfect ranking has AUC 1 with the interval [1, 1]', () => {
    const auc = aucWithBootstrap([0.1, 0.2, 0.8, 0.9], [false, false, true, true]);
    expect(auc).toStrictEqual({ estimate: 1, lower: 1, upper: 1, resamples: 2000, seed: 650 });
  });

  it('is close to the Hanley-McNeil normal interval on a larger example', () => {
    // 200 items, scores that separate the classes imperfectly. The bootstrap
    // and the Hanley & McNeil (1982) standard error answer the same question
    // by different routes; they should agree to within a couple of points.
    const scores: number[] = [];
    const positive: boolean[] = [];
    for (let k = 0; k < 200; k++) {
      const isPos = k % 2 === 0;
      positive.push(isPos);
      // Deterministic spread: positives centred higher than negatives.
      scores.push(Math.min(1, Math.max(0, (isPos ? 0.62 : 0.4) + (((k * 37) % 41) - 20) / 60)));
    }
    const auc = aucWithBootstrap(scores, positive)!;
    const a = auc.estimate;
    const nPos = 100;
    const nNeg = 100;
    const q1 = a / (2 - a);
    const q2 = (2 * a * a) / (1 + a);
    const se = Math.sqrt(
      (a * (1 - a) + (nPos - 1) * (q1 - a * a) + (nNeg - 1) * (q2 - a * a)) / (nPos * nNeg),
    );
    expect(auc.lower).toBeCloseTo(a - 1.96 * se, 1);
    expect(auc.upper).toBeCloseTo(a + 1.96 * se, 1);
  });

  it('reports no AUC when one scored item has no score', () => {
    const { p3: _dropped, ...partial } = itemScores;
    const s = scoreBinaryDiagnostic({ groundTruth, predictions, itemScores: partial });
    expect(s.auc).toBeNull();
    // The rest of the result is unchanged by the missing score.
    expect(s.sensitivity).toStrictEqual(
      scoreBinaryDiagnostic({ groundTruth, predictions, itemScores }).sensitivity,
    );
  });

  it('ignores a missing score on an item that is not scored (not in the ground truth)', () => {
    const s = scoreBinaryDiagnostic({
      groundTruth,
      predictions: { ...predictions, extra: 1 },
      itemScores,
    });
    expect(s.auc?.estimate).toBe(0.875);
  });

  it('reports no AUC when the scored items hold only one class', () => {
    const s = scoreBinaryDiagnostic({
      groundTruth: { a: 1, b: 1 },
      predictions: { a: 1, b: 0 },
      itemScores: { a: 0.9, b: 0.1 },
    });
    expect(s.auc).toBeNull();
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a score of %f, outside 0 to 1',
    (bad) => {
      expect(() =>
        scoreBinaryDiagnostic({
          groundTruth: { a: 1, b: 0 },
          predictions: { a: 1, b: 0 },
          itemScores: { a: bad, b: 0.2 },
        }),
      ).toThrow(/expected a number from 0 to 1/);
    },
  );

  it('accepts the bounds 0 and 1 themselves', () => {
    const s = scoreBinaryDiagnostic({
      groundTruth: { a: 1, b: 0 },
      predictions: { a: 1, b: 0 },
      itemScores: { a: 1, b: 0 },
    });
    expect(s.auc?.estimate).toBe(1);
  });

  it('refuses a score for an item that has no label', () => {
    expect(() =>
      scoreBinaryDiagnostic({
        groundTruth: { a: 1 },
        predictions: { a: 1 },
        itemScores: { a: 0.5, b: 0.5 },
      }),
    ).toThrow(/has no label/);
  });
});

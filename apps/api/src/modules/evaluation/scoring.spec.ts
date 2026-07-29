import { describe, expect, it } from 'vitest';
import { quadraticWeightedKappa, scoreSubmission, ScoringError } from './scoring.js';

// Float assertions use toBeCloseTo(expected, 4): the values are hand-
// computed to ≤ 4 decimals and the implementation rounds to 4 decimals.

describe('scoreSubmission — perfect predictions (case 1)', () => {
  it('qwk=1, accuracy=1, sens=1, spec=1, coverage=1 over a small set (N=5, T=2)', () => {
    // Ground truth uses every class 0..4 exactly once; predictions match.
    const groundTruth = { a: 0, b: 1, c: 2, d: 3, e: 4 };
    const predictions = { a: 0, b: 1, c: 2, d: 3, e: 4 };

    const s = scoreSubmission({ groundTruth, predictions, numClasses: 5, referableThreshold: 2 });

    // QWK: observed mass sits on the diagonal ⇒ Σ w·O = 0 (w[i][i]=0),
    // and Σ w·E > 0, so kappa = 1 - 0 = 1.
    expect(s.qwk).toBeCloseTo(1, 4);
    expect(s.accuracy).toBeCloseTo(1, 4);
    // Referable (T=2): pos = {c,d,e} all predicted ≥2 ⇒ sens=3/3=1.
    //                  neg = {a,b} all predicted <2 ⇒ spec=2/2=1.
    expect(s.referableSensitivity).toBeCloseTo(1, 4);
    expect(s.referableSpecificity).toBeCloseTo(1, 4);
    expect(s.coverage).toBeCloseTo(1, 4);
  });
});

describe('scoreSubmission — off-by-one cyclic mislabel (case 2)', () => {
  it('has a hand-computed qwk of -0.5 (N=3, T=2, full coverage)', () => {
    // true = [0,1,2], pred = [1,2,0]  (each prediction wrong).
    const groundTruth = { x0: 0, x1: 1, x2: 2 };
    const predictions = { x0: 1, x1: 2, x2: 0 };

    // ---- hand arithmetic (N=3 ⇒ (N-1)^2 = 4) ----
    // Observed pairs: (0,1),(1,2),(2,0).
    //   w[0][1] = (0-1)^2/4 = 0.25
    //   w[1][2] = (1-2)^2/4 = 0.25
    //   w[2][0] = (2-0)^2/4 = 1.00
    //   Σ w·O = 0.25 + 0.25 + 1.00 = 1.5
    // Marginals: histTrue = [1,1,1], histPred = [1,1,1], n = 3
    //   ⇒ E[i][j] = 1/3 for all i,j
    //   Σ w over the full 3x3 grid = 1.25 + 0.5 + 1.25 = 3.0
    //   Σ w·E = (1/3) * 3.0 = 1.0
    // kappa = 1 - 1.5/1.0 = -0.5
    const s = scoreSubmission({ groundTruth, predictions, numClasses: 3, referableThreshold: 2 });

    expect(s.qwk).toBeCloseTo(-0.5, 4);
    expect(s.accuracy).toBeCloseTo(0, 4); // zero exact matches
    expect(s.coverage).toBeCloseTo(1, 4);
    // Referable (T=2, N=3): pos = {x2 (true 2)} ⇒ pred 0 <2 ⇒ TP=0 ⇒ sens=0/1=0.
    //   neg = {x0 (0), x1 (1)}: pred x0=1(<2) TN, pred x1=2(≥2) not TN ⇒ TN=1 ⇒ spec=1/2=0.5.
    expect(s.referableSensitivity).toBeCloseTo(0, 4);
    expect(s.referableSpecificity).toBeCloseTo(0.5, 4);
  });

  it('quadraticWeightedKappa matches the same -0.5 directly', () => {
    expect(quadraticWeightedKappa([0, 1, 2], [1, 2, 0], 3)).toBeCloseTo(-0.5, 4);
  });
});

describe('scoreSubmission — partial coverage (case 3)', () => {
  it('coverage < 1 and metrics computed over the intersection only', () => {
    // GT has 5 images; the submission predicts only 3 of them (correctly)
    // plus one image NOT in the GT set (must be ignored entirely).
    const groundTruth = { i0: 0, i1: 1, i2: 2, i3: 3, i4: 4 };
    const predictions = { i0: 0, i2: 2, i4: 4, extra: 1 };

    const s = scoreSubmission({ groundTruth, predictions, numClasses: 5, referableThreshold: 2 });

    // matched = {i0,i2,i4} ⇒ coverage = 3/5 = 0.6. `extra` is not in GT.
    expect(s.coverage).toBeCloseTo(0.6, 4);
    // Over the intersection the 3 predictions are all exact ⇒ accuracy=1, qwk=1.
    expect(s.accuracy).toBeCloseTo(1, 4);
    expect(s.qwk).toBeCloseTo(1, 4);
    // Referable (T=2): pos={i2,i4} both predicted ≥2 ⇒ sens=1; neg={i0} predicted <2 ⇒ spec=1.
    expect(s.referableSensitivity).toBeCloseTo(1, 4);
    expect(s.referableSpecificity).toBeCloseTo(1, 4);
  });
});

describe('scoreSubmission — referable edge: no referable ground truth (case 4)', () => {
  it('sensitivity is 0 when pos=0, and specificity is still defined (N=5, T=2)', () => {
    // All ground-truth labels < T ⇒ pos = 0.
    const groundTruth = { a: 0, b: 1, c: 0, d: 1 };
    const predictions = { a: 0, b: 1, c: 2, d: 0 };

    const s = scoreSubmission({ groundTruth, predictions, numClasses: 5, referableThreshold: 2 });

    // pos = 0 ⇒ sensitivity defined as 0.
    expect(s.referableSensitivity).toBeCloseTo(0, 4);
    // neg = 4 (all true <2). pred<2: a(0)✓, b(1)✓, c(2)✗, d(0)✓ ⇒ TN=3 ⇒ spec=3/4=0.75.
    expect(s.referableSpecificity).toBeCloseTo(0.75, 4);
    // accuracy: exact a✓, b✓, c✗(0 vs 2), d✗(1 vs 0) ⇒ 2/4 = 0.5.
    expect(s.accuracy).toBeCloseTo(0.5, 4);
    expect(s.coverage).toBeCloseTo(1, 4);
    // ---- hand-computed qwk (N=5 ⇒ (N-1)^2 = 16, n = 4) ----
    // true=[0,1,0,1], pred=[0,1,2,0].
    //   Σ w·O: w[0][2]=4/16=0.25 (from c), w[1][0]=1/16=0.0625 (from d) ⇒ 0.3125
    //   histTrue=[2,2,0,0,0], histPred=[2,1,1,0,0]
    //   Σ w·E (rows i∈{0,1}, cols j∈{0,1,2}) = 0.03125 + 0.125 + 0.0625 + 0.03125 = 0.25
    //   kappa = 1 - 0.3125/0.25 = -0.25
    expect(s.qwk).toBeCloseTo(-0.25, 4);
  });
});

describe('scoreSubmission — degenerate inputs', () => {
  it('returns qwk=0, accuracy=0 when the intersection is empty', () => {
    const s = scoreSubmission({
      groundTruth: { a: 0, b: 1 },
      predictions: { z: 0 },
      numClasses: 5,
      referableThreshold: 2,
    });
    expect(s.coverage).toBeCloseTo(0, 4);
    expect(s.qwk).toBeCloseTo(0, 4); // n == 0 branch
    expect(s.accuracy).toBeCloseTo(0, 4);
  });

  it('rejects a prediction label out of range [0, N-1]', () => {
    expect(() =>
      scoreSubmission({
        groundTruth: { a: 0 },
        predictions: { a: 9 },
        numClasses: 5,
        referableThreshold: 2,
      }),
    ).toThrow(ScoringError);
  });

  it('rejects a non-integer prediction label', () => {
    expect(() =>
      scoreSubmission({
        groundTruth: { a: 0 },
        predictions: { a: 1.5 },
        numClasses: 5,
        referableThreshold: 2,
      }),
    ).toThrow(ScoringError);
  });
});

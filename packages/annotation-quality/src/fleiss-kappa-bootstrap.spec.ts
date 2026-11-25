import { describe, expect, it } from 'vitest';
import { fleissKappa } from './fleiss-kappa.js';
import {
  FLEISS_BOOTSTRAP_RESAMPLES,
  FLEISS_BOOTSTRAP_SEED,
  fleissKappaBootstrap,
  fleissResamplesFor,
} from './fleiss-kappa-bootstrap.js';

// Fleiss (1971) worked example: 10 subjects, 14 raters, 5 categories, κ ≈ 0.21.
const FLEISS_1971 = [
  [0, 0, 0, 0, 14],
  [0, 2, 6, 4, 2],
  [0, 0, 3, 5, 6],
  [0, 3, 9, 2, 0],
  [2, 2, 8, 1, 1],
  [7, 7, 0, 0, 0],
  [3, 2, 6, 3, 0],
  [2, 5, 3, 2, 2],
  [6, 5, 2, 1, 0],
  [0, 2, 2, 3, 7],
];

describe('fleissKappaBootstrap', () => {
  it('gives the same interval for the same ratings (fixed seed and resamples)', () => {
    const a = fleissKappaBootstrap(FLEISS_1971);
    const b = fleissKappaBootstrap(FLEISS_1971);
    expect(a).toEqual(b);
    expect(a?.resamples).toBe(FLEISS_BOOTSTRAP_RESAMPLES);
    expect(a?.seed).toBe(FLEISS_BOOTSTRAP_SEED);
    expect(a?.method).toBe('percentile-bootstrap');
    expect(a?.level).toBe(0.95);
  });

  it('brackets the point estimate on the worked example', () => {
    const kappa = fleissKappa(FLEISS_1971).kappa;
    const ci = fleissKappaBootstrap(FLEISS_1971);
    expect(ci).not.toBeNull();
    expect(ci!.lower).toBeLessThan(kappa);
    expect(ci!.upper).toBeGreaterThan(kappa);
    expect(ci!.lower).toBeGreaterThanOrEqual(-1);
    expect(ci!.upper).toBeLessThanOrEqual(1);
  });

  it('narrows as the number of items grows (about 1/sqrt(n))', () => {
    const once = fleissKappaBootstrap(FLEISS_1971)!;
    const fourTimes = fleissKappaBootstrap([
      ...FLEISS_1971,
      ...FLEISS_1971,
      ...FLEISS_1971,
      ...FLEISS_1971,
    ])!;
    const ratio = (fourTimes.upper - fourTimes.lower) / (once.upper - once.lower);
    // Four times the items: half the width, give or take resampling noise.
    expect(ratio).toBeGreaterThan(0.35);
    expect(ratio).toBeLessThan(0.65);
  });

  it('is [1, 1] when the raters always agree and both categories occur', () => {
    const ci = fleissKappaBootstrap([
      [3, 0],
      [0, 3],
      [3, 0],
      [0, 3],
      [3, 0],
      [0, 3],
      [3, 0],
      [0, 3],
      [3, 0],
      [0, 3],
    ]);
    expect(ci?.lower).toBe(1);
    expect(ci?.upper).toBe(1);
  });

  it('counts resamples with no kappa and leaves them out', () => {
    // Nine items in one category and one split item: resamples that never
    // draw the split item have every rating in one category.
    const matrix = [...Array.from({ length: 9 }, () => [3, 0]), [2, 1]];
    const ci = fleissKappaBootstrap(matrix);
    expect(ci).not.toBeNull();
    expect(ci!.degenerateResamples).toBeGreaterThan(0);
    expect(ci!.degenerateResamples).toBeLessThan(ci!.resamples / 2);
  });

  it('gives no interval when kappa is not defined', () => {
    expect(
      fleissKappaBootstrap([
        [3, 0],
        [3, 0],
      ]),
    ).toBeNull();
  });

  it('honours explicit resamples and seed', () => {
    const ci = fleissKappaBootstrap(FLEISS_1971, { resamples: 500, seed: 1 });
    expect(ci?.resamples).toBe(500);
    expect(ci?.seed).toBe(1);
    expect(ci).not.toEqual(fleissKappaBootstrap(FLEISS_1971));
  });

  it('throws on a malformed matrix, as fleissKappa does', () => {
    expect(() => fleissKappaBootstrap([[1, 1], [1]])).toThrow(/row 1 has 1 categories/);
  });
});

describe('fleissResamplesFor', () => {
  it('keeps 2,000 resamples up to the budget, then shrinks to a floor of 200', () => {
    expect(fleissResamplesFor(10)).toBe(2000);
    expect(fleissResamplesFor(20_000)).toBe(2000);
    expect(fleissResamplesFor(40_000)).toBe(1000);
    expect(fleissResamplesFor(10_000_000)).toBe(200);
  });
});

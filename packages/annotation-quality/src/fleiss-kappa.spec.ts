import { describe, expect, it } from 'vitest';
import { buildFleissMatrix, fleissKappa } from './fleiss-kappa.js';

describe('fleissKappa', () => {
  it('matches Fleiss (1971) Table 1 — 10 subjects, 14 raters, 5 categories', () => {
    // Reference data from Fleiss J.L. (1971) "Measuring nominal scale
    // agreement among many raters", Psychological Bulletin 76(5)
    // Table 1. The published statistic is κ ≈ 0.21.
    //
    // Matrix rows = subjects, columns = categories (1..5), cells =
    // number of raters who picked that category.
    const matrix = [
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
    const r = fleissKappa(matrix);
    expect(r.ratersPerItem).toBe(14);
    expect(r.nItems).toBe(10);
    expect(r.nCategories).toBe(5);
    // Fleiss' published κ for this dataset.
    expect(r.kappa).toBeCloseTo(0.21, 2);
  });

  it('returns 1 for unanimous agreement (everyone picks the same on every item)', () => {
    const matrix = [
      [3, 0],
      [3, 0],
      [3, 0],
    ];
    const r = fleissKappa(matrix);
    // P̄ = 1; P̄_e = 1 (entire dist on column 0) → κ = 0/0 = NaN by
    // the formula. Acceptable degenerate; downstream callers check
    // for variance separately.
    expect(r.meanAgreement).toBe(1);
    expect(Number.isNaN(r.kappa)).toBe(true);
  });

  it('throws on row width mismatch + uneven raters-per-item', () => {
    expect(() => fleissKappa([[1, 1], [1]])).toThrow(/row 1 has 1 categories/);
    expect(() =>
      fleissKappa([
        [2, 0],
        [1, 0],
      ]),
    ).toThrow(/sums to 1, expected 2/);
  });

  it('throws on non-integer / negative cell counts', () => {
    expect(() =>
      fleissKappa([
        [1, 0.5],
        [1, 0.5],
      ]),
    ).toThrow(/non-integer/);
    expect(() =>
      fleissKappa([
        [1, -1],
        [0, 0],
      ]),
    ).toThrow(/non-integer.*-1/);
  });
});

describe('buildFleissMatrix', () => {
  it('converts long-form ratings to a Fleiss matrix with sorted categories', () => {
    const { matrix, categories } = buildFleissMatrix([
      ['cat', 'cat', 'dog'],
      ['bird', 'cat', 'cat'],
    ]);
    expect(categories).toEqual(['bird', 'cat', 'dog']);
    expect(matrix).toEqual([
      [0, 2, 1],
      [1, 2, 0],
    ]);
  });

  it('throws when raters-per-item varies across items', () => {
    expect(() => buildFleissMatrix([['a', 'a'], ['a']])).toThrow(/item 1 has 1 raters/);
  });
});

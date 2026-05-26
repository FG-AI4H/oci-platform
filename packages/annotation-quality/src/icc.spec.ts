import { describe, expect, it } from 'vitest';
import { icc21 } from './icc.js';

describe('icc21', () => {
  it('returns ICC near 1.0 for raters in perfect agreement', () => {
    const ratings = [
      [10, 10, 10],
      [20, 20, 20],
      [30, 30, 30],
      [40, 40, 40],
    ];
    const out = icc21(ratings);
    expect(out.icc).toBeCloseTo(1, 5);
  });

  it('returns ICC near 0 when subjects all have the same mean but raters drift around it', () => {
    // No between-subject variance — all rows have the same mean.
    // Raters disagree noisily, so msBetweenSubjects → 0 and ICC → 0 (or negative).
    const ratings = [
      [10, 12, 11],
      [11, 9, 13],
      [12, 10, 11],
      [9, 11, 13],
    ];
    const out = icc21(ratings);
    expect(out.icc).toBeLessThan(0.5);
  });

  it('matches the McGraw & Wong (1996) example (table 1)', () => {
    // Table 1 from McGraw & Wong, p.34. 6 subjects × 4 raters.
    // Reported ICC(2,1) absolute-agreement ≈ 0.290.
    const ratings = [
      [9, 2, 5, 8],
      [6, 1, 3, 2],
      [8, 4, 6, 8],
      [7, 1, 2, 6],
      [10, 5, 6, 9],
      [6, 2, 4, 7],
    ];
    const out = icc21(ratings);
    expect(out.icc).toBeCloseTo(0.29, 1);
  });

  it('returns the correct ANOVA decomposition', () => {
    const ratings = [
      [1, 2],
      [3, 4],
      [5, 6],
    ];
    const out = icc21(ratings);
    expect(out.nSubjects).toBe(3);
    expect(out.nRaters).toBe(2);
    // grandMean = 3.5; rowMeans = [1.5, 3.5, 5.5]; colMeans = [3, 4]
    // ssBetweenSubjects = 2 * ((1.5-3.5)^2 + (3.5-3.5)^2 + (5.5-3.5)^2) = 2 * 8 = 16
    expect(out.msBetweenSubjects).toBeCloseTo(8, 5);
  });

  it('throws when fewer than 2 subjects', () => {
    expect(() => icc21([[1, 2, 3]])).toThrow();
  });

  it('throws when fewer than 2 raters', () => {
    expect(() => icc21([[1], [2]])).toThrow();
  });

  it('throws on ragged matrix', () => {
    expect(() => icc21([[1, 2], [3]])).toThrow();
  });

  it('throws on non-finite cell', () => {
    expect(() =>
      icc21([
        [1, 2],
        [3, Number.NaN],
      ]),
    ).toThrow();
  });
});

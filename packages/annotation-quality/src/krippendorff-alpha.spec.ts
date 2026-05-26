import { describe, expect, it } from 'vitest';
import { krippendorffAlpha } from './krippendorff-alpha.js';

describe('krippendorffAlpha — nominal', () => {
  it('returns α = 1.0 for perfect agreement', () => {
    const ratings = [
      ['a', 'a', 'a'],
      ['b', 'b', 'b'],
      ['c', 'c', 'c'],
    ];
    const out = krippendorffAlpha(ratings, { level: 'nominal' });
    expect(out.alpha).toBe(1);
    expect(out.observedDisagreement).toBe(0);
  });

  it('returns α slightly above 0 when observed agreement only mildly beats chance', () => {
    // Two raters, two categories, 4 items: AA, BB, AB, BA
    // Coincidence: o_AA=2, o_BB=2, o_AB=2, o_BA=2 → marginals A=4, B=4, total=8
    // D_o = 4 (the two mismatched units contribute 1+1 with δ²=1 each, doubled
    //         to count both rater orderings)
    // D_e = (4*4 + 4*4) / (8-1) = 32/7
    // α = 1 - D_o/D_e = 1 - 4 / (32/7) = 1 - 7/8 = 0.125
    const ratings = [
      ['A', 'A'],
      ['B', 'B'],
      ['A', 'B'],
      ['B', 'A'],
    ];
    const out = krippendorffAlpha(ratings, { level: 'nominal' });
    expect(out.alpha).toBeCloseTo(0.125, 3);
  });

  it('returns α < 0 for systematic disagreement', () => {
    // Raters flip: A→B and B→A on every item
    const ratings = [
      ['A', 'B'],
      ['A', 'B'],
      ['B', 'A'],
      ['B', 'A'],
    ];
    const out = krippendorffAlpha(ratings, { level: 'nominal' });
    expect(out.alpha).toBeLessThan(0);
  });

  it('handles unequal rater coverage via null', () => {
    const ratings = [
      ['a', 'a', 'a'],
      ['b', null, 'b'],
      ['c', 'c', null],
    ];
    const out = krippendorffAlpha(ratings, { level: 'nominal' });
    expect(out.alpha).toBe(1);
    expect(out.nItems).toBe(3);
  });

  it('drops items with fewer than two non-null ratings', () => {
    const ratings: (string | null)[][] = [
      ['a', 'b'],
      ['b', null],
      [null, null],
    ];
    const out = krippendorffAlpha(ratings, { level: 'nominal' });
    expect(out.nItems).toBe(1);
  });
});

describe('krippendorffAlpha — ordinal', () => {
  it('penalises far-apart disagreements more than adjacent ones', () => {
    // Item 1: raters say 1 vs 2 (adjacent)
    // Item 2: raters say 1 vs 5 (far)
    // Same dataset twice with the disagreement either adjacent or far —
    // far-apart should yield lower α.
    const adjacent = [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [1, 2],
    ];
    const far = [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [1, 5],
    ];
    const ordA = krippendorffAlpha(adjacent, { level: 'ordinal' });
    const ordF = krippendorffAlpha(far, { level: 'ordinal' });
    expect(ordA.alpha).toBeGreaterThan(ordF.alpha);
  });

  it('matches nominal α = 1 for perfect agreement', () => {
    const ratings = [
      [1, 1],
      [2, 2],
      [3, 3],
    ];
    expect(krippendorffAlpha(ratings, { level: 'ordinal' }).alpha).toBe(1);
  });
});

describe('krippendorffAlpha — interval', () => {
  it('treats numeric disagreement quadratically', () => {
    // Small disagreement (10 vs 11) should yield higher α than
    // large disagreement (10 vs 30) with the same dataset shape.
    const small = [
      [10, 10],
      [20, 20],
      [30, 30],
      [10, 11],
    ];
    const big = [
      [10, 10],
      [20, 20],
      [30, 30],
      [10, 30],
    ];
    const a = krippendorffAlpha(small, { level: 'interval' });
    const b = krippendorffAlpha(big, { level: 'interval' });
    expect(a.alpha).toBeGreaterThan(b.alpha);
  });

  it('throws when a non-numeric value is supplied for interval', () => {
    expect(() =>
      krippendorffAlpha(
        [
          ['a', 'a'],
          ['b', 'b'],
        ],
        { level: 'interval' },
      ),
    ).toThrow();
  });
});

describe('krippendorffAlpha — edge cases', () => {
  it('throws on empty input', () => {
    expect(() => krippendorffAlpha([], { level: 'nominal' })).toThrow();
  });

  it('throws when no item has 2+ ratings', () => {
    expect(() => krippendorffAlpha([[null, 'a'], [null], ['b']], { level: 'nominal' })).toThrow();
  });

  it('throws when only one category is observed', () => {
    expect(() =>
      krippendorffAlpha(
        [
          ['a', 'a'],
          ['a', 'a'],
        ],
        { level: 'nominal' },
      ),
    ).toThrow();
  });
});

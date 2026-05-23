import { describe, expect, it } from 'vitest';
import { cohensKappa } from './cohens-kappa.js';

describe('cohensKappa', () => {
  it('returns 1 for perfect agreement', () => {
    const r = cohensKappa(['cat', 'dog', 'cat'], ['cat', 'dog', 'cat']);
    expect(r.kappa).toBe(1);
    expect(r.observedAgreement).toBe(1);
  });

  it('returns 0 when observed agreement equals chance', () => {
    // Each rater splits 50/50 independently → chance agreement = 0.5.
    // Observed agreement also = 0.5 → κ = 0.
    const r = cohensKappa(['yes', 'no', 'yes', 'no'], ['yes', 'no', 'no', 'yes']);
    expect(r.observedAgreement).toBeCloseTo(0.5, 10);
    expect(r.expectedAgreement).toBeCloseTo(0.5, 10);
    expect(r.kappa).toBeCloseTo(0, 10);
  });

  it("matches Cohen (1960) §5 worked example — judges A and B's 200 cases", () => {
    // Cohen 1960 §5 worked example, reconstructed from the published
    // marginals so the test data is verifiable from primary source:
    //   confusion matrix
    //                B
    //              + 0 -
    //         A +  88 14 18    = 120 total for A=+
    //           0  10 40 10    = 60
    //           -   2  6 12    = 20
    //          sum 100 60 40   = 200
    //
    // p_o = (88+40+12)/200 = 0.70
    // p_e = (120/200)(100/200) + (60/200)(60/200) + (20/200)(40/200)
    //     = 0.30 + 0.09 + 0.02 = 0.41
    // κ   = (0.70 - 0.41) / (1 - 0.41) = 0.29 / 0.59 ≈ 0.4915
    const counts: Array<[string, string, number]> = [
      ['+', '+', 88],
      ['+', '0', 14],
      ['+', '-', 18],
      ['0', '+', 10],
      ['0', '0', 40],
      ['0', '-', 10],
      ['-', '+', 2],
      ['-', '0', 6],
      ['-', '-', 12],
    ];
    const a: string[] = [];
    const b: string[] = [];
    for (const [ra, rb, n] of counts) {
      for (let i = 0; i < n; i += 1) {
        a.push(ra);
        b.push(rb);
      }
    }
    const r = cohensKappa(a, b);
    expect(r.n).toBe(200);
    expect(r.observedAgreement).toBeCloseTo(0.7, 10);
    expect(r.expectedAgreement).toBeCloseTo(0.41, 10);
    expect(r.kappa).toBeCloseTo(0.29 / 0.59, 4);
  });

  it('handles a single-category degenerate (both raters constant + agree → NaN)', () => {
    const r = cohensKappa(['x', 'x', 'x'], ['x', 'x', 'x']);
    expect(r.observedAgreement).toBe(1);
    expect(r.expectedAgreement).toBe(1);
    expect(Number.isNaN(r.kappa)).toBe(true);
  });

  it('throws on length mismatch + empty input', () => {
    expect(() => cohensKappa(['a'], ['a', 'b'])).toThrow(/same length/);
    expect(() => cohensKappa([], [])).toThrow(/at least one item/);
  });
});

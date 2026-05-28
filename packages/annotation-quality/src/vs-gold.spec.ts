import { describe, expect, it } from 'vitest';
import { annotatorVsGold } from './vs-gold.js';

describe('annotatorVsGold', () => {
  it('returns null when the annotator has scored no gold samples', () => {
    const r = annotatorVsGold({ metric: 'cohens-kappa', pairs: [] });
    expect(r).toEqual({ score: null, scored: 0 });
  });

  it('returns null when every pair lacks a usable label', () => {
    const r = annotatorVsGold({
      metric: 'cohens-kappa',
      pairs: [
        { submission: { label: '' }, gold: { label: 'pneumonia' } },
        { submission: { other: 'x' }, gold: { label: 'normal' } },
      ],
    });
    expect(r.score).toBeNull();
    expect(r.scored).toBe(0);
  });

  it('uses accuracy for the `dice` metric (label-string equality, mean per sample)', () => {
    const pairs = [
      { submission: { label: 'pneumonia' }, gold: { label: 'pneumonia' } },
      { submission: { label: 'normal' }, gold: { label: 'normal' } },
      { submission: { label: 'pneumonia' }, gold: { label: 'normal' } }, // disagreement
      { submission: { label: 'normal' }, gold: { label: 'pneumonia' } }, // disagreement
    ];
    const r = annotatorVsGold({ metric: 'dice', pairs });
    expect(r.scored).toBe(4);
    expect(r.score).toBeCloseTo(0.5, 10);
  });

  it("computes Cohen's κ for categorical metrics", () => {
    // 8 pairs, perfect agreement on 6, two disagreements.
    const pairs = [
      { submission: { label: 'a' }, gold: { label: 'a' } },
      { submission: { label: 'a' }, gold: { label: 'a' } },
      { submission: { label: 'b' }, gold: { label: 'b' } },
      { submission: { label: 'b' }, gold: { label: 'b' } },
      { submission: { label: 'a' }, gold: { label: 'a' } },
      { submission: { label: 'a' }, gold: { label: 'a' } },
      { submission: { label: 'a' }, gold: { label: 'b' } },
      { submission: { label: 'b' }, gold: { label: 'a' } },
    ];
    const r = annotatorVsGold({ metric: 'cohens-kappa', pairs });
    expect(r.scored).toBe(8);
    expect(r.score).not.toBeNull();
    // p_o = 6/8 = 0.75; marginals: subA=5/8, subB=3/8; goldA=5/8, goldB=3/8;
    // p_e = (5/8)(5/8) + (3/8)(3/8) = 25/64 + 9/64 = 34/64 = 0.53125
    // κ = (0.75 - 0.53125) / (1 - 0.53125) = 0.21875 / 0.46875 ≈ 0.4667
    expect(r.score!).toBeCloseTo(0.4667, 3);
  });

  it('clamps negative κ to 0 (worse-than-chance reads as "no agreement" for the supervisor)', () => {
    // Annotator consistently picks the opposite of gold → κ negative.
    const pairs = Array.from({ length: 8 }, (_, i) => ({
      submission: { label: i % 2 === 0 ? 'b' : 'a' },
      gold: { label: i % 2 === 0 ? 'a' : 'b' },
    }));
    const r = annotatorVsGold({ metric: 'cohens-kappa', pairs });
    expect(r.score).toBe(0);
  });

  it('falls back to accuracy when κ is NaN (zero variance in both sub + gold)', () => {
    // When both raters always pick the same single class p_e = 1
    // and κ = 0/0 = NaN. Fall back to accuracy: all 3 agree → 1.
    const pairs = [
      { submission: { label: 'a' }, gold: { label: 'a' } },
      { submission: { label: 'a' }, gold: { label: 'a' } },
      { submission: { label: 'a' }, gold: { label: 'a' } },
    ];
    const r = annotatorVsGold({ metric: 'cohens-kappa', pairs });
    expect(r.score).toBe(1);
  });
});

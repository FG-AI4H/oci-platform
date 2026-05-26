import { describe, expect, it } from 'vitest';
import { euclideanDistance, vectorAgreementScore } from './euclidean.js';

describe('euclideanDistance', () => {
  it('returns 0 for identical vectors', () => {
    expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it('matches the 3-4-5 triangle', () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
  });

  it('handles 1-D scalar diffs', () => {
    expect(euclideanDistance([10], [13])).toBe(3);
  });

  it('throws on length mismatch', () => {
    expect(() => euclideanDistance([1, 2], [1, 2, 3])).toThrow();
  });

  it('throws on empty input', () => {
    expect(() => euclideanDistance([], [])).toThrow();
  });

  it('throws on non-finite cell', () => {
    expect(() => euclideanDistance([1, 2], [1, Number.NaN])).toThrow();
  });
});

describe('vectorAgreementScore', () => {
  it('returns 1.0 for identical vectors at any scale', () => {
    expect(vectorAgreementScore([1, 2, 3], [1, 2, 3], 10)).toBe(1);
  });

  it('returns 0.5 when distance equals half the scale', () => {
    expect(vectorAgreementScore([0, 0], [3, 4], 10)).toBe(0.5);
  });

  it('clamps to 0 when distance exceeds the scale', () => {
    expect(vectorAgreementScore([0, 0], [30, 40], 10)).toBe(0);
  });

  it('throws on invalid scale', () => {
    expect(() => vectorAgreementScore([0], [1], 0)).toThrow();
    expect(() => vectorAgreementScore([0], [1], -1)).toThrow();
  });
});

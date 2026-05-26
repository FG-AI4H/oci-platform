import { describe, expect, it } from 'vitest';
import { hausdorffDistance } from './hausdorff.js';

describe('hausdorffDistance', () => {
  it('returns 0 for identical point sets', () => {
    const a = [
      [0, 0],
      [1, 0],
      [0, 1],
    ];
    const out = hausdorffDistance(a, a);
    expect(out.distance).toBe(0);
    expect(out.forward).toBe(0);
    expect(out.backward).toBe(0);
  });

  it('captures the worst-case mismatch (single outlier dominates strict H)', () => {
    const a = [
      [0, 0],
      [1, 0],
      [10, 10], // outlier
    ];
    const b = [
      [0, 0],
      [1, 0],
    ];
    const out = hausdorffDistance(a, b);
    // forward: from a → b, point (10,10) is closest to (1,0) at √(81+100)=√181 ≈ 13.45
    expect(out.forward).toBeCloseTo(Math.sqrt(181), 4);
    // backward: every b is in a, so 0
    expect(out.backward).toBe(0);
    expect(out.distance).toBeCloseTo(Math.sqrt(181), 4);
  });

  it('hd95 is more robust to single outliers than the strict variant', () => {
    const points = Array.from({ length: 20 }, (_, i) => [i, 0]);
    const ref = Array.from({ length: 20 }, (_, i) => [i, 0]);
    // Inject one big outlier in `points`
    const noisy = [...points, [100, 100]];
    const strict = hausdorffDistance(noisy, ref).distance;
    const hd95 = hausdorffDistance(noisy, ref, { percentile: 95 }).distance;
    expect(strict).toBeGreaterThan(hd95);
  });

  it('handles 3D point sets', () => {
    const a = [
      [0, 0, 0],
      [1, 1, 1],
    ];
    const b = [
      [0, 0, 0],
      [1, 1, 0],
    ];
    // forward: (1,1,1) → closest in b is (1,1,0) at distance 1
    expect(hausdorffDistance(a, b).distance).toBeCloseTo(1, 5);
  });

  it('throws on mismatched dimensions', () => {
    expect(() =>
      hausdorffDistance(
        [
          [0, 0],
          [1, 1],
        ],
        [[0, 0, 0]],
      ),
    ).toThrow();
  });

  it('throws on empty input', () => {
    expect(() => hausdorffDistance([], [[0, 0]])).toThrow();
  });

  it('throws on invalid percentile', () => {
    expect(() => hausdorffDistance([[0]], [[1]], { percentile: 0 })).toThrow();
    expect(() => hausdorffDistance([[0]], [[1]], { percentile: 101 })).toThrow();
  });
});

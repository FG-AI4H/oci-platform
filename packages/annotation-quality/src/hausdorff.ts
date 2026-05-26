/**
 * Hausdorff distance — maximum boundary mismatch between two point
 * sets in d-dimensional Euclidean space.
 *
 *   h(A, B) = max_{a ∈ A} min_{b ∈ B} ‖a - b‖
 *   H(A, B) = max(h(A, B), h(B, A))
 *
 * Intuition: H(A, B) = ε means every point of either set is within ε
 * of the other set. For segmentation IRR this captures the worst-case
 * boundary drift between two rater contours.
 *
 * The 95th-percentile variant `hd95` swaps the outer `max` for the
 * 95th percentile of per-point minima — robust to single-outlier
 * contour points that the strict Hausdorff is famously fragile to.
 *
 * Naive O(n*m) implementation. The radial-grid acceleration that
 * mainstream medical-imaging libraries (e.g. monai.metrics) use is
 * a future optimisation; campaign-quality samples are < 10⁴ points
 * per contour, so the naive version is fine.
 *
 * `points` are arrays of fixed-length numeric vectors. All vectors
 * across both sets must share the same length; mixed-dimension input
 * throws.
 */

export type Point = readonly number[];

export interface HausdorffOptions {
  /** Percentile in (0, 100]. Defaults to 100 (strict Hausdorff). */
  percentile?: number;
}

export interface HausdorffResult {
  /** Symmetric Hausdorff distance H(A, B). */
  distance: number;
  /** Directional component h(A, B). */
  forward: number;
  /** Directional component h(B, A). */
  backward: number;
  percentile: number;
}

export function hausdorffDistance(
  a: readonly Point[],
  b: readonly Point[],
  options: HausdorffOptions = {},
): HausdorffResult {
  if (a.length === 0 || b.length === 0) {
    throw new RangeError('hausdorffDistance: both point sets must be non-empty');
  }
  const dim = a[0]!.length;
  if (dim === 0) {
    throw new RangeError('hausdorffDistance: points must have at least one dimension');
  }
  validateDim(a, dim);
  validateDim(b, dim);

  const percentile = options.percentile ?? 100;
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 100) {
    throw new RangeError('hausdorffDistance: percentile must be in (0, 100]');
  }

  const forward = directional(a, b, percentile);
  const backward = directional(b, a, percentile);
  return {
    distance: Math.max(forward, backward),
    forward,
    backward,
    percentile,
  };
}

function directional(from: readonly Point[], to: readonly Point[], percentile: number): number {
  const mins = new Array<number>(from.length);
  for (let i = 0; i < from.length; i += 1) {
    let best = Infinity;
    // eslint-disable-next-line security/detect-object-injection -- bounded index
    const p = from[i]!;
    for (let j = 0; j < to.length; j += 1) {
      // eslint-disable-next-line security/detect-object-injection -- bounded index
      const q = to[j]!;
      const d = euclidean(p, q);
      if (d < best) best = d;
    }
    // eslint-disable-next-line security/detect-object-injection -- bounded index
    mins[i] = best;
  }
  if (percentile === 100) {
    let max = 0;
    for (const m of mins) if (m > max) max = m;
    return max;
  }
  const sorted = [...mins].sort((x, y) => x - y);
  // linear interpolation between sorted neighbours
  const rank = (percentile / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  /* eslint-disable security/detect-object-injection -- bounded numeric indices into a local sorted array */
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
  /* eslint-enable security/detect-object-injection */
}

function euclidean(a: Point, b: Point): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- bounded index
    const d = a[i]! - b[i]!;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function validateDim(points: readonly Point[], dim: number): void {
  for (let i = 0; i < points.length; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- bounded loop
    const p = points[i]!;
    if (p.length !== dim) {
      throw new RangeError(
        `hausdorffDistance: point ${i} has dimension ${p.length}, expected ${dim}`,
      );
    }
    for (const v of p) {
      if (!Number.isFinite(v)) {
        throw new RangeError(`hausdorffDistance: point ${i} contains non-finite coordinate`);
      }
    }
  }
}

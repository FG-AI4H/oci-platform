/**
 * Euclidean distance + a campaign-quality wrapper that turns it into
 * an agreement score in [0, 1].
 *
 * Used for continuous-vector outputs:
 *   - bounding-box coordinates (x, y, w, h)
 *   - landmark predictions (x1, y1, x2, y2, …)
 *   - measurement values (lesion volume, BMI, …)
 *
 * `euclideanDistance(a, b)` returns the raw distance ‖a - b‖₂.
 *
 * `vectorAgreementScore(a, b, scale)` maps the distance into a
 * bounded "agreement" score with `score = max(0, 1 - distance/scale)`,
 * so a campaign manager can pick a scale (e.g. "half the bounding-box
 * diagonal") and get a comparable IRR number against κ / α.
 *
 * Both vectors must have the same length; mixed-length input throws.
 */

export type Vector = readonly number[];

export function euclideanDistance(a: Vector, b: Vector): number {
  if (a.length !== b.length) {
    throw new RangeError(
      `euclideanDistance: vectors must have equal length (got ${a.length} vs ${b.length})`,
    );
  }
  if (a.length === 0) {
    throw new RangeError('euclideanDistance: vectors must be non-empty');
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- bounded loop
    const va = a[i]!;
    // eslint-disable-next-line security/detect-object-injection -- bounded loop
    const vb = b[i]!;
    if (!Number.isFinite(va) || !Number.isFinite(vb)) {
      throw new RangeError(`euclideanDistance: non-finite coordinate at index ${i}`);
    }
    const d = va - vb;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function vectorAgreementScore(a: Vector, b: Vector, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('vectorAgreementScore: scale must be a finite positive number');
  }
  const d = euclideanDistance(a, b);
  return Math.max(0, 1 - d / scale);
}

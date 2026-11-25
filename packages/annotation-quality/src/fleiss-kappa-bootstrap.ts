/**
 * A confidence interval for Fleiss' kappa: percentile bootstrap over
 * items (#648).
 *
 * The items (rows of the rating matrix) are resampled with replacement,
 * kappa is recomputed on each resample, and the interval is the 2.5th
 * and 97.5th percentiles of those kappas (type-7 quantiles).
 *
 * Why a bootstrap and not the asymptotic formula:
 *   - The closed-form variance usually quoted for Fleiss' kappa (Fleiss,
 *     Nee & Landis 1979) is derived under the null hypothesis that kappa
 *     is 0. It is meant for testing "better than chance", not for an
 *     interval around a kappa that is not 0, and the interval built from
 *     it is too narrow when agreement is real.
 *   - Zapf et al. (2016) compared the intervals by simulation and found
 *     the bootstrap interval for Fleiss' kappa kept its coverage where
 *     the asymptotic one did not.
 *   - The items are the sample (the readers are fixed), so the items are
 *     what is resampled.
 *
 * Reproducible: the pseudo-random generator has a fixed seed and the
 * number of resamples is fixed, so the same ratings always get the same
 * interval. The evaluation module's AUC interval follows the same rule.
 *
 * A resample where every rating falls in one category has no kappa
 * (0/0). Such resamples are left out and counted; when more than half
 * are, no interval is given.
 *
 * References:
 *   Fleiss J.L., Nee J.C.M., Landis J.R. (1979) "Large sample variance
 *     of kappa in the case of different sets of raters", Psychological
 *     Bulletin 86(5), 974-977.
 *   Zapf A., Castell S., Morawietz L., Karch A. (2016) "Measuring
 *     inter-rater reliability for nominal data - which coefficients and
 *     confidence intervals are appropriate?", BMC Medical Research
 *     Methodology 16:93.
 *   Efron B., Tibshirani R.J. (1993) An Introduction to the Bootstrap,
 *     ch. 13 (percentile intervals).
 */

/* eslint-disable security/detect-object-injection --
 * Every computed member access below indexes a locally built typed array
 * with a bounded numeric loop counter. */

import { fleissKappa } from './fleiss-kappa.js';

/** Resamples behind the interval. Fixed, so the interval is reproducible. */
export const FLEISS_BOOTSTRAP_RESAMPLES = 2000;

/** Seed of the bootstrap's generator. Fixed, so the interval is reproducible. */
export const FLEISS_BOOTSTRAP_SEED = 648;

/**
 * Work budget, in item-resamples: 2,000 resamples of up to 20,000 items.
 * The interval is computed inside a request; above 20,000 items the
 * number of resamples shrinks to stay within it, never below 200. The
 * count used is a function of the item count alone, and is reported.
 */
export const FLEISS_BOOTSTRAP_BUDGET = 2000 * 20_000;
export const FLEISS_BOOTSTRAP_MIN_RESAMPLES = 200;

export interface FleissKappaInterval {
  /** Lower bound (2.5th percentile of the resampled kappas). */
  lower: number;
  /** Upper bound (97.5th percentile). */
  upper: number;
  /** Two-sided confidence level, 0.95. */
  level: number;
  method: 'percentile-bootstrap';
  /** Resamples drawn. */
  resamples: number;
  /** Resamples left out because every rating fell in one category. */
  degenerateResamples: number;
  seed: number;
}

export interface FleissKappaBootstrapOptions {
  resamples?: number;
  seed?: number;
}

/** Resamples for `n` items, under the work budget. */
export function fleissResamplesFor(n: number): number {
  if (n <= 0) return FLEISS_BOOTSTRAP_RESAMPLES;
  return Math.max(
    FLEISS_BOOTSTRAP_MIN_RESAMPLES,
    Math.min(FLEISS_BOOTSTRAP_RESAMPLES, Math.floor(FLEISS_BOOTSTRAP_BUDGET / n)),
  );
}

/**
 * Mulberry32: a small, well-mixed 32-bit generator. Used only to make
 * the bootstrap reproducible; nothing here needs cryptographic
 * randomness.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear-interpolation quantile of an ascending-sorted array (type 7). */
function quantileSorted(sorted: Float64Array, q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * The 95% percentile-bootstrap interval of Fleiss' kappa for `matrix`
 * (same shape as `fleissKappa`'s input: one row per item, one column per
 * category, every row summing to the same number of raters).
 *
 * Returns null when kappa itself is not defined (every rating in one
 * category) or when more than half of the resamples have no kappa.
 * Throws as `fleissKappa` does on a malformed matrix.
 */
export function fleissKappaBootstrap(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
  options: FleissKappaBootstrapOptions = {},
): FleissKappaInterval | null {
  // Validates the matrix and gives the point estimate.
  const point = fleissKappa(matrix);
  if (!Number.isFinite(point.kappa)) return null;

  const nItems = point.nItems;
  const nCategories = point.nCategories;
  const n = point.ratersPerItem;
  const resamples = options.resamples ?? fleissResamplesFor(nItems);
  const seed = options.seed ?? FLEISS_BOOTSTRAP_SEED;

  // Per-item agreement P_i, and the row counts flattened, computed once:
  // a resample only changes how often each item counts.
  const itemAgreement = new Float64Array(nItems);
  const cells = new Float64Array(nItems * nCategories);
  for (let i = 0; i < nItems; i += 1) {
    const row = matrix[i]!;
    let s = 0;
    for (let j = 0; j < nCategories; j += 1) {
      const c = row[j]!;
      cells[i * nCategories + j] = c;
      s += c * c - c;
    }
    itemAgreement[i] = s / (n * (n - 1));
  }

  const random = mulberry32(seed);
  const colTotals = new Float64Array(nCategories);
  const kappas: number[] = [];
  let degenerate = 0;
  const totalRatings = nItems * n;
  for (let r = 0; r < resamples; r += 1) {
    colTotals.fill(0);
    let sumAgreement = 0;
    for (let k = 0; k < nItems; k += 1) {
      const i = Math.floor(random() * nItems);
      sumAgreement += itemAgreement[i]!;
      const base = i * nCategories;
      for (let j = 0; j < nCategories; j += 1) colTotals[j] = colTotals[j]! + cells[base + j]!;
    }
    let expected = 0;
    for (let j = 0; j < nCategories; j += 1) {
      const p = colTotals[j]! / totalRatings;
      expected += p * p;
    }
    const denom = 1 - expected;
    // Floating-point sums can leave a hair above zero for one category.
    if (denom <= 1e-12) {
      degenerate += 1;
      continue;
    }
    kappas.push((sumAgreement / nItems - expected) / denom);
  }

  if (kappas.length === 0 || degenerate * 2 > resamples) return null;
  const sorted = Float64Array.from(kappas).sort();
  return {
    lower: quantileSorted(sorted, 0.025),
    upper: quantileSorted(sorted, 0.975),
    level: 0.95,
    method: 'percentile-bootstrap',
    resamples,
    degenerateResamples: degenerate,
    seed,
  };
}

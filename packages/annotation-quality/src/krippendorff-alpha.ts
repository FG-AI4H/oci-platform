/**
 * Krippendorff's α — inter-rater agreement for N ≥ 2 raters and
 * variable rater coverage per item, with pluggable difference
 * functions for nominal / ordinal / interval data.
 *
 *   α = 1 - (D_o / D_e)
 *
 * where D_o is observed disagreement (weighted by δ²) and D_e is
 * the disagreement expected by chance given the overall marginals.
 *
 * Strengths over Cohen's / Fleiss' κ:
 *   - Handles missing ratings (different raters per item) natively
 *   - δ² lets ordinal / interval scales contribute partial credit
 *     for "close-but-not-equal" disagreement instead of binary
 *     match/mismatch
 *   - Reduces to κ-like behaviour with the nominal δ on
 *     fully-covered data
 *
 * Reference: Krippendorff, K. (2011) "Computing Krippendorff's
 * alpha-reliability". Annenberg School for Communication
 * Departmental Paper.
 *
 * Input shape — `ratings` is a 2D array where each row is one ITEM
 * (also called "unit" in Krippendorff) and the row's entries are the
 * raters' choices, one per rater. `null` entries mark "this rater
 * did not score this item" — Krippendorff's α handles partial
 * coverage natively. Rows with fewer than two non-null ratings are
 * dropped (a single rater can't disagree with anyone).
 *
 * `level`:
 *   - `nominal`    — δ²(a, b) = 0 if a == b else 1
 *   - `ordinal`    — δ² is based on the cumulative marginal distance
 *                     between categories (Krippendorff 2011 §C2)
 *   - `interval`   — δ²(a, b) = (a - b)², requires numeric values
 *
 * Categories:
 *   - `nominal` accepts strings or numbers; equality is `===`.
 *   - `ordinal` accepts strings or numbers; the ranking order is
 *     `categories` if provided, else first-seen ascending sort.
 *   - `interval` requires numeric values; values are used directly.
 */

export type KrippendorffLevel = 'nominal' | 'ordinal' | 'interval';

export type KrippendorffValue = string | number;

export interface KrippendorffAlphaOptions {
  level: KrippendorffLevel;
  /**
   * Optional explicit category ordering used for `ordinal`. When
   * omitted, categories are sorted ascending using the natural
   * comparator (numeric for numbers, lex for strings).
   */
  categories?: readonly KrippendorffValue[];
}

export interface KrippendorffAlphaResult {
  /** α in (-∞, 1]; 1 is perfect agreement, 0 is chance-level, < 0 is systematic disagreement. */
  alpha: number;
  /** Observed disagreement D_o. */
  observedDisagreement: number;
  /** Chance-expected disagreement D_e. */
  expectedDisagreement: number;
  /** Number of items that contributed (≥ 2 ratings). */
  nItems: number;
  /** Distinct category values observed. */
  categories: readonly KrippendorffValue[];
}

export function krippendorffAlpha(
  ratings: ReadonlyArray<ReadonlyArray<KrippendorffValue | null>>,
  options: KrippendorffAlphaOptions,
): KrippendorffAlphaResult {
  if (ratings.length === 0) {
    throw new RangeError('krippendorffAlpha: ratings must contain at least one item');
  }
  const items = ratings
    .map((row) => row.filter((v): v is KrippendorffValue => v !== null))
    .filter((row) => row.length >= 2);
  if (items.length === 0) {
    throw new RangeError('krippendorffAlpha: no item has ≥ 2 non-null ratings — α is undefined');
  }

  // Build the category list. For `interval` we keep raw numerics.
  let categories: KrippendorffValue[];
  if (options.categories && options.categories.length > 0) {
    categories = [...options.categories];
  } else {
    const seen = new Set<KrippendorffValue>();
    for (const row of items) for (const v of row) seen.add(v);
    categories = [...seen].sort((a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b));
    });
  }
  if (categories.length < 2) {
    throw new RangeError('krippendorffAlpha: need at least two distinct categories');
  }
  if (options.level === 'interval') {
    for (const c of categories) {
      if (typeof c !== 'number' || !Number.isFinite(c)) {
        throw new RangeError(
          'krippendorffAlpha: interval level requires numeric, finite categories',
        );
      }
    }
  }

  const indexOf = new Map<KrippendorffValue, number>();
  categories.forEach((c, i) => indexOf.set(c, i));
  const nCategories = categories.length;

  // Coincidence matrix `o[c][c']` — sum across units of (count of
  // ordered rater-pair coincidences within the unit normalised by
  // (m_u - 1)). The double-counting is intentional — the same matrix
  // is used to compute marginals consistently.
  const coincidence: number[][] = Array.from({ length: nCategories }, () =>
    new Array<number>(nCategories).fill(0),
  );
  /* eslint-disable security/detect-object-injection -- bounded numeric indices into local arrays */
  for (const row of items) {
    const m = row.length;
    // count per category in this unit
    const counts = new Array<number>(nCategories).fill(0);
    for (const v of row) {
      const idx = indexOf.get(v);
      if (idx === undefined) {
        throw new RangeError(
          `krippendorffAlpha: rating ${String(v)} is not in the categories list`,
        );
      }
      counts[idx] = (counts[idx] ?? 0) + 1;
    }
    const denom = m - 1;
    for (let a = 0; a < nCategories; a += 1) {
      for (let b = 0; b < nCategories; b += 1) {
        const cBA = a === b ? counts[a]! * (counts[a]! - 1) : counts[a]! * counts[b]!;
        if (cBA === 0) continue;
        coincidence[a]![b]! += cBA / denom;
      }
    }
  }

  // Marginal n_c = row sum of coincidence (and column sum — symmetric).
  const marginals = new Array<number>(nCategories).fill(0);
  let total = 0;
  for (let a = 0; a < nCategories; a += 1) {
    let s = 0;
    for (let b = 0; b < nCategories; b += 1) s += coincidence[a]![b]!;
    marginals[a] = s;
    total += s;
  }
  if (total <= 1) {
    throw new RangeError('krippendorffAlpha: total coincidence is ≤ 1 — too few rated pairs');
  }

  const delta2 = buildDelta2(options.level, categories, marginals);

  let observedDisagreement = 0;
  for (let a = 0; a < nCategories; a += 1) {
    for (let b = 0; b < nCategories; b += 1) {
      observedDisagreement += coincidence[a]![b]! * delta2(a, b);
    }
  }

  let expectedDisagreement = 0;
  for (let a = 0; a < nCategories; a += 1) {
    for (let b = 0; b < nCategories; b += 1) {
      expectedDisagreement += marginals[a]! * marginals[b]! * delta2(a, b);
    }
  }
  expectedDisagreement /= total - 1;
  /* eslint-enable security/detect-object-injection */

  const alpha = expectedDisagreement === 0 ? NaN : 1 - observedDisagreement / expectedDisagreement;

  return {
    alpha,
    observedDisagreement,
    expectedDisagreement,
    nItems: items.length,
    categories,
  };
}

function buildDelta2(
  level: KrippendorffLevel,
  categories: readonly KrippendorffValue[],
  marginals: readonly number[],
): (a: number, b: number) => number {
  if (level === 'nominal') {
    return (a, b) => (a === b ? 0 : 1);
  }
  if (level === 'interval') {
    const values = categories.map((c) => c as number);
    return (a, b) => {
      /* eslint-disable-next-line security/detect-object-injection -- bounded numeric index */
      const va = values[a]!;
      /* eslint-disable-next-line security/detect-object-injection -- bounded numeric index */
      const vb = values[b]!;
      const diff = va - vb;
      return diff * diff;
    };
  }
  // ordinal: Krippendorff 2011 §C2.
  //   δ²(a, b) = ( (n_a + n_b) / 2 + Σ_{g strictly between a and b} n_g )²
  return (a, b) => {
    if (a === b) return 0;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    let mid = 0;
    /* eslint-disable security/detect-object-injection -- bounded numeric indices into local array */
    for (let g = lo + 1; g < hi; g += 1) mid += marginals[g]!;
    const halfEnds = (marginals[lo]! + marginals[hi]!) / 2;
    /* eslint-enable security/detect-object-injection */
    const d = mid + halfEnds;
    return d * d;
  };
}

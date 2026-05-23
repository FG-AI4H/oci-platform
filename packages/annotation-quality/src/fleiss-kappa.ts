/**
 * Fleiss' kappa — inter-rater agreement for **N ≥ 2 raters** on a
 * categorical scale, where each item may be rated by a different
 * subset of raters but the count per item is constant.
 *
 *   κ = (P̄ - P̄_e) / (1 - P̄_e)
 *
 *   P̄ is mean per-item agreement;
 *   P̄_e is the chance-expected mean given the overall label distribution.
 *
 * Input is a "rating matrix" — one row per item, one column per
 * category, cells are the **count of raters** who picked that
 * category for that item. Row sums must all equal the same N
 * (raters-per-item).
 *
 * Range: -1 to 1, same interpretation grid as Cohen's κ. Falls back
 * to Cohen's κ behaviour when N = 2 and one rater per item.
 *
 * Reference: Fleiss, J.L. (1971) "Measuring nominal scale agreement
 * among many raters", Psychological Bulletin, 76(5), 378-382.
 */

export interface FleissKappaResult {
  /** κ statistic in [-1, 1]. NaN when raters' overall distribution is degenerate. */
  kappa: number;
  /** Mean per-item agreement P̄. */
  meanAgreement: number;
  /** Chance-expected mean agreement P̄_e. */
  expectedAgreement: number;
  /** Number of items (rows). */
  nItems: number;
  /** Raters per item (constant; first-row sum). */
  ratersPerItem: number;
  /** Number of categories (columns). */
  nCategories: number;
}

export function fleissKappa(matrix: ReadonlyArray<ReadonlyArray<number>>): FleissKappaResult {
  if (matrix.length === 0) {
    throw new RangeError('fleissKappa: matrix must contain at least one item');
  }
  const nItems = matrix.length;
  const firstRow = matrix[0] ?? [];
  const nCategories = firstRow.length;
  if (nCategories < 2) {
    throw new RangeError('fleissKappa: matrix must have at least two categories (columns)');
  }

  // Validate cells first (per-cell invariants), THEN aggregate sums
  // and check raters-per-item. Otherwise a row of fractional cells
  // produces a misleading "fewer than two raters" error before the
  // real "non-integer" problem surfaces.
  const rowSums = new Array<number>(nItems).fill(0);
  for (let i = 0; i < nItems; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- bounded loop index
    const row = matrix[i] ?? [];
    if (row.length !== nCategories) {
      throw new RangeError(
        `fleissKappa: row ${i} has ${row.length} categories, expected ${nCategories}`,
      );
    }
    let sum = 0;
    for (const c of row) {
      if (!Number.isFinite(c) || c < 0 || !Number.isInteger(c)) {
        throw new RangeError(`fleissKappa: row ${i} has non-integer / negative cell ${c}`);
      }
      sum += c;
    }
    // eslint-disable-next-line security/detect-object-injection -- typed loop index
    rowSums[i] = sum;
  }

  const ratersPerItem = rowSums[0] ?? 0;
  if (ratersPerItem < 2) {
    throw new RangeError('fleissKappa: each item must be rated by at least two raters');
  }
  for (let i = 1; i < nItems; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- typed loop index
    const sum = rowSums[i];
    if (sum !== ratersPerItem) {
      throw new RangeError(
        `fleissKappa: row ${i} sums to ${sum}, expected ${ratersPerItem} (raters-per-item)`,
      );
    }
  }

  // Per-item agreement Pi.
  //   Pi = (1 / (n*(n-1))) * sum_j (n_ij^2 - n_ij)
  let sumPi = 0;
  for (let i = 0; i < nItems; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- bounded loop index
    const row = matrix[i] ?? [];
    let s = 0;
    for (const c of row) s += c * c - c;
    sumPi += s / (ratersPerItem * (ratersPerItem - 1));
  }
  const meanAgreement = sumPi / nItems;

  // Marginal proportion per category.
  //   pj = (1 / (N*n)) * sum_i n_ij
  const totalRatings = nItems * ratersPerItem;
  const colTotals = new Array<number>(nCategories).fill(0);
  for (const row of matrix) {
    for (let j = 0; j < nCategories; j += 1) {
      // eslint-disable-next-line security/detect-object-injection -- typed bounded indices
      colTotals[j] = (colTotals[j] ?? 0) + (row[j] ?? 0);
    }
  }
  let expectedAgreement = 0;
  for (const total of colTotals) {
    const pj = total / totalRatings;
    expectedAgreement += pj * pj;
  }

  const denom = 1 - expectedAgreement;
  const kappa = denom === 0 ? Number.NaN : (meanAgreement - expectedAgreement) / denom;

  return {
    kappa,
    meanAgreement,
    expectedAgreement,
    nItems,
    ratersPerItem,
    nCategories,
  };
}

/**
 * Convenience helper: convert a "long" representation
 *   `ratings[itemIndex] = string[]`  (one ratings list per item)
 * into the Fleiss matrix expected by `fleissKappa`. All items must
 * have the same number of raters; missing categories from one item
 * but present elsewhere are zero-filled.
 */
export function buildFleissMatrix(ratings: ReadonlyArray<ReadonlyArray<string>>): {
  matrix: number[][];
  categories: string[];
} {
  if (ratings.length === 0) {
    throw new RangeError('buildFleissMatrix: at least one item is required');
  }
  const ratersPerItem = ratings[0]?.length ?? 0;
  for (const [i, row] of ratings.entries()) {
    if (row.length !== ratersPerItem) {
      throw new RangeError(
        `buildFleissMatrix: item ${i} has ${row.length} raters, expected ${ratersPerItem}`,
      );
    }
  }
  const set = new Set<string>();
  for (const row of ratings) for (const v of row) set.add(v);
  const categories = Array.from(set).sort();
  const idx = new Map(categories.map((c, i) => [c, i]));
  const matrix: number[][] = ratings.map(() => new Array<number>(categories.length).fill(0));
  for (const [i, row] of ratings.entries()) {
    // eslint-disable-next-line security/detect-object-injection -- bounded by .entries()
    const out = matrix[i];
    if (!out) continue;
    for (const v of row) {
      const j = idx.get(v);
      if (j === undefined) continue;
      // eslint-disable-next-line security/detect-object-injection -- typed index from Map
      out[j] = (out[j] ?? 0) + 1;
    }
  }
  return { matrix, categories };
}

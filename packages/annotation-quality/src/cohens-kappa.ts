/**
 * Cohen's kappa — inter-rater agreement for **two raters** on a
 * categorical scale.
 *
 *   κ = (p_o - p_e) / (1 - p_e)
 *
 * where p_o is the observed agreement and p_e is the agreement
 * expected by chance given each rater's marginal distribution.
 *
 * Range: -1 to 1. Conventional interpretation (Landis & Koch 1977,
 * not endorsed by ADR-0008 — campaigns set their own thresholds):
 *   < 0     poor       (worse than chance)
 *   0-0.2   slight
 *   0.2-0.4 fair
 *   0.4-0.6 moderate
 *   0.6-0.8 substantial
 *   0.8-1.0 almost perfect
 *
 * Reference: Cohen J. (1960) "A coefficient of agreement for nominal
 * scales", Educational and Psychological Measurement, 20(1), 37-46.
 *
 * For N > 2 raters use Fleiss' kappa (./fleiss-kappa.ts).
 */

export interface CohensKappaResult {
  /** κ statistic in [-1, 1]. NaN when both raters are constant + agree (no variance). */
  kappa: number;
  /** Observed agreement p_o (fraction of items where both raters chose the same label). */
  observedAgreement: number;
  /** Chance-expected agreement p_e given each rater's marginals. */
  expectedAgreement: number;
  /** Number of items scored. */
  n: number;
  /** Distinct labels observed across both raters. */
  categories: readonly string[];
}

export function cohensKappa(
  raterA: readonly string[],
  raterB: readonly string[],
): CohensKappaResult {
  if (raterA.length !== raterB.length) {
    throw new RangeError(
      `cohensKappa: rater arrays must be the same length (got ${raterA.length} vs ${raterB.length})`,
    );
  }
  if (raterA.length === 0) {
    throw new RangeError('cohensKappa: at least one item is required');
  }
  const n = raterA.length;

  // Collect categories. Sort so the result is deterministic across calls.
  const set = new Set<string>();
  for (const v of raterA) set.add(v);
  for (const v of raterB) set.add(v);
  const categories = Array.from(set).sort();

  // Observed agreement — zip the two arrays and count matches.
  let agree = 0;
  for (const [i, a] of raterA.entries()) {
    // eslint-disable-next-line security/detect-object-injection -- bounded by .entries()
    if (a === raterB[i]) agree += 1;
  }
  const observedAgreement = agree / n;

  // Marginal distributions.
  const marginalsA = new Map<string, number>();
  const marginalsB = new Map<string, number>();
  for (const v of raterA) marginalsA.set(v, (marginalsA.get(v) ?? 0) + 1);
  for (const v of raterB) marginalsB.set(v, (marginalsB.get(v) ?? 0) + 1);

  // Chance-expected agreement.
  let expectedAgreement = 0;
  for (const c of categories) {
    const pA = (marginalsA.get(c) ?? 0) / n;
    const pB = (marginalsB.get(c) ?? 0) / n;
    expectedAgreement += pA * pB;
  }

  const denom = 1 - expectedAgreement;
  const kappa = denom === 0 ? Number.NaN : (observedAgreement - expectedAgreement) / denom;

  return { kappa, observedAgreement, expectedAgreement, n, categories };
}

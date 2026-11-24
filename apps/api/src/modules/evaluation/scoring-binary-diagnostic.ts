/**
 * Diagnostic-accuracy scoring for one binary finding (#650, ADR-0020
 * amendment of 2026-11-22) — pure functions, no NestJS / Prisma deps, same
 * contract style as `scoring.ts` and `scoring-classification.ts`.
 *
 * A clinician or a health authority reads a diagnostic model through the four
 * confusion counts and what follows from them: sensitivity, specificity, the
 * positive and negative predictive values, each with an interval. Label 1 is
 * the finding present (the task's "positive class", named in words in its
 * configuration); label 0 is the finding absent.
 *
 * INTERVALS. Every proportion carries a Wilson score 95% interval (Wilson
 * 1927; recommended over the Wald interval by Newcombe 1998 and by Brown, Cai
 * & DasGupta 2001 because it stays inside [0, 1] and keeps its coverage at the
 * small counts and extreme proportions a clinical evaluation split produces).
 *
 * AUC. Reported only when every scored item carries a `score` in [0, 1]: the
 * area under the ROC curve is a property of a ranking, and a ranking with
 * holes is not one. Computed as the Mann-Whitney statistic (ties count one
 * half). Its 95% interval is a percentile bootstrap, stratified by reference
 * class (the positives and the negatives are resampled separately, so every
 * resample has both), with a fixed seed and a fixed number of resamples, so
 * the same file always gets the same interval.
 *
 * Metrics are computed over the INTERSECTION of the predicted items with the
 * ground truth; `coverage` reports how much of the ground truth that is.
 * Estimates and bounds are rounded to 4 decimals.
 *
 * SEALED RUNS. A sealed container's output contract is unchanged by this kind
 * (`SealedRunResultSchema.predictions` is still `itemId -> integer`), so a
 * sealed run of a binary task is scored without AUC. A per-item real number is
 * a far wider channel out of the sandbox than a 0/1 label (#414); it is not
 * added to that path without a review of its own.
 */

/* eslint-disable security/detect-object-injection --
 * Every computed member access below indexes a locally-constructed typed array
 * with a bounded numeric loop counter, or reads a record with an item id taken
 * from that same record's own keys (or from the ground truth's keys after a
 * hasOwnProperty check). No user-controlled key reaches a prototype. */

import { ScoringError } from './scoring.js';

/** Two-sided 95%: the 0.975 quantile of the standard normal distribution. */
export const Z_95 = 1.959963984540054;

/** Resamples behind the AUC interval. Fixed, so the interval is reproducible. */
export const AUC_BOOTSTRAP_RESAMPLES = 2000;

/**
 * Work budget for the bootstrap, in item-resamples: 2,000 resamples of up to
 * 10,000 scored items. Scoring runs inside the request, and each resample is
 * one pass over the items, so an unbounded bootstrap at the 100,000-item cap
 * would hold the API's event loop for several seconds (about 3.5 s measured).
 * Above 10,000 items the number of resamples shrinks to stay within the
 * budget, never below `AUC_BOOTSTRAP_MIN_RESAMPLES`; the count actually used
 * is reported with the result, and is still a function of the item count
 * alone, so the same file still gets the same interval.
 */
export const AUC_BOOTSTRAP_BUDGET = 2000 * 10_000;

/** Floor on resamples when the budget applies (about 350 ms at 100,000 items). */
export const AUC_BOOTSTRAP_MIN_RESAMPLES = 200;

/** Resamples for a scored set of `n` items, under the budget. */
export function aucResamplesFor(n: number): number {
  if (n <= 0) return AUC_BOOTSTRAP_RESAMPLES;
  return Math.max(
    AUC_BOOTSTRAP_MIN_RESAMPLES,
    Math.min(AUC_BOOTSTRAP_RESAMPLES, Math.floor(AUC_BOOTSTRAP_BUDGET / n)),
  );
}

/** Seed of the AUC bootstrap. Fixed, so the interval is reproducible. */
export const AUC_BOOTSTRAP_SEED = 650;

/** A proportion with its Wilson 95% interval. */
export interface ProportionEstimate {
  /** numerator / denominator. */
  estimate: number;
  /** Lower bound of the Wilson 95% interval. */
  lower: number;
  /** Upper bound of the Wilson 95% interval. */
  upper: number;
  numerator: number;
  denominator: number;
}

/** AUC with its bootstrap 95% interval, and how that interval was made. */
export interface AucEstimate {
  estimate: number;
  lower: number;
  upper: number;
  /** Bootstrap resamples behind the interval. */
  resamples: number;
  /** Seed of the bootstrap's pseudo-random generator. */
  seed: number;
}

/**
 * Metrics for one binary finding. A proportion is `null` when its denominator
 * is zero (sensitivity with no reference positive among the scored items, for
 * example): it is not estimable, which is a different fact from 0%.
 */
export interface BinaryDiagnosticScores {
  /** Reference 1, predicted 1. */
  truePositives: number;
  /** Reference 0, predicted 1. */
  falsePositives: number;
  /** Reference 0, predicted 0. */
  trueNegatives: number;
  /** Reference 1, predicted 0. */
  falseNegatives: number;
  /** Share of scored items whose reference label is 1. */
  prevalence: ProportionEstimate | null;
  /** TP / (TP + FN): of the items with the finding, the share flagged. */
  sensitivity: ProportionEstimate | null;
  /** TN / (TN + FP): of the items without it, the share cleared. */
  specificity: ProportionEstimate | null;
  /** TP / (TP + FP): of the items flagged, the share that have it. */
  positivePredictiveValue: ProportionEstimate | null;
  /** TN / (TN + FN): of the items cleared, the share that do not have it. */
  negativePredictiveValue: ProportionEstimate | null;
  /** (TP + TN) / scored items. */
  accuracy: ProportionEstimate | null;
  /**
   * Mean of sensitivity and specificity; `null` when either is not estimable
   * (not 0: a file that got every positive right on a set with no negatives
   * has not scored zero). The number results are ordered by: unlike accuracy
   * it is not carried by the majority class, and unlike either rate alone it
   * cannot be maximised by flagging everything or nothing.
   */
  balancedAccuracy: number | null;
  /** `null` unless every scored item carried a score and both classes occur. */
  auc: AucEstimate | null;
  /** matched / |groundTruth|. */
  coverage: number;
}

export interface BinaryDiagnosticScoringInput {
  /** HIDDEN ground truth: itemId -> 0 or 1. */
  groundTruth: Record<string, number>;
  /** Submission labels: itemId -> 0 or 1. */
  predictions: Record<string, number>;
  /** Optional submission scores: itemId -> real number in [0, 1]. */
  itemScores?: Record<string, number>;
}

/** Round to 4 decimals; `-0` is normalised to `0`. */
function round4(x: number): number {
  const r = Math.round(x * 10000) / 10000;
  return r === 0 ? 0 : r;
}

/**
 * Wilson score interval for `successes` out of `total`, unrounded. Exported
 * for its own unit tests against published values.
 */
export function wilsonInterval(
  successes: number,
  total: number,
  z: number = Z_95,
): { lower: number; upper: number } {
  if (!Number.isInteger(total) || total <= 0) {
    throw new RangeError(`wilsonInterval: total must be a positive integer, got ${total}`);
  }
  if (!Number.isInteger(successes) || successes < 0 || successes > total) {
    throw new RangeError(`wilsonInterval: successes must be an integer in [0, ${total}]`);
  }
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  // At 0 and at `total` the bounds are 0 and 1 exactly; clamping removes the
  // floating-point residue that would otherwise print as -0.0000 or 1.0000…1.
  return {
    lower: successes === 0 ? 0 : Math.max(0, centre - half),
    upper: successes === total ? 1 : Math.min(1, centre + half),
  };
}

/**
 * A proportion with its Wilson 95% interval, rounded as stored; null when the
 * denominator is 0. Exported so the evidence summary (#652) derives the
 * diagnostic measures of a two-class result with this same function.
 */
export function proportion(numerator: number, denominator: number): ProportionEstimate | null {
  if (denominator === 0) return null;
  const { lower, upper } = wilsonInterval(numerator, denominator);
  return {
    estimate: round4(numerator / denominator),
    lower: round4(lower),
    upper: round4(upper),
    numerator,
    denominator,
  };
}

function assertBinaryLabel(label: number, where: string, itemId: string): void {
  if (label !== 0 && label !== 1) {
    throw new ScoringError(
      `Invalid ${where} label for item "${itemId}": expected 0 (finding absent) or 1 (finding present), got ${String(label)}`,
    );
  }
}

/**
 * Mulberry32: a small, well-mixed 32-bit generator. Used only to make the
 * bootstrap reproducible — nothing here needs cryptographic randomness.
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

/**
 * Weighted Mann-Whitney AUC over items pre-sorted by score ascending. `weight`
 * is how many times each item is counted (all 1 for the plain estimate, the
 * bootstrap draw counts for a resample). One pass over the sorted items: for
 * each group of tied scores, every positive in it beats the negatives below
 * the group and ties with the negatives inside it.
 */
function weightedAuc(
  sortedScores: Float64Array,
  sortedIsPositive: Uint8Array,
  weight: Float64Array,
): number {
  let negBelow = 0;
  let wins = 0;
  let posTotal = 0;
  let negTotal = 0;
  const n = sortedScores.length;
  let i = 0;
  while (i < n) {
    let j = i;
    let posInGroup = 0;
    let negInGroup = 0;
    while (j < n && sortedScores[j] === sortedScores[i]) {
      if (sortedIsPositive[j] === 1) posInGroup += weight[j]!;
      else negInGroup += weight[j]!;
      j += 1;
    }
    wins += posInGroup * (negBelow + negInGroup / 2);
    negBelow += negInGroup;
    posTotal += posInGroup;
    negTotal += negInGroup;
    i = j;
  }
  return wins / (posTotal * negTotal);
}

/** Linear-interpolation quantile of an ascending-sorted array (type 7). */
function quantileSorted(sorted: Float64Array, q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * AUC and its stratified percentile-bootstrap 95% interval. `scores` and
 * `isPositive` are aligned arrays over the scored items, in a deterministic
 * order (the caller sorts by item id), which together with the fixed seed is
 * what makes the interval reproducible.
 */
export function aucWithBootstrap(
  scores: readonly number[],
  isPositive: readonly boolean[],
  resamples: number = aucResamplesFor(scores.length),
  seed: number = AUC_BOOTSTRAP_SEED,
): AucEstimate | null {
  const n = scores.length;
  const positives: number[] = [];
  const negatives: number[] = [];
  for (let k = 0; k < n; k++) (isPositive[k] ? positives : negatives).push(k);
  if (positives.length === 0 || negatives.length === 0) return null;

  // Sort once by score; a resample only changes how often each item counts.
  const order = Array.from({ length: n }, (_, k) => k).sort(
    (a, b) => scores[a]! - scores[b]! || a - b,
  );
  const sortedScores = new Float64Array(n);
  const sortedIsPositive = new Uint8Array(n);
  const rankOf = new Int32Array(n);
  order.forEach((original, sortedIndex) => {
    sortedScores[sortedIndex] = scores[original]!;
    sortedIsPositive[sortedIndex] = isPositive[original] ? 1 : 0;
    rankOf[original] = sortedIndex;
  });

  const ones = new Float64Array(n).fill(1);
  const estimate = weightedAuc(sortedScores, sortedIsPositive, ones);

  const random = mulberry32(seed);
  const weight = new Float64Array(n);
  const replicates = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    weight.fill(0);
    // Stratified: as many positives and as many negatives as the original.
    for (let k = 0; k < positives.length; k++) {
      const pick = positives[Math.floor(random() * positives.length)]!;
      weight[rankOf[pick]!] = weight[rankOf[pick]!]! + 1;
    }
    for (let k = 0; k < negatives.length; k++) {
      const pick = negatives[Math.floor(random() * negatives.length)]!;
      weight[rankOf[pick]!] = weight[rankOf[pick]!]! + 1;
    }
    replicates[r] = weightedAuc(sortedScores, sortedIsPositive, weight);
  }
  replicates.sort();

  return {
    estimate: round4(estimate),
    lower: round4(quantileSorted(replicates, 0.025)),
    upper: round4(quantileSorted(replicates, 0.975)),
    resamples,
    seed,
  };
}

/** Score one binary-finding submission. Throws `ScoringError` on a bad label or score. */
export function scoreBinaryDiagnostic(input: BinaryDiagnosticScoringInput): BinaryDiagnosticScores {
  const groundTruthIds = Object.keys(input.groundTruth);
  const itemScores = input.itemScores ?? {};

  for (const [itemId, label] of Object.entries(input.predictions)) {
    assertBinaryLabel(label, 'prediction', itemId);
  }
  for (const itemId of groundTruthIds) {
    assertBinaryLabel(input.groundTruth[itemId]!, 'ground-truth', itemId);
  }
  for (const [itemId, score] of Object.entries(itemScores)) {
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      throw new ScoringError(
        `Invalid score for item "${itemId}": expected a number from 0 to 1, got ${String(score)}`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(input.predictions, itemId)) {
      throw new ScoringError(`Score for item "${itemId}" has no label: a score goes with a label`);
    }
  }

  const matchedIds = groundTruthIds
    .filter((id) => Object.prototype.hasOwnProperty.call(input.predictions, id))
    .sort();
  const coverage = groundTruthIds.length === 0 ? 0 : matchedIds.length / groundTruthIds.length;

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const id of matchedIds) {
    const truth = input.groundTruth[id]!;
    const predicted = input.predictions[id]!;
    if (truth === 1) {
      if (predicted === 1) tp += 1;
      else fn += 1;
    } else if (predicted === 1) fp += 1;
    else tn += 1;
  }
  const n = matchedIds.length;

  const sensitivity = proportion(tp, tp + fn);
  const specificity = proportion(tn, tn + fp);
  const balancedAccuracy =
    sensitivity && specificity ? round4((tp / (tp + fn) + tn / (tn + fp)) / 2) : null;

  // AUC only when the ranking is complete over the scored items.
  const everyScored =
    n > 0 && matchedIds.every((id) => Object.prototype.hasOwnProperty.call(itemScores, id));
  const auc = everyScored
    ? aucWithBootstrap(
        matchedIds.map((id) => itemScores[id]!),
        matchedIds.map((id) => input.groundTruth[id] === 1),
      )
    : null;

  return {
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    prevalence: proportion(tp + fn, n),
    sensitivity,
    specificity,
    positivePredictiveValue: proportion(tp, tp + fp),
    negativePredictiveValue: proportion(tn, tn + fn),
    accuracy: proportion(tp + tn, n),
    balancedAccuracy,
    auc,
    coverage: round4(coverage),
  };
}

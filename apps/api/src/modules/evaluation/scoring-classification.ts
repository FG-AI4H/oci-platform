/**
 * Nominal multi-class scoring (WP10, issue #428) — pure functions, no NestJS /
 * Prisma deps, same contract style as `scoring.ts`.
 *
 * `GRADING` treats labels as an ORDINAL scale, so its headline metric is
 * quadratic-weighted kappa: predicting 3 when the truth is 4 is a smaller error
 * than predicting 0. `CLASSIFICATION` treats labels as NOMINAL categories,
 * where every confusion is equally wrong, so agreement metrics that weight by
 * distance are meaningless and per-class precision/recall is what matters.
 *
 * Same payload shape as grading (`itemId -> integer label`), which is why this
 * kind adds no fields to the sealed-run output path and therefore no new
 * exfiltration surface (#414).
 *
 * Metrics are computed over the INTERSECTION of the two item sets; `coverage`
 * reports how much of the ground truth that intersection represents. Every
 * returned number is rounded to 4 decimals.
 */

/* eslint-disable security/detect-object-injection --
 * As in `scoring.ts`: every computed member access below indexes a
 * locally-constructed confusion matrix or counter array with a bounded numeric
 * loop counter or a validated integer class label — never a user-controlled
 * string key. */

import { ScoringError } from './scoring.js';

/** Per-class precision / recall / F1 and the class's ground-truth support. */
export interface ClassMetrics {
  /** Class label (0..numClasses-1). */
  label: number;
  /** TP / (TP + FP). 0 when the class was never predicted. */
  precision: number;
  /** TP / (TP + FN). 0 when the class has no ground-truth support. */
  recall: number;
  /** Harmonic mean of precision and recall. 0 when both are 0. */
  f1: number;
  /** Number of matched items whose ground-truth label is this class. */
  support: number;
}

/** Metrics for a nominal multi-class task, each rounded to 4 decimals. */
export interface ClassificationScores {
  /** Exact-match rate over the matched set. */
  accuracy: number;
  /**
   * Mean per-class recall, averaged over classes with support > 0. Unlike
   * `accuracy`, this is not inflated by a dominant class — the metric to read
   * when the evaluation split is imbalanced, which clinical splits usually are.
   */
  balancedAccuracy: number;
  /** Mean per-class F1, averaged over classes with support > 0. */
  macroF1: number;
  /**
   * F1 over pooled TP/FP/FN. For single-label tasks this is arithmetically
   * identical to `accuracy`; it is reported because readers expect the pair,
   * not because it carries additional information.
   */
  microF1: number;
  /** Per-class breakdown, ordered by label. Includes zero-support classes. */
  perClass: ClassMetrics[];
  /** matched / |groundTruth| — fraction of the GT set predicted. */
  coverage: number;
}

export interface ClassificationScoringInput {
  /** HIDDEN ground truth: itemId -> integer label. */
  groundTruth: Record<string, number>;
  /** Submission predictions: itemId -> integer label. */
  predictions: Record<string, number>;
  /** Number of classes N (labels are 0..N-1). Default 5. */
  numClasses?: number;
}

/** Round to 4 decimals; `-0` is normalised to `0`. */
function round4(x: number): number {
  const r = Math.round(x * 10000) / 10000;
  return r === 0 ? 0 : r;
}

function assertValidLabel(label: number, numClasses: number, where: string, itemId: string): void {
  if (!Number.isInteger(label) || label < 0 || label >= numClasses) {
    throw new ScoringError(
      `Invalid ${where} label for item "${itemId}": expected an integer in [0, ${numClasses - 1}], got ${String(label)}`,
    );
  }
}

/** Harmonic mean of precision and recall; 0 when both are 0. */
function f1Of(precision: number, recall: number): number {
  const denom = precision + recall;
  return denom === 0 ? 0 : (2 * precision * recall) / denom;
}

/**
 * Score a nominal multi-class submission.
 *
 * Averaging convention: `macroF1` and `balancedAccuracy` average over classes
 * with `support > 0` only. A class absent from the evaluation split would
 * otherwise contribute a forced 0 and drag both metrics down for a reason that
 * has nothing to do with the model — a real hazard here, since hosts hold back
 * modest evaluation splits that may not contain every grade.
 */
export function scoreClassification(input: ClassificationScoringInput): ClassificationScores {
  const numClasses = input.numClasses ?? 5;
  if (!Number.isInteger(numClasses) || numClasses < 2) {
    throw new ScoringError(
      `Invalid numClasses: expected an integer >= 2, got ${String(numClasses)}`,
    );
  }

  const groundTruthIds = Object.keys(input.groundTruth);

  for (const [itemId, label] of Object.entries(input.predictions)) {
    assertValidLabel(label, numClasses, 'prediction', itemId);
  }
  for (const itemId of groundTruthIds) {
    assertValidLabel(input.groundTruth[itemId]!, numClasses, 'ground-truth', itemId);
  }

  const matchedIds = groundTruthIds
    .filter((id) => Object.prototype.hasOwnProperty.call(input.predictions, id))
    .sort();

  const coverage = groundTruthIds.length === 0 ? 0 : matchedIds.length / groundTruthIds.length;

  // Per-class TP / FP / FN over the matched set.
  const tp = new Array<number>(numClasses).fill(0);
  const fp = new Array<number>(numClasses).fill(0);
  const fn = new Array<number>(numClasses).fill(0);
  const support = new Array<number>(numClasses).fill(0);

  let exact = 0;
  for (const id of matchedIds) {
    const t = input.groundTruth[id]!;
    const p = input.predictions[id]!;
    // `!` throughout: every index is a label already validated into
    // [0, numClasses-1] above, and the arrays are locally constructed with
    // exactly numClasses entries — so no access here can be undefined.
    support[t] = support[t]! + 1;
    if (t === p) {
      tp[t] = tp[t]! + 1;
      exact += 1;
    } else {
      fp[p] = fp[p]! + 1;
      fn[t] = fn[t]! + 1;
    }
  }

  const matchedCount = matchedIds.length;
  const accuracy = matchedCount === 0 ? 0 : exact / matchedCount;

  const perClass: ClassMetrics[] = [];
  let recallSum = 0;
  let f1Sum = 0;
  let supportedClasses = 0;

  for (let c = 0; c < numClasses; c++) {
    const tpC = tp[c]!;
    const predicted = tpC + fp[c]!;
    const actual = tpC + fn[c]!;
    const precision = predicted === 0 ? 0 : tpC / predicted;
    const recall = actual === 0 ? 0 : tpC / actual;
    const f1 = f1Of(precision, recall);

    perClass.push({
      label: c,
      precision: round4(precision),
      recall: round4(recall),
      f1: round4(f1),
      support: support[c]!,
    });

    if (actual > 0) {
      recallSum += recall;
      f1Sum += f1;
      supportedClasses += 1;
    }
  }

  const balancedAccuracy = supportedClasses === 0 ? 0 : recallSum / supportedClasses;
  const macroF1 = supportedClasses === 0 ? 0 : f1Sum / supportedClasses;

  // Pooled (micro) F1. For single-label tasks sum(FP) === sum(FN), so micro
  // precision === micro recall === accuracy; kept explicit rather than aliased
  // so the identity is visible instead of assumed.
  const tpTotal = tp.reduce((a, b) => a + b, 0);
  const fpTotal = fp.reduce((a, b) => a + b, 0);
  const fnTotal = fn.reduce((a, b) => a + b, 0);
  const microPrecision = tpTotal + fpTotal === 0 ? 0 : tpTotal / (tpTotal + fpTotal);
  const microRecall = tpTotal + fnTotal === 0 ? 0 : tpTotal / (tpTotal + fnTotal);

  return {
    accuracy: round4(accuracy),
    balancedAccuracy: round4(balancedAccuracy),
    macroF1: round4(macroF1),
    microF1: round4(f1Of(microPrecision, microRecall)),
    perClass,
    coverage: round4(coverage),
  };
}

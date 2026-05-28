import { cohensKappa } from './cohens-kappa.js';
import { diceMulticlass } from './dice.js';

/**
 * IRR-vs-gold scoring (#291, ADR-0009 Decision 4).
 *
 * Each annotator has, for a given campaign, a set of (gold sample,
 * their submission, expected gold label) triples. This function
 * returns a single agreement score in [0, 1] across those triples,
 * using the campaign's configured IRR metric.
 *
 * Semantics:
 *   - For categorical metrics (`fleiss-kappa` / `cohens-kappa`):
 *     pair the annotator's `label` against the gold `label` across
 *     all gold submissions, then run Cohen's κ (the two-rater case
 *     of Fleiss). The result is in [-1, 1]; we clamp to [0, 1] for
 *     the supervisor surface since negative κ is "worse than chance"
 *     and the supervisor inbox just cares about "below threshold".
 *   - For `dice`: compute per-sample Dice on the categorical label
 *     and take the mean. Until segmentation tool integration (#214)
 *     ships actual mask payloads, this works on `label` strings the
 *     same way the gate-1 predicate does.
 *
 * Returns `null` when there are no scoreable pairs (annotator hasn't
 * submitted on any gold sample yet, or some entries lacked usable
 * labels). The supervisor surface renders `—` in that case.
 */

/**
 * Metric vocabulary accepted by `annotatorVsGold`. Tracks the
 * canonical `AnnotationQualityMetric` enum in `@oci/shared-types` so
 * the campaign-side metric choice is passed through verbatim — for
 * vs-gold scoring all the agreement-style metrics collapse to
 * Cohen's κ (one rater vs ground truth), and segmentation-style
 * metrics collapse to per-pair accuracy. Listed here as a literal
 * union to avoid taking a runtime dep on shared-types from this
 * leaf package.
 */
export type AnnotatorVsGoldMetric =
  | 'cohens-kappa'
  | 'fleiss-kappa'
  | 'dice'
  | 'krippendorff-alpha-nominal'
  | 'krippendorff-alpha-ordinal'
  | 'krippendorff-alpha-interval'
  | 'hausdorff'
  | 'hausdorff-95'
  | 'icc-2-1'
  | 'euclidean-agreement';

export interface AnnotatorVsGoldInput {
  metric: AnnotatorVsGoldMetric;
  /** Parallel arrays — annotator's submission + the gold expected label per gold sample. */
  pairs: ReadonlyArray<{
    submission: Record<string, unknown>;
    gold: Record<string, unknown>;
  }>;
}

export interface AnnotatorVsGoldResult {
  /** Agreement score in [0, 1], or null if nothing comparable. */
  score: number | null;
  /** How many of the input pairs contributed (after label-extraction filter). */
  scored: number;
}

export function annotatorVsGold(input: AnnotatorVsGoldInput): AnnotatorVsGoldResult {
  const labelPairs = input.pairs
    .map((p) => ({
      submission: extractLabel(p.submission),
      gold: extractLabel(p.gold),
    }))
    .filter(
      (p): p is { submission: string; gold: string } => p.submission !== null && p.gold !== null,
    );

  if (labelPairs.length === 0) {
    return { score: null, scored: 0 };
  }

  const subs = labelPairs.map((p) => p.submission);
  const golds = labelPairs.map((p) => p.gold);

  // Segmentation / spatial / continuous-quantity metrics all collapse
  // to per-pair accuracy on the extracted `label` string for vs-gold
  // scoring — `extractLabel` already reduced the submission to a
  // single string, so Dice / Hausdorff / ICC / Euclidean degenerate
  // to "1 if labels match, 0 otherwise" macro-averaged. Spatial
  // payload comparison lands once #214 + #218 wire the structured
  // submission shape through.
  if (
    input.metric === 'dice' ||
    input.metric === 'hausdorff' ||
    input.metric === 'hausdorff-95' ||
    input.metric === 'icc-2-1' ||
    input.metric === 'euclidean-agreement'
  ) {
    let agree = 0;
    for (let i = 0; i < subs.length; i += 1) {
      // eslint-disable-next-line security/detect-object-injection -- bounded loop
      if (subs[i] === golds[i]) agree += 1;
    }
    return { score: agree / labelPairs.length, scored: labelPairs.length };
  }

  // Categorical / ordinal metrics (Cohen / Fleiss / Krippendorff) all
  // reduce to Cohen's κ for one rater vs ground truth — Fleiss
  // reduces to Cohen for two raters, and Krippendorff matches
  // Cohen on the nominal case. Result clamped to [0, 1] for the
  // supervisor surface.
  const k = cohensKappa(subs, golds);
  if (!Number.isFinite(k.kappa)) {
    // Degenerate: zero variance in the gold marginal (every gold
    // sample carries the same label). Fall back to accuracy.
    let agree = 0;
    for (let i = 0; i < subs.length; i += 1) {
      // eslint-disable-next-line security/detect-object-injection -- bounded loop
      if (subs[i] === golds[i]) agree += 1;
    }
    return { score: agree / labelPairs.length, scored: labelPairs.length };
  }
  const clamped = Math.max(0, Math.min(1, k.kappa));
  return { score: clamped, scored: labelPairs.length };
}

// Re-use the same "label" extractor as the gate-1 predicate so the
// shapes stay aligned. Empty or non-string labels disqualify the pair.
function extractLabel(payload: Record<string, unknown>): string | null {
  const value = payload.label;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// `diceMulticlass` re-export keeps the segmentation API consistent
// once #214 + #290 land — the gate-1 predicate already exports it
// from `./dice.js`; this is a no-op alias for clarity inside the
// quality package's surface.
export { diceMulticlass };

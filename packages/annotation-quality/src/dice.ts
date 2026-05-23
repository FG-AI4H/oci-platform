/**
 * Sørensen-Dice coefficient — overlap metric for two segmentation
 * masks (or any two binary / multi-class label sets).
 *
 *   Dice = 2 * |A ∩ B| / (|A| + |B|)
 *
 * Range: 0 (no overlap) to 1 (identical). Symmetric. Empty-empty by
 * convention returns 1 (two "no finding" masks agree completely).
 *
 * Two surfaces:
 *   - `diceFromIndexSets` — masks expressed as sets of "positive
 *     pixel" indices (or any opaque IDs). Convenient for sparse
 *     annotations.
 *   - `diceFromBinaryMasks` — masks expressed as parallel flat
 *     0/1 arrays. Convenient when masks are dense rasters.
 *   - `diceMulticlass` — per-class Dice averaged either uniformly
 *     (macro) or weighted by class size (micro). Returns the
 *     per-class breakdown too so the supervisor inbox can render it.
 *
 * Reference: Dice, L.R. (1945) "Measures of the amount of ecological
 * association between species", Ecology 26(3), 297-302.
 *
 * Recommended in Metrics Reloaded (Maier-Hein et al., Nat Methods
 * 2024) as a region-overlap metric for segmentation tasks; the
 * companion Hausdorff distance lands in #290.
 */

export interface DiceMulticlassResult {
  /** Per-class Dice score, 0 to 1. NaN when the class is absent from both masks. */
  perClass: Record<string, number>;
  /** Mean of `perClass` (uniform weight, "macro" averaging). */
  macroDice: number;
  /** Class-size-weighted mean — heavier classes dominate ("micro" averaging). */
  microDice: number;
}

export function diceFromIndexSets(a: ReadonlySet<unknown>, b: ReadonlySet<unknown>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const v of a) {
    if (b.has(v)) intersection += 1;
  }
  return (2 * intersection) / (a.size + b.size);
}

export function diceFromBinaryMasks(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  if (a.length !== b.length) {
    throw new RangeError(
      `diceFromBinaryMasks: masks must be the same length (got ${a.length} vs ${b.length})`,
    );
  }
  let inter = 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < a.length; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- bounded loop index
    const ai = a[i] ? 1 : 0;
    // eslint-disable-next-line security/detect-object-injection -- bounded loop index
    const bi = b[i] ? 1 : 0;
    if (ai && bi) inter += 1;
    sumA += ai;
    sumB += bi;
  }
  if (sumA === 0 && sumB === 0) return 1;
  return (2 * inter) / (sumA + sumB);
}

/**
 * Per-class Dice over two label arrays. `a[i]` / `b[i]` are the
 * class IDs (or labels — strings work) assigned to pixel/sample `i`
 * by each rater. A class absent from BOTH masks gets a NaN per-class
 * score and is excluded from the macro / micro means.
 */
export function diceMulticlass(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): DiceMulticlassResult {
  if (a.length !== b.length) {
    throw new RangeError(
      `diceMulticlass: arrays must be the same length (got ${a.length} vs ${b.length})`,
    );
  }
  const classes = new Set<string>();
  for (const v of a) classes.add(v);
  for (const v of b) classes.add(v);

  const perClass: Record<string, number> = {};
  let macroSum = 0;
  let macroCount = 0;
  let microInter = 0;
  let microSum = 0;
  for (const cls of classes) {
    let inter = 0;
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < a.length; i += 1) {
      // eslint-disable-next-line security/detect-object-injection -- bounded index
      const ai = a[i] === cls;
      // eslint-disable-next-line security/detect-object-injection -- bounded index
      const bi = b[i] === cls;
      if (ai && bi) inter += 1;
      if (ai) sa += 1;
      if (bi) sb += 1;
    }
    if (sa === 0 && sb === 0) {
      // eslint-disable-next-line security/detect-object-injection -- class key from local set
      perClass[cls] = Number.NaN;
      continue;
    }
    const dice = (2 * inter) / (sa + sb);
    // eslint-disable-next-line security/detect-object-injection -- class key from local set
    perClass[cls] = dice;
    macroSum += dice;
    macroCount += 1;
    microInter += inter;
    microSum += sa + sb;
  }

  return {
    perClass,
    macroDice: macroCount === 0 ? Number.NaN : macroSum / macroCount,
    microDice: microSum === 0 ? Number.NaN : (2 * microInter) / microSum,
  };
}

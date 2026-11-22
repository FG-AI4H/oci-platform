/**
 * Small-cell suppression for results by subgroup (#410, ADR-0030). Pure.
 *
 * WHAT IT PROTECTS. A published subgroup result is a statement about a group
 * of patients in a host's evaluation set: "of the 3 women aged 80 or over, 2
 * were missed". With few people in a group, such a statement can point at
 * individuals. The rule applied here is the CMS cell size suppression policy:
 * no count from 1 to 10 may be shown, AND none may be derivable from the
 * figures that are shown. Zero may be shown.
 *
 * THE SECOND HALF IS THE ONE THAT IS EASY TO MISS. A field partitions the
 * task's items, and the aggregate result is published next to it. If exactly
 * one group is withheld, its figure is the total minus the others. So after
 * the small groups are withheld (primary suppression), further groups are
 * withheld (complementary suppression) until the withheld groups together
 * hold either nothing or at least the threshold: what can be worked out from
 * the total is then only a figure for a set of at least that many items, which
 * is exactly what the rule allows to be published.
 *
 * The same holds for any count that a published rate rests on (positives,
 * negatives, file labels): each is a column whose total the aggregate result
 * publishes, so each gets the same treatment, over the same set of groups.
 */

/* eslint-disable security/detect-object-injection --
 * Every computed member access below indexes a locally built array with a
 * bounded numeric loop counter. No string key reaches an index. */

/**
 * Withhold further entries until, for every dimension, the withheld entries
 * hold zero or at least `min` in that dimension.
 *
 * @param withheld  Initial mask, one flag per group (primary suppression).
 * @param counts    `counts[group][dimension]`: the counts a published figure
 *                  of that group rests on, one per dimension.
 * @param min       Smallest publishable count (11 under the CMS rule).
 * @returns         The final mask. The input mask is not modified.
 *
 * The group added is the one with the smallest non-zero count in the
 * dimension being repaired (ties: the earlier one), so the least information
 * is withheld; a group with zero in that dimension cannot repair it and is
 * not chosen. When no group can repair a dimension, every group that could
 * has been withheld already, and the loop stops: what remains derivable is
 * the overall total, which the aggregate result publishes anyway.
 */
export function complementarySuppression(
  withheld: readonly boolean[],
  counts: readonly (readonly number[])[],
  min: number,
): boolean[] {
  const mask = [...withheld];
  const dimensions = counts[0]?.length ?? 0;
  for (let changed = true; changed; ) {
    changed = false;
    for (let d = 0; d < dimensions; d++) {
      for (;;) {
        let sum = 0;
        for (let g = 0; g < mask.length; g++) if (mask[g]) sum += counts[g]?.[d] ?? 0;
        if (sum === 0 || sum >= min) break;
        let pick = -1;
        for (let g = 0; g < mask.length; g++) {
          const c = counts[g]?.[d] ?? 0;
          if (mask[g] || c === 0) continue;
          if (pick === -1 || c < (counts[pick]?.[d] ?? 0)) pick = g;
        }
        if (pick === -1) break;
        mask[pick] = true;
        changed = true;
      }
    }
  }
  return mask;
}

/** True for a count that may not be published on its own: from 1 to `min - 1`. */
export function isSmallCount(count: number, min: number): boolean {
  return count > 0 && count < min;
}

/**
 * Which groups of one field are withheld outright.
 *
 * A group is withheld when fewer than `min` of its items were scored: its
 * figures would rest on too few. A group with no scored item has no figure at
 * all and is withheld too.
 *
 * Two counts per group are published for a reported one, and both have a
 * published total: the scored items (the aggregate result rests on their sum)
 * and the task's items (the task's item count). Both are complemented. The
 * second matters even when the first does not: a group of 5 items that a file
 * left unlabelled has 0 scored items, which forces nothing out on its own,
 * yet its 5 would be the task's item count minus the other groups'.
 */
export function suppressGroups(
  scoredCounts: readonly number[],
  itemCounts: readonly number[],
  min: number,
): boolean[] {
  return complementarySuppression(
    scoredCounts.map((c) => c < min),
    scoredCounts.map((c, g) => [c, itemCounts[g] ?? 0]),
    min,
  );
}

/**
 * Which groups have their rates withheld, given the groups withheld outright
 * and, per group, the denominators the rates rest on. A group's rates are
 * withheld together when any denominator is small, and then complemented
 * across groups per denominator.
 */
export function suppressRates(
  groupWithheld: readonly boolean[],
  denominators: readonly (readonly number[])[],
  min: number,
): boolean[] {
  return complementarySuppression(
    groupWithheld.map((w, g) => w || (denominators[g] ?? []).some((c) => isSmallCount(c, min))),
    denominators,
    min,
  );
}

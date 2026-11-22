/* eslint-disable security/detect-object-injection --
 * Test fixtures: arrays indexed by loop counters and records keyed by the
 * fixture's own item ids. */
import { describe, expect, it } from 'vitest';

import {
  complementarySuppression,
  isSmallCount,
  suppressGroups,
  suppressRates,
} from './subgroup-suppression.js';

const N = 11;

/**
 * What a reader can work out from what is published: the total of a dimension
 * minus the published groups. The rule holds when that remainder is 0 or at
 * least N, for every dimension.
 */
function derivableRemainders(counts: number[][], withheld: boolean[]): number[] {
  const dims = counts[0]?.length ?? 0;
  return Array.from({ length: dims }, (_, d) =>
    counts.reduce((sum, row, g) => sum + (withheld[g] ? (row[d] ?? 0) : 0), 0),
  );
}

describe('isSmallCount', () => {
  it('is true from 1 to 10 and false for 0 and 11 (CMS: zero may be shown)', () => {
    expect([0, 1, 10, 11, 200].map((c) => isSmallCount(c, N))).toEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('suppressGroups — primary suppression', () => {
  it('publishes every group of 11 or more', () => {
    expect(suppressGroups([67, 66, 67], [67, 66, 67], N)).toEqual([false, false, false]);
  });

  it('keeps a group of exactly 11 and withholds one of exactly 10', () => {
    expect(suppressGroups([11, 50], [11, 50], N)).toEqual([false, false]);
    // The 10 is withheld, and then one more so that it cannot be worked out.
    expect(suppressGroups([10, 50, 60], [10, 50, 60], N)).toEqual([true, true, false]);
  });

  it('withholds a group with no scored item, and that alone forces nothing else out', () => {
    // The file labelled none of the 40 items of the first group: no figure for it,
    // but its 40 items are a publishable count, so nothing else is withheld.
    expect(suppressGroups([0, 30, 30], [40, 30, 30], N)).toEqual([true, false, false]);
  });
});

describe('suppressGroups — the differencing guard', () => {
  it('withholds a second group when one small group could be worked out from the total', () => {
    // 3 + 40 + 150: published 40 and 150 with the total 193 would give 3.
    const withheld = suppressGroups([3, 40, 150], [3, 40, 150], N);
    expect(withheld).toEqual([true, true, false]);
    for (const r of derivableRemainders([[3], [40], [150]], withheld)) {
      expect(r === 0 || r >= N).toBe(true);
    }
  });

  it('picks the smallest group that repairs it, not the first', () => {
    expect(suppressGroups([4, 90, 12, 50], [4, 90, 12, 50], N)).toEqual([true, false, true, false]);
  });

  it('two small groups that together reach 11 need no third', () => {
    expect(suppressGroups([5, 6, 100], [5, 6, 100], N)).toEqual([true, true, false]);
  });

  it('two small groups that together stay under 11 force a third out', () => {
    expect(suppressGroups([2, 3, 30, 100], [2, 3, 30, 100], N)).toEqual([true, true, true, false]);
  });

  it('complements the task items too: an unlabelled small group cannot be counted', () => {
    // 5 items, none labelled by this file: 0 scored, but its 5 items would be the
    // task's item count minus the other two groups'.
    const withheld = suppressGroups([0, 30, 60], [5, 30, 60], N);
    expect(withheld).toEqual([true, true, false]);
  });

  it('stops when every group is withheld, even if the total stays under 11', () => {
    expect(suppressGroups([2, 3], [2, 3], N)).toEqual([true, true]);
  });

  it('never leaves a derivable remainder from 1 to 10, on random partitions', () => {
    let seed = 410;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let trial = 0; trial < 2000; trial++) {
      const groups = 2 + Math.floor(next() * 6);
      const items = Array.from({ length: groups }, () => Math.floor(next() * 40));
      const scored = items.map((c) => Math.floor(c * next()));
      const withheld = suppressGroups(scored, items, N);
      const counts = scored.map((s, g) => [s, items[g] ?? 0]);
      const remainders = derivableRemainders(counts, withheld);
      const allWithheld = withheld.every(Boolean);
      for (const r of remainders) {
        if (!allWithheld) expect(r === 0 || r >= N, JSON.stringify({ scored, items })).toBe(true);
      }
      scored.forEach((s, g) => {
        if (s < N) expect(withheld[g]).toBe(true);
      });
    }
  });
});

describe('suppressRates', () => {
  it('withholds a group’s rates when one denominator is small, and complements per denominator', () => {
    // [positives, negatives]: group 0 has 4 positives.
    const denominators = [
      [4, 40],
      [30, 30],
      [25, 50],
    ];
    const withheld = suppressRates([false, false, false], denominators, N);
    // 4 positives alone would be the total minus 30 and 25: one more group goes.
    expect(withheld).toEqual([true, false, true]);
    for (const r of derivableRemainders(denominators, withheld)) {
      expect(r === 0 || r >= N).toBe(true);
    }
  });

  it('counts a group withheld outright as withheld for its rates too', () => {
    const withheld = suppressRates(
      [true, false, false],
      [
        [3, 5],
        [30, 30],
        [40, 40],
      ],
      N,
    );
    expect(withheld).toEqual([true, true, false]);
  });

  it('a zero denominator is not small: the rate is not estimable, nothing is withheld', () => {
    expect(
      suppressRates(
        [false, false],
        [
          [0, 40],
          [30, 30],
        ],
        N,
      ),
    ).toEqual([false, false]);
  });
});

describe('complementarySuppression', () => {
  it('does not modify its input mask', () => {
    const mask = [true, false];
    complementarySuppression(mask, [[3], [40]], N);
    expect(mask).toEqual([true, false]);
  });

  it('with no dimension, returns the mask unchanged', () => {
    expect(complementarySuppression([false, true], [[], []], N)).toEqual([false, true]);
  });
});

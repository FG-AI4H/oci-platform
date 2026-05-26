import { describe, expect, it } from 'vitest';
import { diceFromBinaryMasks, diceFromIndexSets, diceMulticlass } from './dice.js';

describe('diceFromIndexSets', () => {
  it('returns 1 for identical sets and 0 for disjoint sets', () => {
    expect(diceFromIndexSets(new Set([1, 2, 3]), new Set([1, 2, 3]))).toBe(1);
    expect(diceFromIndexSets(new Set([1, 2]), new Set([3, 4]))).toBe(0);
  });

  it('returns 1 for two empty sets (no finding = perfect agreement)', () => {
    expect(diceFromIndexSets(new Set(), new Set())).toBe(1);
  });

  it('computes 1/2 for the classic |A|=|B|=2, |A∩B|=1 case (Dice = 2*1/(2+2))', () => {
    expect(diceFromIndexSets(new Set([1, 2]), new Set([2, 3]))).toBeCloseTo(0.5, 10);
  });
});

describe('diceFromBinaryMasks', () => {
  it('matches the published Dice formula on a tiny worked example', () => {
    // Mask A: positives at indices 0,1,2.    Mask B: positives at 1,2,3.
    //   |A| = 3, |B| = 3, |A ∩ B| = 2  →  Dice = 4 / 6 = 0.6667
    expect(diceFromBinaryMasks([1, 1, 1, 0], [0, 1, 1, 1])).toBeCloseTo(4 / 6, 10);
  });

  it('returns 1 for two all-zero masks (background-only agreement)', () => {
    expect(diceFromBinaryMasks([0, 0, 0], [0, 0, 0])).toBe(1);
  });

  it('throws when masks differ in length', () => {
    expect(() => diceFromBinaryMasks([0, 1], [0, 1, 0])).toThrow(/same length/);
  });
});

describe('diceMulticlass', () => {
  it('computes per-class Dice + macro + micro means', () => {
    // 6 pixels. Class 'A': A=[0,1,2], B=[0,1] → inter=2, |A|=3, |B|=2, Dice=4/5=0.8
    // Class 'B': A=[3,4], B=[2,3,4] → inter=2, |A|=2, |B|=3, Dice=4/5=0.8
    // Class 'C': A=[5], B=[5] → inter=1, |A|=1, |B|=1, Dice=1
    const a = ['A', 'A', 'A', 'B', 'B', 'C'];
    const b = ['A', 'A', 'B', 'B', 'B', 'C'];
    const r = diceMulticlass(a, b);
    expect(r.perClass.A).toBeCloseTo(4 / 5, 10);
    expect(r.perClass.B).toBeCloseTo(4 / 5, 10);
    expect(r.perClass.C).toBe(1);
    expect(r.macroDice).toBeCloseTo((0.8 + 0.8 + 1) / 3, 10);
    // micro: total inter = 2+2+1 = 5; total (|A|+|B|) sums = (3+2)+(2+3)+(1+1) = 12; 2*5/12 = 5/6
    expect(r.microDice).toBeCloseTo(5 / 6, 10);
  });

  it('treats a class absent from both masks as NaN and excludes it from the means', () => {
    const a = ['A', 'A', 'A'];
    const b = ['A', 'A', 'A'];
    const r = diceMulticlass(a, b);
    expect(r.perClass.A).toBe(1);
    expect(r.macroDice).toBe(1);
    expect(r.microDice).toBe(1);
  });

  it('throws when arrays differ in length', () => {
    expect(() => diceMulticlass(['A'], ['A', 'B'])).toThrow(/same length/);
  });
});

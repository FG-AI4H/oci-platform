import { describe, expect, it } from 'vitest';
import { intervalBands, kappaBand } from './agreement-reading';

describe('kappaBand (Landis and Koch, #648)', () => {
  it.each([
    [-0.3, 'poor'],
    [-0.004, 'slight'], // shown as 0.00
    [0, 'slight'],
    [0.2, 'slight'],
    [0.204, 'slight'], // shown as 0.20
    [0.21, 'fair'],
    [0.4, 'fair'],
    [0.41, 'moderate'],
    [0.6, 'moderate'],
    [0.61, 'substantial'],
    [0.8, 'substantial'],
    [0.81, 'almostPerfect'],
    [1, 'almostPerfect'],
  ] as const)('%s reads as %s', (kappa, band) => {
    expect(kappaBand(kappa)).toBe(band);
  });
});

describe('intervalBands', () => {
  it('names both ends when the interval crosses a band', () => {
    expect(intervalBands({ lower: 0.35, upper: 0.72 })).toEqual({
      from: 'fair',
      to: 'substantial',
    });
  });

  it('says nothing when the interval stays in one band, or there is none', () => {
    expect(intervalBands({ lower: 0.62, upper: 0.79 })).toBeNull();
    expect(intervalBands(null)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { COST_ESTIMATE_MIN_N, estimateCampaignEvents } from './index.js';

describe('estimateCampaignEvents (#311)', () => {
  it('reconciles with the ADR-0009 worked example: N=7, 1 000 samples → 7 000 gate-1 events', () => {
    expect(estimateCampaignEvents({ nAnnotators: 7, sampleCount: 1000 })).toEqual({
      gate1Events: 7000,
      maxArbitrationEvents: 1000,
      maxExpertEvents: 1000,
      totalProjectedEvents: 9000,
    });
  });

  it('shows the estimate from N=6, not at N=5', () => {
    expect(COST_ESTIMATE_MIN_N).toBe(6);
    expect(5 >= COST_ESTIMATE_MIN_N).toBe(false);
    expect(6 >= COST_ESTIMATE_MIN_N).toBe(true);
  });

  it('computes both sides of the threshold boundary', () => {
    expect(estimateCampaignEvents({ nAnnotators: 5, sampleCount: 1000 }).gate1Events).toBe(5000);
    expect(estimateCampaignEvents({ nAnnotators: 6, sampleCount: 1000 })).toEqual({
      gate1Events: 6000,
      maxArbitrationEvents: 1000,
      maxExpertEvents: 1000,
      totalProjectedEvents: 8000,
    });
  });

  it('N=1 single-rater shortcut never reaches gates 2 and 3', () => {
    expect(estimateCampaignEvents({ nAnnotators: 1, sampleCount: 1000 })).toEqual({
      gate1Events: 1000,
      maxArbitrationEvents: 0,
      maxExpertEvents: 0,
      totalProjectedEvents: 1000,
    });
  });

  it.each([
    ['zero', 0],
    ['empty (NaN from a blank input)', Number.NaN],
    ['negative', -10],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('a %s sample count yields zero events', (_label, sampleCount) => {
    expect(estimateCampaignEvents({ nAnnotators: 7, sampleCount })).toEqual({
      gate1Events: 0,
      maxArbitrationEvents: 0,
      maxExpertEvents: 0,
      totalProjectedEvents: 0,
    });
  });
});

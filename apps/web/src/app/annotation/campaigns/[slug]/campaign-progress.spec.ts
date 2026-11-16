import { describe, expect, it } from 'vitest';
import type { AnnotationGateState } from '@oci/shared-types';
import { computeCampaignProgress } from './campaign-progress';

function task(
  gateState: AnnotationGateState,
  createdAt: string,
  completedAt: string | null = null,
) {
  return { gateState, createdAt, completedAt };
}

const TODAY = new Date('2026-10-05T15:00:00.000Z');

describe('computeCampaignProgress', () => {
  it('returns zeros and no burndown when there are no tasks', () => {
    const p = computeCampaignProgress([], TODAY);
    expect(p.total).toBe(0);
    expect(p.done).toBe(0);
    expect(p.doneShare).toBe(0);
    expect(p.burndown).toEqual([]);
    expect(Object.values(p.counts).every((n) => n === 0)).toBe(true);
  });

  it('gives a single point when everything happens on one day', () => {
    const p = computeCampaignProgress(
      [
        task('COMPLETED', '2026-10-05T08:00:00.000Z', '2026-10-05T09:00:00.000Z'),
        task('INDEPENDENT', '2026-10-05T08:00:00.000Z'),
        task('INDEPENDENT', '2026-10-05T08:00:00.000Z'),
      ],
      TODAY,
    );
    expect(p.burndown).toEqual([{ date: '2026-10-05', remaining: 2 }]);
    expect(p.counts.INDEPENDENT).toBe(2);
    expect(p.done).toBe(1);
    expect(p.doneShare).toBeCloseTo(1 / 3);
  });

  it('walks every day from the first creation to today, including quiet days', () => {
    const p = computeCampaignProgress(
      [
        task('COMPLETED', '2026-10-01T10:00:00.000Z', '2026-10-02T10:00:00.000Z'),
        task('COMPLETED', '2026-10-01T10:00:00.000Z', '2026-10-04T10:00:00.000Z'),
        task('AWAITING_ARBITRATION', '2026-10-01T10:00:00.000Z'),
        // A second batch seeded mid-way pushes the line back up.
        task('INDEPENDENT', '2026-10-03T10:00:00.000Z'),
        task('AWAITING_EXPERT', '2026-10-03T10:00:00.000Z'),
      ],
      TODAY,
    );
    expect(p.burndown).toEqual([
      { date: '2026-10-01', remaining: 3 },
      { date: '2026-10-02', remaining: 2 },
      { date: '2026-10-03', remaining: 4 },
      { date: '2026-10-04', remaining: 3 },
      { date: '2026-10-05', remaining: 3 },
    ]);
    expect(p.total).toBe(5);
    expect(p.done).toBe(2);
  });

  it('counts SKIPPED as done but keeps it separate from COMPLETED', () => {
    const p = computeCampaignProgress(
      [
        task('COMPLETED', '2026-10-04T10:00:00.000Z', '2026-10-04T12:00:00.000Z'),
        task('SKIPPED', '2026-10-04T10:00:00.000Z', '2026-10-05T12:00:00.000Z'),
        task('INDEPENDENT', '2026-10-04T10:00:00.000Z'),
        task('INDEPENDENT', '2026-10-04T10:00:00.000Z'),
      ],
      TODAY,
    );
    expect(p.counts.COMPLETED).toBe(1);
    expect(p.counts.SKIPPED).toBe(1);
    expect(p.done).toBe(2);
    expect(p.doneShare).toBe(0.5);
    // The skip leaves the burndown on the day it happened.
    expect(p.burndown).toEqual([
      { date: '2026-10-04', remaining: 3 },
      { date: '2026-10-05', remaining: 2 },
    ]);
  });

  it('uses the given today rather than the clock', () => {
    const tasks = [task('INDEPENDENT', '2026-10-01T10:00:00.000Z')];
    expect(
      computeCampaignProgress(tasks, new Date('2026-10-02T00:00:00.000Z')).burndown,
    ).toHaveLength(2);
    expect(
      computeCampaignProgress(tasks, new Date('2026-10-11T23:59:59.000Z')).burndown,
    ).toHaveLength(11);
  });

  it('uses UTC days, so a late-evening completion lands on its UTC date', () => {
    const p = computeCampaignProgress(
      [task('COMPLETED', '2026-10-04T22:00:00.000Z', '2026-10-04T23:30:00.000Z')],
      TODAY,
    );
    expect(p.burndown).toEqual([
      { date: '2026-10-04', remaining: 0 },
      { date: '2026-10-05', remaining: 0 },
    ]);
  });

  it('folds events dated after today into the last point instead of dropping them', () => {
    const p = computeCampaignProgress(
      [
        task('INDEPENDENT', '2026-10-05T10:00:00.000Z'),
        // Clock skew between API and caller: created "tomorrow".
        task('INDEPENDENT', '2026-10-06T01:00:00.000Z'),
      ],
      TODAY,
    );
    expect(p.burndown).toEqual([{ date: '2026-10-05', remaining: 2 }]);
  });
});

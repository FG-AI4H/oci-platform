import type { ScoredSubmissionQuotaSummary } from '@oci/shared-types';
import { describe, expect, it } from 'vitest';
import { evaluationI18n } from './i18n.testing';
import { describeQuota, describeQuotaRefusal } from './quota-text';

const en = evaluationI18n('en');
const fr = evaluationI18n('fr');

function quota(weekUsed: number, totalUsed: number): ScoredSubmissionQuotaSummary {
  const week = { limit: 3, used: weekUsed, remaining: Math.max(0, 3 - weekUsed) };
  const total = { limit: 10, used: totalUsed, remaining: Math.max(0, 10 - totalUsed) };
  return {
    taskSlug: 'chest-xr',
    week: { ...week, resetsAt: '2026-12-21T00:00:00.000Z' },
    total,
    remaining: Math.min(week.remaining, total.remaining),
  };
}

describe('describeQuota (#645)', () => {
  it('gives the weekly remainder first and the task total second', () => {
    expect(describeQuota(en, quota(1, 4))).toEqual({
      available: true,
      summary: '2 of 3 scored submissions left this week.',
      detail: '6 of 10 left on this task in total.',
    });
  });

  it('names the reset, in UTC, when the week is used up', () => {
    const text = describeQuota(en, quota(3, 4));
    expect(text.available).toBe(false);
    expect(text.summary).toBe('No scored submissions left this week.');
    expect(text.detail).toBe(
      'All 3 for this week are used. The limit resets on Monday 21 December at 00:00 UTC. Checking the format stays free.',
    );
  });

  it('promises no reset when the task total is used up, even with weekly slots left', () => {
    const text = describeQuota(en, quota(1, 10));
    expect(text.available).toBe(false);
    expect(text.summary).toBe('No scored submissions left on this task.');
    expect(text.detail).toContain('This limit does not reset.');
    expect(text.detail).not.toContain('resets on');
  });
});

describe('describeQuotaRefusal (#645)', () => {
  it('restates a weekly refusal with its reset', () => {
    expect(
      describeQuotaRefusal(en, {
        scope: 'WEEK',
        limit: 3,
        used: 3,
        resetsAt: '2026-12-21T00:00:00.000Z',
      }),
    ).toBe(
      'Not submitted: all 3 scored submissions for this week are used. The limit resets on Monday 21 December at 00:00 UTC.',
    );
  });

  it('restates a task-total refusal without one', () => {
    expect(
      describeQuotaRefusal(en, { scope: 'TASK_TOTAL', limit: 10, used: 10, resetsAt: null }),
    ).toBe(
      'Not submitted: all 10 scored submissions allowed on this task are used. This limit does not reset.',
    );
  });
});

describe('quota text in French (#654)', () => {
  it('words the remainder in French', () => {
    expect(describeQuota(fr, quota(1, 4))).toEqual({
      available: true,
      summary: 'Soumissions notées restantes cette semaine : 2 sur 3.',
      detail: 'Restantes sur l’ensemble de la tâche : 6 sur 10.',
    });
  });

  it('names the reset with a French date, still in UTC', () => {
    expect(describeQuota(fr, quota(3, 4)).detail).toBe(
      'Toutes les soumissions notées de cette semaine (3) ont été utilisées. La limite est remise à zéro le lundi 21 décembre à 00:00 UTC. La vérification du format reste gratuite.',
    );
    expect(
      describeQuotaRefusal(fr, { scope: 'TASK_TOTAL', limit: 10, used: 10, resetsAt: null }),
    ).toBe(
      'Non soumis : toutes les soumissions notées autorisées sur cette tâche (10) ont été utilisées. Cette limite n’est pas remise à zéro.',
    );
  });
});

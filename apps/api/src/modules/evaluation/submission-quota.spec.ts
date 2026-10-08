import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORED_SUBMISSIONS_PER_TASK,
  DEFAULT_SCORED_SUBMISSIONS_PER_WEEK,
  quotaState,
  resolveScoredQuotaLimits,
  totalQuotaExceededMessage,
  weeklyQuotaExceededMessage,
} from './submission-quota.js';

describe('resolveScoredQuotaLimits', () => {
  it('defaults to 3 per week and 10 per task when nothing is set', () => {
    const { limits, warnings } = resolveScoredQuotaLimits({});
    expect(limits).toEqual({ perWeek: 3, perTask: 10 });
    expect(limits.perWeek).toBe(DEFAULT_SCORED_SUBMISSIONS_PER_WEEK);
    expect(limits.perTask).toBe(DEFAULT_SCORED_SUBMISSIONS_PER_TASK);
    expect(warnings).toEqual([]);
  });

  it('honours configured values', () => {
    const { limits, warnings } = resolveScoredQuotaLimits({
      OCI_EVAL_SCORED_PER_WEEK: '5',
      OCI_EVAL_SCORED_PER_TASK: '25',
    });
    expect(limits).toEqual({ perWeek: 5, perTask: 25 });
    expect(warnings).toEqual([]);
  });

  it('treats an empty string as unset rather than as zero', () => {
    // An empty ECS environment value is a very easy way to accidentally set a
    // cap of 0 and refuse every scored submission on the platform.
    const { limits } = resolveScoredQuotaLimits({
      OCI_EVAL_SCORED_PER_WEEK: '',
      OCI_EVAL_SCORED_PER_TASK: '   ',
    });
    expect(limits).toEqual({ perWeek: 3, perTask: 10 });
  });

  it.each(['0', '-1', '2.5', 'ten', 'null'])(
    'falls back to the default on %s, and says so',
    (raw) => {
      const { limits, warnings } = resolveScoredQuotaLimits({ OCI_EVAL_SCORED_PER_TASK: raw });
      // Falls back to the PUBLISHED default, never to unlimited: a typo must not
      // silently remove the anti-overfitting control.
      expect(limits.perTask).toBe(10);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('OCI_EVAL_SCORED_PER_TASK');
    },
  );

  it('honours a weekly cap above the total but reports that it cannot bind', () => {
    const { limits, warnings } = resolveScoredQuotaLimits({
      OCI_EVAL_SCORED_PER_WEEK: '20',
      OCI_EVAL_SCORED_PER_TASK: '10',
    });
    // Not silently rewritten: the stricter limit still applies, so this is
    // wrong-looking rather than dangerous, and rewriting an operator's explicit
    // number would be worse than telling them it looks wrong.
    expect(limits).toEqual({ perWeek: 20, perTask: 10 });
    expect(warnings[0]).toContain('can never bind');
  });
});

describe('refusal messages quote the limit actually enforced', () => {
  it('weekly message states the configured weekly cap', () => {
    const msg = weeklyQuotaExceededMessage('t', new Date('2026-08-24T00:00:00.000Z'), 7);
    expect(msg).toContain('7 scored submissions per participant per calendar week');
    expect(msg).toContain('2026-08-24T00:00:00.000Z');
    // Still points at the unlimited path, which is the actionable part.
    expect(msg).toContain('"intent": "VALIDATION"');
  });

  it('total message states the configured total and promises no reset', () => {
    const msg = totalQuotaExceededMessage('t', 25);
    expect(msg).toContain('25 scored submissions per participant');
    expect(msg).toContain('does not reset');
  });
});

describe('quotaState', () => {
  const limits = { perWeek: 4, perTask: 12 };

  it('reports the weekly limit and its reset instant', () => {
    const resetsAt = new Date('2026-08-24T00:00:00.000Z');
    expect(quotaState('WEEK', 4, resetsAt, limits)).toEqual({
      scope: 'WEEK',
      limit: 4,
      used: 4,
      resetsAt: '2026-08-24T00:00:00.000Z',
    });
  });

  it('reports the task total with a null reset, because it never resets', () => {
    expect(quotaState('TASK_TOTAL', 12, null, limits)).toEqual({
      scope: 'TASK_TOTAL',
      limit: 12,
      used: 12,
      resetsAt: null,
    });
  });
});

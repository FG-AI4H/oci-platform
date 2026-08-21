import { describe, expect, it } from 'vitest';
import {
  WRITEBACK_ALERT_AFTER_ATTEMPTS,
  flattenScoresForEvalAi,
  nextWritebackAttemptAt,
  writebackIsDue,
  writebackNeedsAlert,
} from './evalai-writeback.js';

const T0 = new Date('2026-08-21T12:00:00.000Z');

describe('write-back backoff (WP4 §5 — EvalAI may be down for days)', () => {
  it('retries immediately on the first attempt', () => {
    expect(writebackIsDue({ attempts: 0, lastAttemptAt: null, now: T0 })).toBe(true);
  });

  it('holds off until the interval has elapsed', () => {
    const soon = new Date(T0.getTime() + 1_000);
    expect(writebackIsDue({ attempts: 1, lastAttemptAt: T0, now: soon })).toBe(false);
    const later = new Date(T0.getTime() + 31_000);
    expect(writebackIsDue({ attempts: 1, lastAttemptAt: T0, now: later })).toBe(true);
  });

  it('caps the interval instead of escalating for ever', () => {
    const a = nextWritebackAttemptAt({ attempts: 5, lastAttemptAt: T0 }).getTime();
    const b = nextWritebackAttemptAt({ attempts: 500, lastAttemptAt: T0 }).getTime();
    expect(b).toBe(a);
  });

  it('alerts an operator but keeps retrying — it never gives up on a real result', () => {
    expect(writebackNeedsAlert(WRITEBACK_ALERT_AFTER_ATTEMPTS - 1)).toBe(false);
    expect(writebackNeedsAlert(WRITEBACK_ALERT_AFTER_ATTEMPTS)).toBe(true);
    // Still due after the alert threshold: alerting is not abandoning.
    const wayLater = new Date(T0.getTime() + 86_400_000);
    expect(writebackIsDue({ attempts: 99, lastAttemptAt: T0, now: wayLater })).toBe(true);
  });
});

describe('flattenScoresForEvalAi — comparability is preserved, not flattened away', () => {
  it('prefixes with the scoring family so incomparable metrics never share a column', () => {
    const grading = flattenScoresForEvalAi({
      kind: 'GRADING',
      metrics: { qwk: 0.81, accuracy: 0.9 },
    });
    const classification = flattenScoresForEvalAi({
      kind: 'CLASSIFICATION',
      metrics: { macroF1: 0.7, accuracy: 0.9 },
    });
    expect(grading).toEqual({ grading_qwk: 0.81, grading_accuracy: 0.9 });
    expect(classification).toEqual({ classification_macroF1: 0.7, classification_accuracy: 0.9 });
    // The same key name from two families must not collide.
    expect(Object.keys(grading)).not.toContain('classification_accuracy');
    expect(Object.keys(grading)[1]).not.toBe(Object.keys(classification)[1]);
  });

  it('drops non-finite and non-numeric values rather than posting NaN to a leaderboard', () => {
    const out = flattenScoresForEvalAi({
      kind: 'GRADING',
      metrics: { qwk: Number.NaN, accuracy: 0.5, note: 'text', inf: Number.POSITIVE_INFINITY },
    });
    expect(out).toEqual({ grading_accuracy: 0.5 });
  });

  it('returns an empty map for a null or pre-envelope score rather than throwing', () => {
    expect(flattenScoresForEvalAi(null)).toEqual({});
    expect(flattenScoresForEvalAi({ qwk: 0.8 })).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import { evaluateCompleteness } from './index.js';

describe('evaluateCompleteness (#231)', () => {
  it('accepts noFindings: true unconditionally', () => {
    for (const kind of [
      'CLASSIFICATION',
      'DETECTION',
      'SEGMENTATION',
      'LOCALIZATION',
      'MULTI_MODAL',
    ] as const) {
      const r = evaluateCompleteness(kind, { noFindings: true });
      expect(r.complete).toBe(true);
      expect(r.reasons).toEqual([]);
    }
  });

  it('CLASSIFICATION requires a non-empty label', () => {
    expect(evaluateCompleteness('CLASSIFICATION', { label: 'pneumonia' }).complete).toBe(true);
    expect(evaluateCompleteness('CLASSIFICATION', { label: '   ' }).complete).toBe(false);
    expect(evaluateCompleteness('CLASSIFICATION', {}).complete).toBe(false);
  });

  it('MULTI_MODAL uses the same label rule as CLASSIFICATION', () => {
    expect(evaluateCompleteness('MULTI_MODAL', { label: 'a' }).complete).toBe(true);
    expect(evaluateCompleteness('MULTI_MODAL', {}).complete).toBe(false);
  });

  it('DETECTION requires a non-empty boxes array', () => {
    expect(
      evaluateCompleteness('DETECTION', { boxes: [{ class: 'lung', xywh: [0, 0, 10, 10] }] })
        .complete,
    ).toBe(true);
    expect(evaluateCompleteness('DETECTION', { boxes: [] }).complete).toBe(false);
    expect(evaluateCompleteness('DETECTION', {}).complete).toBe(false);
  });

  it('LOCALIZATION uses the same boxes rule as DETECTION', () => {
    expect(evaluateCompleteness('LOCALIZATION', { boxes: ['x'] }).complete).toBe(true);
    expect(evaluateCompleteness('LOCALIZATION', {}).complete).toBe(false);
  });

  it('SEGMENTATION requires a non-empty maskUrl', () => {
    expect(evaluateCompleteness('SEGMENTATION', { maskUrl: 's3://x/y' }).complete).toBe(true);
    expect(evaluateCompleteness('SEGMENTATION', { maskUrl: '' }).complete).toBe(false);
    expect(evaluateCompleteness('SEGMENTATION', {}).complete).toBe(false);
  });

  it('surfaces a reason string the annotator UI can render', () => {
    const r = evaluateCompleteness('CLASSIFICATION', {});
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0]).toMatch(/label/i);
  });
});

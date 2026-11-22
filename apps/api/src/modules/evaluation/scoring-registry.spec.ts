import { describe, expect, it } from 'vitest';
import { scoreSubmission, ScoringError } from './scoring.js';
import {
  MAX_PREDICTION_ITEMS,
  acceptsItemScores,
  isScorableTaskKind,
  primaryMetricOf,
  scoreByKind,
  validateItemScores,
  validatePredictionsPayload,
} from './scoring-registry.js';

const groundTruth = { a: 0, b: 1, c: 2, d: 3, e: 4 };
const predictions = { a: 0, b: 1, c: 2, d: 4, e: 4 };

describe('scoreByKind — GRADING is unchanged by the registry', () => {
  // The regression guard that makes WP10 additive: routing GRADING through the
  // registry must produce byte-identical metrics to calling the ADR-0017
  // implementation directly. If this drifts, published results drift.
  it('produces metrics identical to calling scoreSubmission directly', () => {
    const direct = scoreSubmission({
      groundTruth,
      predictions,
      numClasses: 5,
      referableThreshold: 2,
    });

    const viaRegistry = scoreByKind({
      kind: 'GRADING',
      groundTruth,
      predictions,
      config: { numClasses: 5, referableThreshold: 2 },
    });

    expect(viaRegistry.kind).toBe('GRADING');
    expect(viaRegistry.metrics).toStrictEqual(direct);
  });

  it('passes the referable threshold through to the scorer', () => {
    const t2 = scoreByKind({
      kind: 'GRADING',
      groundTruth,
      predictions,
      config: { numClasses: 5, referableThreshold: 2 },
    });
    const t4 = scoreByKind({
      kind: 'GRADING',
      groundTruth,
      predictions,
      config: { numClasses: 5, referableThreshold: 4 },
    });
    // Same predictions, different split => the binary metrics must differ,
    // proving config is not being silently defaulted inside the registry.
    expect(t2.metrics).not.toStrictEqual(t4.metrics);
  });
});

describe('scoreByKind — CLASSIFICATION dispatch', () => {
  it('returns the nominal metric set, not the ordinal one', () => {
    const s = scoreByKind({
      kind: 'CLASSIFICATION',
      groundTruth: { a: 0, b: 1, c: 1 },
      predictions: { a: 0, b: 1, c: 0 },
      config: { numClasses: 2 },
    });

    expect(s.kind).toBe('CLASSIFICATION');
    // Discriminate before reading, as a consumer must.
    if (s.kind !== 'CLASSIFICATION') throw new Error('wrong kind');
    expect(s.metrics.perClass).toHaveLength(2);
    expect(s.metrics.accuracy).toBeCloseTo(0.6667, 4);
    // No ordinal agreement metric is present on the nominal shape.
    expect('qwk' in s.metrics).toBe(false);
  });
});

describe('scoreByKind — BINARY_DIAGNOSTIC dispatch (#650)', () => {
  const gt = { a: 1, b: 0, c: 1, d: 0 };
  const labels = { a: 1, b: 0, c: 0, d: 0 };

  it('returns the diagnostic metric set and orders by balanced accuracy', () => {
    const s = scoreByKind({ kind: 'BINARY_DIAGNOSTIC', groundTruth: gt, predictions: labels });
    if (s.kind !== 'BINARY_DIAGNOSTIC') throw new Error('wrong kind');
    expect(s.metrics.sensitivity?.estimate).toBe(0.5);
    expect(s.metrics.specificity?.estimate).toBe(1);
    expect(primaryMetricOf(s)).toBe(0.75);
    expect(s.metrics.auc).toBeNull();
  });

  it('sinks a result whose balanced accuracy is not estimable, rather than ranking it as 0', () => {
    const oneClass = scoreByKind({
      kind: 'BINARY_DIAGNOSTIC',
      groundTruth: { a: 1, b: 1 },
      predictions: { a: 1, b: 1 },
    });
    expect(primaryMetricOf(oneClass)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('passes item scores through to the scorer', () => {
    const s = scoreByKind({
      kind: 'BINARY_DIAGNOSTIC',
      groundTruth: gt,
      predictions: labels,
      itemScores: { a: 0.9, b: 0.2, c: 0.6, d: 0.1 },
    });
    if (s.kind !== 'BINARY_DIAGNOSTIC') throw new Error('wrong kind');
    expect(s.metrics.auc?.estimate).toBe(1);
  });

  it('refuses item scores for a kind that takes none, rather than ignoring them', () => {
    expect(acceptsItemScores('BINARY_DIAGNOSTIC')).toBe(true);
    expect(acceptsItemScores('GRADING')).toBe(false);
    expect(acceptsItemScores('CLASSIFICATION')).toBe(false);
    for (const kind of ['GRADING', 'CLASSIFICATION']) {
      expect(() =>
        scoreByKind({
          kind,
          groundTruth: { a: 0 },
          predictions: { a: 0 },
          itemScores: { a: 0.5 },
          config: { numClasses: 2, referableThreshold: 1 },
        }),
      ).toThrow(/no score/);
    }
  });

  it('refuses a score outside 0 to 1 at the shape gate', () => {
    expect(() => validateItemScores('BINARY_DIAGNOSTIC', { a: 1.5 })).toThrow(ScoringError);
    expect(() => validateItemScores('BINARY_DIAGNOSTIC', { a: -0.1 })).toThrow(ScoringError);
    expect(validateItemScores('BINARY_DIAGNOSTIC', undefined)).toBeUndefined();
  });
});

describe('task-kind gate', () => {
  it('recognises the kinds this build can score', () => {
    expect(isScorableTaskKind('GRADING')).toBe(true);
    expect(isScorableTaskKind('CLASSIFICATION')).toBe(true);
    expect(isScorableTaskKind('BINARY_DIAGNOSTIC')).toBe(true);
  });

  it('rejects kinds that are declared but not yet implemented', () => {
    // SEGMENTATION / DETECTION / SPAN_EXTRACTION are planned (#428) but must
    // fail loudly until their scorer and payload schema land — never score a
    // task the build cannot actually evaluate.
    expect(isScorableTaskKind('SEGMENTATION')).toBe(false);
    expect(() => scoreByKind({ kind: 'SEGMENTATION', groundTruth, predictions })).toThrow(
      ScoringError,
    );
  });
});

describe('validatePredictionsPayload — shape gate without ground truth', () => {
  it('accepts a well-formed single-label payload', () => {
    expect(validatePredictionsPayload('GRADING', { a: 0, b: 3 })).toStrictEqual({
      a: 0,
      b: 3,
    });
  });

  it('rejects a non-numeric label', () => {
    expect(() => validatePredictionsPayload('GRADING', { a: 'two' })).toThrow(ScoringError);
  });

  it('rejects a non-integer label', () => {
    expect(() => validatePredictionsPayload('GRADING', { a: 1.5 })).toThrow(ScoringError);
  });

  it('rejects a negative label', () => {
    expect(() => validatePredictionsPayload('GRADING', { a: -1 })).toThrow(ScoringError);
  });

  it('rejects an empty item id', () => {
    expect(() => validatePredictionsPayload('GRADING', { '': 0 })).toThrow(ScoringError);
  });

  it('rejects a non-object payload', () => {
    expect(() => validatePredictionsPayload('GRADING', [1, 2, 3])).toThrow(ScoringError);
    expect(() => validatePredictionsPayload('GRADING', 'nope')).toThrow(ScoringError);
    expect(() => validatePredictionsPayload('GRADING', null)).toThrow(ScoringError);
  });

  it('rejects a payload over the item budget', () => {
    // The output path is an exfiltration channel (#414): an oversized payload
    // is rejected on shape, before any scoring work is done.
    const oversized: Record<string, number> = {};
    for (let i = 0; i <= MAX_PREDICTION_ITEMS; i++) oversized[`i${i}`] = 0;
    expect(Object.keys(oversized).length).toBeGreaterThan(MAX_PREDICTION_ITEMS);
    expect(() => validatePredictionsPayload('GRADING', oversized)).toThrow(ScoringError);
  });

  it('does not need ground truth to answer', () => {
    // The property WP6 depends on: a validation submission can be checked
    // without the server loading the hidden labels at all.
    expect(() => validatePredictionsPayload('CLASSIFICATION', { a: 0 })).not.toThrow();
  });
});

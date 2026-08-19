import { describe, expect, it } from 'vitest';
import { scoreSubmission, ScoringError } from './scoring.js';
import {
  MAX_PREDICTION_ITEMS,
  isScorableTaskKind,
  scoreByKind,
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

describe('task-kind gate', () => {
  it('recognises the kinds this build can score', () => {
    expect(isScorableTaskKind('GRADING')).toBe(true);
    expect(isScorableTaskKind('CLASSIFICATION')).toBe(true);
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

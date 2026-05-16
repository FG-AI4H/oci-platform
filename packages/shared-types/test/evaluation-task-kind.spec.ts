import { describe, expect, it } from 'vitest';
import {
  EvaluationTaskKindSchema,
  KNOWN_EVALUATION_TASK_KINDS,
  ModelClassSchema,
  isKnownEvaluationTaskKind,
  isLmmTaskKind,
  requiresLmmGovernance,
} from '../src/evaluation-task-kind.js';

describe('EvaluationTaskKindSchema (ADR-0015)', () => {
  it('accepts every documented classical kind', () => {
    for (const kind of ['classification', 'detection', 'segmentation', 'regression'] as const) {
      expect(EvaluationTaskKindSchema.parse(kind)).toBe(kind);
    }
  });

  it('accepts the reserved LMM kinds from day one', () => {
    for (const kind of [
      'lmm-qa',
      'lmm-red-team',
      'lmm-hallucination',
      'lmm-prompt-injection',
    ] as const) {
      expect(EvaluationTaskKindSchema.parse(kind)).toBe(kind);
    }
  });

  it('accepts vendor-extension `x-…` tokens', () => {
    expect(EvaluationTaskKindSchema.parse('x-acme-triage')).toBe('x-acme-triage');
    expect(EvaluationTaskKindSchema.parse('x-vendor-multi-step-eval')).toBe(
      'x-vendor-multi-step-eval',
    );
  });

  it('rejects values that look almost-right', () => {
    // Uppercase
    expect(() => EvaluationTaskKindSchema.parse('LMM-QA')).toThrow();
    // Underscore (we use hyphens, mirroring the rest of the kebab-case schema)
    expect(() => EvaluationTaskKindSchema.parse('lmm_qa')).toThrow();
    // Bare extension prefix
    expect(() => EvaluationTaskKindSchema.parse('x-')).toThrow();
    // Random string
    expect(() => EvaluationTaskKindSchema.parse('whatever')).toThrow();
    // Too long
    expect(() => EvaluationTaskKindSchema.parse('x-' + 'a'.repeat(65))).toThrow();
  });

  it('isKnownEvaluationTaskKind narrows correctly', () => {
    expect(isKnownEvaluationTaskKind('classification')).toBe(true);
    expect(isKnownEvaluationTaskKind('lmm-red-team')).toBe(true);
    expect(isKnownEvaluationTaskKind('x-acme-triage')).toBe(false);
  });

  it('isLmmTaskKind matches the reserved prefix', () => {
    expect(isLmmTaskKind('lmm-qa')).toBe(true);
    expect(isLmmTaskKind('lmm-hallucination')).toBe(true);
    expect(isLmmTaskKind('classification')).toBe(false);
    // Vendor LMM-flavoured kinds intentionally do NOT match — they
    // should pick a non-`lmm-` token (per ADR-0015).
    expect(isLmmTaskKind('x-vendor-llm-eval')).toBe(false);
  });

  it('KNOWN_EVALUATION_TASK_KINDS is a stable readonly tuple', () => {
    expect(KNOWN_EVALUATION_TASK_KINDS.length).toBeGreaterThan(0);
    expect(KNOWN_EVALUATION_TASK_KINDS).toContain('classification');
    expect(KNOWN_EVALUATION_TASK_KINDS).toContain('lmm-red-team');
  });
});

describe('ModelClassSchema (ADR-0015)', () => {
  it('includes lmm and agent from day one', () => {
    expect(ModelClassSchema.parse('classical')).toBe('classical');
    expect(ModelClassSchema.parse('time-series')).toBe('time-series');
    expect(ModelClassSchema.parse('foundation')).toBe('foundation');
    expect(ModelClassSchema.parse('lmm')).toBe('lmm');
    expect(ModelClassSchema.parse('agent')).toBe('agent');
  });

  it('rejects undeclared values (this is the one closed enum)', () => {
    expect(() => ModelClassSchema.parse('llm')).toThrow();
    expect(() => ModelClassSchema.parse('LMM')).toThrow();
    expect(() => ModelClassSchema.parse('rule-engine')).toThrow();
  });

  it('requiresLmmGovernance flags lmm + agent only', () => {
    expect(requiresLmmGovernance('classical')).toBe(false);
    expect(requiresLmmGovernance('time-series')).toBe(false);
    expect(requiresLmmGovernance('foundation')).toBe(false);
    expect(requiresLmmGovernance('lmm')).toBe(true);
    expect(requiresLmmGovernance('agent')).toBe(true);
  });
});

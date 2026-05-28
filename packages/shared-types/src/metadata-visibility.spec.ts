import { describe, expect, it } from 'vitest';
import {
  canonicalVisibilityConfigString,
  composeMetadataBundle,
  isFieldVisibleAtGate,
  resolveFieldBucket,
  visibilityGateForGateState,
  type MetadataVisibilityBucket,
} from './index.js';

describe('resolveFieldBucket — source-of-truth priority (ADR-0010 Decision 1)', () => {
  it('manager override wins over Croissant tag and default', () => {
    expect(
      resolveFieldBucket({
        managerBucket: 'optional',
        croissantBucket: 'hidden',
        defaultBucket: 'hidden',
      }),
    ).toBe('optional');
  });

  it('Croissant tag wins over default when no manager override', () => {
    expect(resolveFieldBucket({ croissantBucket: 'required', defaultBucket: 'hidden' })).toBe(
      'required',
    );
  });

  it('falls back to `hidden` when no source resolves the field (default-hide)', () => {
    expect(resolveFieldBucket({})).toBe('hidden');
  });

  it('`never` from the default table is a hard floor a manager cannot lift', () => {
    expect(resolveFieldBucket({ managerBucket: 'required', defaultBucket: 'never' })).toBe('never');
  });

  it('`never` from a Croissant tag is a hard floor', () => {
    expect(resolveFieldBucket({ managerBucket: 'required', croissantBucket: 'never' })).toBe(
      'never',
    );
  });
});

describe('isFieldVisibleAtGate — gate matrix (ADR-0010 Decision 2)', () => {
  it('required is visible at every gate', () => {
    for (const gate of ['independent', 'arbitration', 'expert'] as const) {
      expect(isFieldVisibleAtGate('required', gate)).toBe(true);
    }
  });

  it('never is visible at no gate', () => {
    for (const gate of ['independent', 'arbitration', 'expert'] as const) {
      expect(isFieldVisibleAtGate('never', gate)).toBe(false);
    }
  });

  it('optional is hidden at gate 1 but shown at gate 2 + 3', () => {
    expect(isFieldVisibleAtGate('optional', 'independent')).toBe(false);
    expect(isFieldVisibleAtGate('optional', 'arbitration')).toBe(true);
    expect(isFieldVisibleAtGate('optional', 'expert')).toBe(true);
  });

  it('optional shows at gate 1 for training-grade campaigns', () => {
    expect(isFieldVisibleAtGate('optional', 'independent', { trainingGrade: true })).toBe(true);
  });

  it('hidden only shows when promoted to the matching gate', () => {
    expect(isFieldVisibleAtGate('hidden', 'expert')).toBe(false);
    expect(isFieldVisibleAtGate('hidden', 'expert', { promotedAtGates: ['expert'] })).toBe(true);
    expect(isFieldVisibleAtGate('hidden', 'arbitration', { promotedAtGates: ['expert'] })).toBe(
      false,
    );
  });
});

describe('composeMetadataBundle', () => {
  const sample = { modality: 'CR', age_bin: '60-69', prior_diagnosis: 'dm', patient_name: 'X' };
  const buckets: Record<string, MetadataVisibilityBucket> = {
    modality: 'required',
    age_bin: 'optional',
    prior_diagnosis: 'hidden',
    patient_name: 'never',
  };
  const resolve = (field: string) => ({ bucket: buckets[field] ?? 'hidden' });

  it('places required + gate-permitted optional only; sorts deliveredFields', () => {
    const { bundle, deliveredFields } = composeMetadataBundle(sample, 'arbitration', resolve);
    expect(bundle.required).toEqual({ modality: 'CR' });
    expect(bundle.optional).toEqual({ age_bin: '60-69' });
    expect(deliveredFields).toEqual(['age_bin', 'modality']);
  });

  it('drops everything but required at gate 1', () => {
    const { bundle, deliveredFields } = composeMetadataBundle(sample, 'independent', resolve);
    expect(deliveredFields).toEqual(['modality']);
    expect(bundle.optional).toEqual({});
  });
});

describe('visibilityGateForGateState', () => {
  it('maps gate states; unknown / terminal states resolve to the conservative independent gate', () => {
    expect(visibilityGateForGateState('INDEPENDENT')).toBe('independent');
    expect(visibilityGateForGateState('AWAITING_ARBITRATION')).toBe('arbitration');
    expect(visibilityGateForGateState('AWAITING_EXPERT')).toBe('expert');
    expect(visibilityGateForGateState('COMPLETED')).toBe('independent');
    expect(visibilityGateForGateState('SKIPPED')).toBe('independent');
    expect(visibilityGateForGateState('garbage')).toBe('independent');
  });
});

describe('canonicalVisibilityConfigString', () => {
  it('is invariant to object-key insertion order', () => {
    const a = canonicalVisibilityConfigString({
      version: 'v1',
      fieldOverrides: {
        b: { bucket: 'optional', promotedAtGates: [] },
        a: { bucket: 'hidden', promotedAtGates: [] },
      },
      trainingGrade: false,
    });
    const b = canonicalVisibilityConfigString({
      version: 'v1',
      fieldOverrides: {
        a: { bucket: 'hidden', promotedAtGates: [] },
        b: { bucket: 'optional', promotedAtGates: [] },
      },
      trainingGrade: false,
    });
    expect(a).toBe(b);
  });
});

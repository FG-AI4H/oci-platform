import { SealedRunFailureCodeSchema, type SealedRunResult } from '@oci/shared-types';
import { describe, expect, it } from 'vitest';
import {
  classifySealedRunResult,
  DEFAULT_SEALED_RUN_TIMEOUT_SEC,
  imageRefMatchesDigest,
  participantFacingFailureMessage,
  resolveSealedRunTimeoutSec,
  sealedRunCallbackUrl,
  sealedRunResultFingerprint,
  SealedRunResultError,
} from './sealed-run.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;

describe('participantFacingFailureMessage', () => {
  it('has a message for every code in the taxonomy, and none of them is empty', () => {
    for (const code of SealedRunFailureCodeSchema.options) {
      const message = participantFacingFailureMessage(code);
      expect(message.length).toBeGreaterThan(0);
      // Participant-facing text names a control, never the code itself — a code
      // echoed into prose is how operator vocabulary leaks into a public page.
      expect(message).not.toContain(code);
    }
  });
});

describe('resolveSealedRunTimeoutSec', () => {
  it('defaults when unset or empty', () => {
    expect(resolveSealedRunTimeoutSec(undefined)).toBe(DEFAULT_SEALED_RUN_TIMEOUT_SEC);
    expect(resolveSealedRunTimeoutSec('  ')).toBe(DEFAULT_SEALED_RUN_TIMEOUT_SEC);
  });

  it('accepts an in-range integer override', () => {
    expect(resolveSealedRunTimeoutSec('600')).toBe(600);
  });

  it('falls back rather than dispatching a message the contract would reject', () => {
    expect(resolveSealedRunTimeoutSec('0')).toBe(DEFAULT_SEALED_RUN_TIMEOUT_SEC);
    expect(resolveSealedRunTimeoutSec('86401')).toBe(DEFAULT_SEALED_RUN_TIMEOUT_SEC);
    expect(resolveSealedRunTimeoutSec('12.5')).toBe(DEFAULT_SEALED_RUN_TIMEOUT_SEC);
    expect(resolveSealedRunTimeoutSec('soon')).toBe(DEFAULT_SEALED_RUN_TIMEOUT_SEC);
  });
});

describe('classifySealedRunResult', () => {
  it('rejects both predictions and metrics', () => {
    const body = {
      durationMs: 1,
      predictions: { a: 0 },
      metrics: {
        qwk: 1,
        accuracy: 1,
        referableSensitivity: 1,
        referableSpecificity: 1,
        coverage: 1,
      },
    } as SealedRunResult;
    expect(() => classifySealedRunResult(body)).toThrow(SealedRunResultError);
  });

  it('rejects none of the three', () => {
    expect(() => classifySealedRunResult({ durationMs: 1 } as SealedRunResult)).toThrow(
      SealedRunResultError,
    );
  });
});

describe('sealedRunResultFingerprint', () => {
  it('is stable across key order and across durationMs / detail changes', () => {
    const a = sealedRunResultFingerprint({
      durationMs: 10,
      predictions: { x: 1, y: 2 },
    } as SealedRunResult);
    const b = sealedRunResultFingerprint({
      durationMs: 999,
      predictions: { y: 2, x: 1 },
    } as SealedRunResult);
    expect(a).toBe(b);

    const f1 = sealedRunResultFingerprint({
      durationMs: 1,
      failure: { code: 'TIMEOUT', detail: 'first' },
    } as SealedRunResult);
    const f2 = sealedRunResultFingerprint({
      durationMs: 2,
      failure: { code: 'TIMEOUT', detail: 'second, longer' },
    } as SealedRunResult);
    expect(f1).toBe(f2);
  });

  it('changes when the outcome changes', () => {
    const base = sealedRunResultFingerprint({
      durationMs: 1,
      predictions: { x: 1 },
    } as SealedRunResult);
    const label = sealedRunResultFingerprint({
      durationMs: 1,
      predictions: { x: 2 },
    } as SealedRunResult);
    const code = sealedRunResultFingerprint({
      durationMs: 1,
      failure: { code: 'OOM_KILLED' },
    } as SealedRunResult);
    expect(base).not.toBe(label);
    expect(base).not.toBe(code);
  });
});

describe('dispatch helpers', () => {
  it('builds an absolute callback URL, tolerating a trailing slash', () => {
    expect(sealedRunCallbackUrl('https://dev.oci.ai4h.net', 'abc')).toBe(
      'https://dev.oci.ai4h.net/v2/submissions/abc/result',
    );
    expect(sealedRunCallbackUrl('https://dev.oci.ai4h.net//', 'abc')).toBe(
      'https://dev.oci.ai4h.net/v2/submissions/abc/result',
    );
  });

  it('requires the image ref to be pinned to the submitted digest', () => {
    expect(imageRefMatchesDigest(`registry/model@${DIGEST}`, DIGEST)).toBe(true);
    expect(imageRefMatchesDigest(`registry/model@sha256:${'b'.repeat(64)}`, DIGEST)).toBe(false);
    // A ref that merely mentions the digest earlier in the string is not pinned
    // to it.
    expect(imageRefMatchesDigest(`registry/${DIGEST}@sha256:${'c'.repeat(64)}`, DIGEST)).toBe(
      false,
    );
  });
});

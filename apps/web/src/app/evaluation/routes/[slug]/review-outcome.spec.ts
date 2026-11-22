import { describe, expect, it } from 'vitest';
import { decisionChoices, describeRefusal, problemDetail, readReviewForm } from './review-outcome';

describe('decisionChoices', () => {
  it('offers only what the API reported, in review order', () => {
    expect(
      decisionChoices('UNDER_REVIEW', ['WITHDRAWN', 'REJECTED', 'APPROVED']).map((c) => c.to),
    ).toEqual(['APPROVED', 'REJECTED', 'WITHDRAWN']);
    expect(decisionChoices('DECLARED', ['UNDER_REVIEW', 'WITHDRAWN']).map((c) => c.label)).toEqual([
      'Begin the review',
      'Withdraw',
    ]);
    expect(decisionChoices('REJECTED', [])).toEqual([]);
  });

  it('calls a rejection of an approved version what it is', () => {
    const [reject] = decisionChoices('APPROVED', ['REJECTED']);
    expect(reject?.label).toBe('Reject after approval');
    expect(reject?.consequence).toContain('Revokes the approval');
  });
});

describe('readReviewForm', () => {
  it('requires a decision', () => {
    expect(readReviewForm({ decision: '', rationale: 'x'.repeat(20) })).toMatchObject({
      ok: false,
      decisionError: 'Choose a decision.',
    });
    expect(readReviewForm({ decision: 'DECLARED', rationale: '' }).ok).toBe(false);
  });

  it.each(['APPROVED', 'REJECTED', 'WITHDRAWN'])('requires a rationale to %s', (decision) => {
    expect(readReviewForm({ decision, rationale: '   ' })).toMatchObject({
      ok: false,
      rationaleError: expect.stringContaining('published'),
    });
    expect(readReviewForm({ decision, rationale: 'too short' }).ok).toBe(false);
    expect(readReviewForm({ decision, rationale: '  A checkable reason.  ' })).toEqual({
      ok: true,
      to: decision,
      rationale: 'A checkable reason.',
    });
  });

  it('lets a review begin without a note', () => {
    expect(readReviewForm({ decision: 'UNDER_REVIEW', rationale: '' })).toEqual({
      ok: true,
      to: 'UNDER_REVIEW',
      rationale: '',
    });
  });

  it('refuses a rationale longer than the API accepts', () => {
    expect(readReviewForm({ decision: 'APPROVED', rationale: 'x'.repeat(8001) }).ok).toBe(false);
  });
});

describe('describeRefusal', () => {
  const base = { detail: '', version: '1.0.0', expected: 'UNDER_REVIEW' as const };

  it('explains a 403 as review in pairs', () => {
    const r = describeRefusal({ ...base, httpStatus: 403, current: 'UNDER_REVIEW' });
    expect(r.kind).toBe('forbidden');
    expect(r.message).toContain('Review is in pairs');
    expect(r.message).toContain('your text is kept');
  });

  it('says the version moved on when its status changed', () => {
    for (const httpStatus of [400, 409]) {
      const r = describeRefusal({ ...base, httpStatus, current: 'APPROVED' });
      expect(r.kind).toBe('stale');
      expect(r.message).toContain('Version 1.0.0 is now approved');
    }
  });

  it('says the decision is not open when the status did not change', () => {
    const r = describeRefusal({ ...base, httpStatus: 400, current: 'UNDER_REVIEW' });
    expect(r.kind).toBe('not-reviewable');
  });

  it('recognises a missing rationale', () => {
    const r = describeRefusal({
      ...base,
      httpStatus: 400,
      detail: 'a rationale (reviewNotes) is required',
      current: 'UNDER_REVIEW',
    });
    expect(r.kind).toBe('rationale');
  });

  it('falls back to the status code', () => {
    expect(describeRefusal({ ...base, httpStatus: 500, current: null }).message).toContain(
      'error 500',
    );
    expect(describeRefusal({ ...base, httpStatus: 404, current: null }).kind).toBe('gone');
  });
});

describe('problemDetail', () => {
  it('reads NestJS and RFC 7807 bodies, and plain text', () => {
    expect(problemDetail('{"statusCode":400,"message":"no rationale"}')).toBe('no rationale');
    expect(problemDetail('{"detail":"d"}')).toBe('d');
    expect(problemDetail('{"message":["a","b"]}')).toBe('a b');
    expect(problemDetail('plain')).toBe('plain');
  });
});

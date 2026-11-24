import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../../../i18n/messages/en';
import fr from '../../../../i18n/messages/fr';
import {
  decisionChoices,
  decisionText,
  describeRefusal,
  problemDetail,
  readReviewForm,
} from './review-outcome';

const t = createTranslator({ locale: 'en', messages: en, namespace: 'EvaluationReview' });
const tFr = createTranslator({ locale: 'fr', messages: fr, namespace: 'EvaluationReview' });

describe('decisionChoices', () => {
  it('offers only what the API reported, in review order', () => {
    expect(
      decisionChoices('UNDER_REVIEW', ['WITHDRAWN', 'REJECTED', 'APPROVED'], t).map((c) => c.to),
    ).toEqual(['APPROVED', 'REJECTED', 'WITHDRAWN']);
    expect(
      decisionChoices('DECLARED', ['UNDER_REVIEW', 'WITHDRAWN'], t).map((c) => c.label),
    ).toEqual(['Begin the review', 'Withdraw']);
    expect(decisionChoices('REJECTED', [], t)).toEqual([]);
  });

  it('calls a rejection of an approved version what it is', () => {
    const [reject] = decisionChoices('APPROVED', ['REJECTED'], t);
    expect(reject?.label).toBe('Reject after approval');
    expect(reject?.consequence).toContain('Revokes the approval');
  });
});

describe('readReviewForm', () => {
  it('requires a decision', () => {
    expect(readReviewForm({ decision: '', rationale: 'x'.repeat(20) }, t)).toMatchObject({
      ok: false,
      decisionError: 'Choose a decision.',
    });
    expect(readReviewForm({ decision: 'DECLARED', rationale: '' }, t).ok).toBe(false);
  });

  it.each(['APPROVED', 'REJECTED', 'WITHDRAWN'])('requires a rationale to %s', (decision) => {
    expect(readReviewForm({ decision, rationale: '   ' }, t)).toMatchObject({
      ok: false,
      rationaleError: expect.stringContaining('published'),
    });
    expect(readReviewForm({ decision, rationale: 'too short' }, t).ok).toBe(false);
    expect(readReviewForm({ decision, rationale: '  A checkable reason.  ' }, t)).toEqual({
      ok: true,
      to: decision,
      rationale: 'A checkable reason.',
    });
  });

  it('lets a review begin without a note', () => {
    expect(readReviewForm({ decision: 'UNDER_REVIEW', rationale: '' }, t)).toEqual({
      ok: true,
      to: 'UNDER_REVIEW',
      rationale: '',
    });
  });

  it('refuses a rationale longer than the API accepts', () => {
    expect(readReviewForm({ decision: 'APPROVED', rationale: 'x'.repeat(8001) }, t).ok).toBe(false);
  });
});

describe('describeRefusal', () => {
  const base = { detail: '', version: '1.0.0', expected: 'UNDER_REVIEW' as const };

  it('explains a 403 as review in pairs', () => {
    const r = describeRefusal({ ...base, httpStatus: 403, current: 'UNDER_REVIEW' }, t);
    expect(r.kind).toBe('forbidden');
    expect(r.message).toContain('Review is in pairs');
    expect(r.message).toContain('your text is kept');
  });

  it('says the version moved on when its status changed', () => {
    for (const httpStatus of [400, 409]) {
      const r = describeRefusal({ ...base, httpStatus, current: 'APPROVED' }, t);
      expect(r.kind).toBe('stale');
      expect(r.message).toContain('Version 1.0.0 is now approved');
    }
  });

  it('says the decision is not open when the status did not change', () => {
    const r = describeRefusal({ ...base, httpStatus: 400, current: 'UNDER_REVIEW' }, t);
    expect(r.kind).toBe('not-reviewable');
  });

  it('recognises a missing rationale', () => {
    const r = describeRefusal(
      {
        ...base,
        httpStatus: 400,
        detail: 'a rationale (reviewNotes) is required',
        current: 'UNDER_REVIEW',
      },
      t,
    );
    expect(r.kind).toBe('rationale');
  });

  it('falls back to the status code', () => {
    expect(describeRefusal({ ...base, httpStatus: 500, current: null }, t).message).toContain(
      'error 500',
    );
    expect(describeRefusal({ ...base, httpStatus: 404, current: null }, t).kind).toBe('gone');
  });

  it('words a refusal in French, with the status in French (#654)', () => {
    const r = describeRefusal({ ...base, httpStatus: 409, current: 'APPROVED' }, tFr);
    expect(r.message).toContain('La version 1.0.0 est désormais approuvée');
    expect(describeRefusal({ ...base, httpStatus: 500, current: null }, tFr).message).toContain(
      'erreur 500',
    );
  });
});

describe('decisionText', () => {
  it('builds the confirmation heading and button the English page showed', () => {
    const text = decisionText('UNDER_REVIEW', t, { version: '1.0.0', method: 'M' });
    expect(text.confirmHeading).toBe('Confirm: begin the review of version 1.0.0 of M');
    expect(text.confirmButton).toBe('Begin the review of version 1.0.0');
    expect(decisionText('APPROVED', t, { version: '1.0.0', method: 'M' }).confirmButton).toBe(
      'Approve version 1.0.0',
    );
  });

  it('words a decision in French', () => {
    const text = decisionText('REJECTED', tFr, { version: '2.0.0', method: 'M' });
    expect(text.label).toBe('Rejeter');
    expect(text.confirmButton).toBe('Rejeter la version 2.0.0');
    expect(decisionChoices('UNDER_REVIEW', ['APPROVED'], tFr)[0]?.label).toBe('Approuver');
    expect(readReviewForm({ decision: '', rationale: '' }, tFr)).toMatchObject({
      decisionError: 'Choisissez une décision.',
    });
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

import {
  reviewNeedsRationale,
  RouteReviewStatusSchema,
  type RouteReviewStatus,
} from '@oci/shared-types';
import { DECISION_TEXT, REJECT_AFTER_APPROVAL, REVIEW_TEXT, STATUS_WORD } from './strings';

/**
 * Pure pieces of the review form (#649): which decisions to offer, how to
 * read the form, and what to say when the platform refuses. Kept apart from
 * the server action so they can be tested without a session.
 */

export const RATIONALE_MIN = 10;
export const RATIONALE_MAX = 8000;

export interface DecisionChoice {
  to: RouteReviewStatus;
  label: string;
  consequence: string;
}

/**
 * The decisions offered on a version: the transitions the API reported as
 * open to this caller, in the order a review runs (begin, approve, reject,
 * withdraw), never one the caller would be refused.
 */
export function decisionChoices(
  from: RouteReviewStatus,
  allowed: ReadonlyArray<RouteReviewStatus>,
): DecisionChoice[] {
  const order: RouteReviewStatus[] = ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN'];
  return order
    .filter((to) => allowed.includes(to))
    .map((to) => {
      if (to === 'REJECTED' && from === 'APPROVED') return { to, ...REJECT_AFTER_APPROVAL };
      const text = DECISION_TEXT[to];
      return { to, label: text.label, consequence: text.consequence };
    });
}

export interface ReviewValues {
  decision: string;
  rationale: string;
}

export type ReviewFormRead =
  | { ok: true; to: RouteReviewStatus; rationale: string }
  | { ok: false; decisionError?: string; rationaleError?: string };

/** Reads and checks the decision and rationale, as the server action receives them. */
export function readReviewForm(values: ReviewValues): ReviewFormRead {
  const decision = RouteReviewStatusSchema.safeParse(values.decision);
  if (!decision.success || decision.data === 'DECLARED') {
    return { ok: false, decisionError: REVIEW_TEXT.chooseDecision };
  }
  const rationale = values.rationale.trim();
  if (rationale.length > RATIONALE_MAX) {
    return { ok: false, rationaleError: REVIEW_TEXT.rationaleTooLong };
  }
  if (reviewNeedsRationale(decision.data)) {
    if (rationale.length === 0) return { ok: false, rationaleError: REVIEW_TEXT.rationaleRequired };
    if (rationale.length < RATIONALE_MIN) {
      return { ok: false, rationaleError: REVIEW_TEXT.rationaleTooShort };
    }
  }
  return { ok: true, to: decision.data, rationale };
}

export type RefusalKind = 'forbidden' | 'stale' | 'not-reviewable' | 'rationale' | 'gone' | 'failed';

export interface Refusal {
  kind: RefusalKind;
  message: string;
}

/**
 * What to tell the reviewer when the API refuses the decision.
 *
 * `current` is the version's status read again after the refusal, or null
 * if it could not be read; `expected` is the status the form was shown for.
 * A 409 (already in that status) and a 400 for a transition the table does
 * not allow both mean the version moved on, or was never open to this
 * decision: the second read tells which.
 */
export function describeRefusal(args: {
  httpStatus: number;
  detail: string;
  version: string;
  expected: RouteReviewStatus;
  current: RouteReviewStatus | null;
}): Refusal {
  const { httpStatus, detail, version, expected, current } = args;
  if (httpStatus === 403) return { kind: 'forbidden', message: REVIEW_TEXT.forbidden };
  if (httpStatus === 404) return { kind: 'gone', message: REVIEW_TEXT.gone };
  if (httpStatus === 400 && /rationale/i.test(detail)) {
    return { kind: 'rationale', message: REVIEW_TEXT.rationaleRefused };
  }
  if (httpStatus === 409 || httpStatus === 400) {
    if (current !== null && current !== expected) {
      return { kind: 'stale', message: REVIEW_TEXT.stale(version, STATUS_WORD[current]) };
    }
    if (current !== null) {
      return {
        kind: 'not-reviewable',
        message: REVIEW_TEXT.notReviewable(version, STATUS_WORD[current]),
      };
    }
  }
  return { kind: 'failed', message: REVIEW_TEXT.failed(httpStatus) };
}

/** The `detail` of an RFC 7807 body, or the raw text, for matching only. */
export function problemDetail(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      for (const key of ['detail', 'message', 'title']) {
        const value = record[key];
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join(' ');
      }
    }
  } catch {
    // Not JSON: fall through to the text itself.
  }
  return body;
}

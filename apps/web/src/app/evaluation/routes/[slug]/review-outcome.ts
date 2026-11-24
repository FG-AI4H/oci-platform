import {
  reviewNeedsRationale,
  RouteReviewStatusSchema,
  type RouteReviewStatus,
} from '@oci/shared-types';
import type { Translator } from '../../../../i18n/translator';

/**
 * Pure pieces of the review form (#649): which decisions to offer, how to
 * read the form, and what to say when the platform refuses. Kept apart from
 * the server action so they can be tested without a session.
 *
 * Every sentence comes from the `EvaluationReview` messages, in the
 * interface language (#654): the form passes `useTranslations`, the server
 * action `getTranslations`, the specs `createTranslator`.
 */

/** `t` for the `EvaluationReview` namespace. */
export type ReviewTranslator = Translator<'EvaluationReview'>;

export const RATIONALE_MIN = 10;
export const RATIONALE_MAX = 8000;

/** A status a decision can move a version to. */
export type DecisionStatus = Exclude<RouteReviewStatus, 'DECLARED'>;

export interface DecisionText {
  label: string;
  consequence: string;
  finality: string;
  /** "Confirm: approve version 1.0.0 of …". */
  confirmHeading: string;
  /** "Approve version 1.0.0". */
  confirmButton: string;
}

/** What a reviewer sees for a decision, by the status it moves to. */
export function decisionText(
  to: RouteReviewStatus,
  t: ReviewTranslator,
  context: { version: string; method: string },
): DecisionText {
  if (to === 'DECLARED') {
    return { label: '', consequence: '', finality: '', confirmHeading: '', confirmButton: '' };
  }
  return {
    label: t(`decision.${to}.label`),
    consequence: t(`decision.${to}.consequence`),
    finality: t(`decision.${to}.finality`),
    confirmHeading: t(`decision.${to}.confirmHeading`, context),
    confirmButton: t(`decision.${to}.confirmButton`, { version: context.version }),
  };
}

/** The status as a word in a sentence ("under review"). */
export function statusWord(status: RouteReviewStatus, t: ReviewTranslator): string {
  return t(`statusWord.${status}`);
}

export interface DecisionChoice {
  to: RouteReviewStatus;
  label: string;
  consequence: string;
}

/**
 * The decisions offered on a version: the transitions the API reported as
 * open to this caller, in the order a review runs (begin, approve, reject,
 * withdraw), never one the caller would be refused. Rejecting an approved
 * version revokes the approval, so it reads differently.
 */
export function decisionChoices(
  from: RouteReviewStatus,
  allowed: ReadonlyArray<RouteReviewStatus>,
  t: ReviewTranslator,
): DecisionChoice[] {
  const order: DecisionStatus[] = ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN'];
  return order
    .filter((to) => allowed.includes(to))
    .map((to) =>
      to === 'REJECTED' && from === 'APPROVED'
        ? {
            to,
            label: t('rejectAfterApproval.label'),
            consequence: t('rejectAfterApproval.consequence'),
          }
        : { to, label: t(`decision.${to}.label`), consequence: t(`decision.${to}.consequence`) },
    );
}

export interface ReviewValues {
  decision: string;
  rationale: string;
}

export type ReviewFormRead =
  | { ok: true; to: RouteReviewStatus; rationale: string }
  | { ok: false; decisionError?: string; rationaleError?: string };

/** Reads and checks the decision and rationale, as the server action receives them. */
export function readReviewForm(values: ReviewValues, t: ReviewTranslator): ReviewFormRead {
  const decision = RouteReviewStatusSchema.safeParse(values.decision);
  if (!decision.success || decision.data === 'DECLARED') {
    return { ok: false, decisionError: t('chooseDecision') };
  }
  const rationale = values.rationale.trim();
  if (rationale.length > RATIONALE_MAX) {
    return { ok: false, rationaleError: t('rationaleTooLong') };
  }
  if (reviewNeedsRationale(decision.data)) {
    if (rationale.length === 0) return { ok: false, rationaleError: t('rationaleRequired') };
    if (rationale.length < RATIONALE_MIN) {
      return { ok: false, rationaleError: t('rationaleTooShort') };
    }
  }
  return { ok: true, to: decision.data, rationale };
}

export type RefusalKind =
  | 'forbidden'
  | 'stale'
  | 'not-reviewable'
  | 'rationale'
  | 'gone'
  | 'failed';

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
export function describeRefusal(
  args: {
    httpStatus: number;
    detail: string;
    version: string;
    expected: RouteReviewStatus;
    current: RouteReviewStatus | null;
  },
  t: ReviewTranslator,
): Refusal {
  const { httpStatus, detail, version, expected, current } = args;
  if (httpStatus === 403) return { kind: 'forbidden', message: t('forbidden') };
  if (httpStatus === 404) return { kind: 'gone', message: t('gone') };
  if (httpStatus === 400 && /rationale/i.test(detail)) {
    return { kind: 'rationale', message: t('rationaleRefused') };
  }
  if (httpStatus === 409 || httpStatus === 400) {
    if (current !== null && current !== expected) {
      return {
        kind: 'stale',
        message: t('stale', { version, status: statusWord(current, t) }),
      };
    }
    if (current !== null) {
      return {
        kind: 'not-reviewable',
        message: t('notReviewable', { version, status: statusWord(current, t) }),
      };
    }
  }
  return { kind: 'failed', message: t('failed', { status: String(httpStatus) }) };
}

/** The `detail` of an RFC 7807 body, or the raw text, for matching only. */
export function problemDetail(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object') {
      const record = new Map(Object.entries(parsed as Record<string, unknown>));
      for (const key of ['detail', 'message', 'title']) {
        const value = record.get(key);
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join(' ');
      }
    }
  } catch {
    // Not JSON: fall through to the text itself.
  }
  return body;
}

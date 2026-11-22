import type { RouteReviewStatus } from '@oci/shared-types';

/**
 * User-facing text added to the evaluation-method page for reviewing,
 * withdrawing and declaring versions (#649). Kept in one module so the
 * French interface can move it to message files without hunting through
 * components.
 */

/** What a reviewer sees for each decision, by the status it moves to. */
export const DECISION_TEXT: Record<
  RouteReviewStatus,
  { label: string; consequence: string; finality: string; confirm: string }
> = {
  DECLARED: { label: '', consequence: '', finality: '', confirm: '' },
  UNDER_REVIEW: {
    label: 'Begin the review',
    consequence:
      'Freezes the three declarations above: from now on, a change means a new version. Results stay provisional until a decision is recorded.',
    finality: 'A review cannot be un-begun.',
    confirm: 'Begin the review of version',
  },
  APPROVED: {
    label: 'Approve',
    consequence:
      'Results scored under this version count: they are published instead of provisional.',
    finality:
      'To reverse an approval later, the version has to be rejected or withdrawn, with a published reason.',
    confirm: 'Approve version',
  },
  REJECTED: {
    label: 'Reject',
    consequence:
      'The version is published as failed, with your rationale, and cannot produce results. Results it already produced are withdrawn with it.',
    finality:
      'This is final: a rejected version cannot be reviewed again. A fix means a new version.',
    confirm: 'Reject version',
  },
  WITHDRAWN: {
    label: 'Withdraw',
    consequence:
      'The version is taken out of use and cannot produce results. Results it already produced are withdrawn with it, and the reason is published.',
    finality: 'This is final: a withdrawn version cannot be reviewed again.',
    confirm: 'Withdraw version',
  },
};

/** Rejecting an approved version revokes the approval; it reads differently. */
export const REJECT_AFTER_APPROVAL = {
  label: 'Reject after approval',
  consequence:
    'Revokes the approval. The version is published as failed, with your rationale, and results already published under it are withdrawn.',
};

export const REVIEW_TEXT = {
  reviewHeading: 'Review this version',
  withdrawHeading: 'Withdraw this version',
  reviewLink: 'Review this version',
  withdrawLink: 'Withdraw this version',
  reviewIntro:
    'Read the three declarations above first. Your decision and its rationale are published on this page, for everyone, as soon as you confirm.',
  withdrawIntro:
    'You submitted this method, so you can withdraw a version of it. You cannot review it: review is in pairs.',
  decisionLegend: 'Decision',
  rationaleLabel: 'Rationale',
  noteLabel: 'Note (optional)',
  rationaleHint:
    'Published with the decision. Give the verdict, the class of any finding, and the reasoning that makes the verdict checkable. Never exploit code, parameter values or patient-level data.',
  noteHint:
    'Beginning a review decides nothing, so a note is optional. If you write one, it is published.',
  replacesPrevious: 'It replaces the rationale published now.',
  continue: 'Continue',
  confirmHeadingPrefix: 'Confirm:',
  confirmLead: 'Check before you confirm. Nothing is recorded until you do.',
  publishedAs: 'Published with the decision:',
  noNote: 'No note.',
  backToEdit: 'Back to edit',
  recording: 'Recording…',
  notRecorded: 'Not recorded',
  chooseDecision: 'Choose a decision.',
  rationaleRequired: 'Write the rationale: it is published with the decision.',
  rationaleTooShort:
    'Write at least 10 characters: the rationale has to make the decision checkable.',
  rationaleTooLong: 'Keep the rationale under 8,000 characters.',
  forbidden:
    'The platform refused this decision. Review is in pairs: whoever submitted the method or declared this version cannot review it, and only an evaluation reviewer can record an outcome. Nothing was changed; your text is kept below.',
  stale: (version: string, status: string) =>
    `Version ${version} is now ${status}: a decision was recorded while you were writing. Nothing was changed by you; the page shows the version as it is now, and your text is kept below.`,
  notReviewable: (version: string, status: string) =>
    `Version ${version} is ${status}, which does not allow this decision. Nothing was changed; your text is kept below.`,
  rationaleRefused: 'The platform requires a rationale for this decision.',
  gone: 'This method or version no longer exists. Nothing was recorded.',
  unreachable: 'The platform could not be reached. Nothing was recorded; try again.',
  failed: (status: number) =>
    `The decision could not be recorded (error ${status}). Nothing was changed; your text is kept below.`,
  noLongerOpen: 'No decision is open to you on this version any more. Your text is kept below:',
  barredSubmitted:
    'You submitted this method, so you cannot review it. Review is in pairs: another evaluation reviewer records the decision.',
  barredDeclared:
    'You declared this version, so you cannot review it. Review is in pairs: another evaluation reviewer records the decision.',
  recordedBanner: (version: string, status: string) =>
    `Recorded: version ${version} is now ${status}. The decision and its rationale are published below.`,
  declaredBanner: (version: string) =>
    `Version ${version} is declared. It is now waiting for an evaluation reviewer.`,
  reviewRecord: 'Rationale published with the decision',
  reviewRecordHint:
    'Only the latest decision and its rationale are shown. The platform’s audit trail keeps every step.',
  permissionsUnavailable:
    'Your permissions on this method could not be read just now, so no review or declaration form is shown. Reload the page to try again.',
};

/** Status words as a reader sees them in sentences. */
export const STATUS_WORD: Record<RouteReviewStatus, string> = {
  DECLARED: 'declared, not yet under review',
  UNDER_REVIEW: 'under review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
};

export const DECLARE_LINK_TEXT = {
  heading: 'Declare a new version',
  body: 'You submitted this method. A change to its threat model, disclosure profile or operational envelope is declared as a new version, which is then reviewed.',
  bodyAdmin:
    'As an operator you can declare a version of this method. A change to its declarations is a new version, which is then reviewed.',
  link: 'Declare a new version',
};

const STATUS_WORDS = new Map(Object.entries(STATUS_WORD) as Array<[RouteReviewStatus, string]>);
type DecisionText = (typeof DECISION_TEXT)['APPROVED'];
const DECISION_TEXTS = new Map(
  Object.entries(DECISION_TEXT) as Array<[RouteReviewStatus, DecisionText]>,
);

/** The status as a word in a sentence. */
export function statusWord(status: RouteReviewStatus): string {
  return STATUS_WORDS.get(status) ?? status;
}

/** The text of a decision, by the status it moves to. */
export function decisionText(to: RouteReviewStatus): DecisionText {
  return DECISION_TEXTS.get(to) ?? DECISION_TEXT.DECLARED;
}

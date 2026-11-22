/**
 * User-facing text of the review queue (#649), in one module so the
 * French interface can move it to message files.
 */
export const QUEUE_TEXT = {
  metaTitle: 'Reviews — OCI Evaluation methods',
  metaDescription: 'Evaluation-method versions waiting for a review decision.',
  back: 'Evaluation methods',
  eyebrow: 'Evaluation reviewer',
  title: 'Versions awaiting review',
  lead: 'A result counts only once the version of the method that produced it is approved. These versions are waiting for a decision. Review is in pairs: a version you submitted is listed, but another reviewer decides it.',
  signedOutTitle: 'Sign in to see the review queue',
  signedOut: 'The review queue is for evaluation reviewers.',
  signIn: 'Sign in',
  notReviewerTitle: 'For evaluation reviewers',
  notReviewer:
    'The review queue is open to evaluation reviewers and platform operators. Every method and its review status stay public on the evaluation methods page.',
  unavailable: 'The evaluation methods could not be read just now. Reload the page to try again.',
  underReviewHeading: 'Under review: waiting for a decision',
  underReviewHint: 'The declarations are frozen. Approve or reject, with a published rationale.',
  declaredHeading: 'Declared: review not yet begun',
  declaredHint: 'Beginning the review freezes the declarations.',
  empty: 'Nothing is waiting here.',
  allEmpty: 'No version is waiting for review.',
  declaredOn: 'Declared',
  open: (version: string) => `Review version ${version}`,
  openFor: (version: string, method: string) => `Review version ${version} of ${method}`,
  view: (version: string) => `View version ${version}`,
  viewFor: (version: string, method: string) => `View version ${version} of ${method}`,
  yoursSubmitted: 'You submitted this method: another reviewer decides it.',
  yoursDeclared: 'You declared this version: another reviewer decides it.',
  permissionsUnknown: 'Open the version to see what you can do on it.',
  count: (n: number) => (n === 1 ? '1 version waiting' : `${n} versions waiting`),
};

/**
 * User-facing text added to the evaluation methods list for reviewers
 * (#649), in one module so the French interface can move it to message
 * files.
 */
export const LIST_REVIEW_TEXT = {
  heading: 'Review queue',
  body: (n: number) =>
    n === 0
      ? 'No method version is waiting for review.'
      : n === 1
        ? '1 method version is waiting for review.'
        : `${n} method versions are waiting for review.`,
  link: 'Open the review queue',
};

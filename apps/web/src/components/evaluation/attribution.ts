import type { EvaluationSubmissionResult, ScoreAttribution } from '@oci/shared-types';

/**
 * Pure helpers for rendering a score's route attribution (#486, WP5
 * invariant 3). Kept free of JSX so the vocabulary can be unit-tested under
 * Vitest's node environment and reused by any page that shows a result —
 * the task page today, the route page next.
 */

/** The five words a result can carry. Fixed vocabulary — other pages reuse it. */
export type AttributionLabel = 'published' | 'provisional' | 'withdrawn' | 'retracted' | 'legacy';

/** Subset of the `Badge` tones the vocabulary maps onto. */
export type AttributionTone = 'success' | 'info' | 'danger' | 'neutral';

export interface AttributionDescription {
  label: AttributionLabel;
  tone: AttributionTone;
  /** One sentence a reader (or screen reader) needs to make sense of the label. */
  description: string;
}

export const PROVISIONAL_DESCRIPTION =
  'Provisional: the evaluation method that produced this result has not yet passed review, so it is excluded from published reporting.';

export const RETRACTED_DESCRIPTION =
  'Results from this method version were withdrawn after review.';

export const PUBLISHED_DESCRIPTION =
  'Published: the evaluation method that produced this result has passed review.';

export const WITHDRAWN_DESCRIPTION =
  'Withdrawn: the evaluation method that produced this result was rejected or withdrawn from review, so it is excluded from published reporting.';

/**
 * Map an attribution onto its label, tone and description.
 *
 * Precedence: a non-null `retractedAt` wins over every review status — a
 * retracted APPROVED version must not keep reading as "published". LEGACY
 * has no review status at all, so it is its own word and carries the API's
 * note verbatim as its description.
 */
export function describeAttribution(attribution: ScoreAttribution): AttributionDescription {
  if (attribution.kind === 'LEGACY') {
    return { label: 'legacy', tone: 'neutral', description: attribution.note };
  }

  if (attribution.retractedAt !== null) {
    return { label: 'retracted', tone: 'danger', description: RETRACTED_DESCRIPTION };
  }

  switch (attribution.reviewStatus) {
    case 'APPROVED':
      return { label: 'published', tone: 'success', description: PUBLISHED_DESCRIPTION };
    case 'DECLARED':
    case 'UNDER_REVIEW':
      return { label: 'provisional', tone: 'info', description: PROVISIONAL_DESCRIPTION };
    case 'REJECTED':
    case 'WITHDRAWN':
      return { label: 'withdrawn', tone: 'danger', description: WITHDRAWN_DESCRIPTION };
  }
}

/**
 * Whether a result counts towards published reporting: routed through a
 * version the API marks `published`, and not retracted since. `published` is
 * already false for DECLARED / UNDER_REVIEW, so the review status is not
 * re-derived here — the API's flag is the source of truth.
 */
export function isPublishedResult(attribution: ScoreAttribution | null | undefined): boolean {
  return (
    attribution?.kind === 'ROUTED' && attribution.published === true && !attribution.retractedAt
  );
}

export interface RankedSubmission {
  submission: EvaluationSubmissionResult;
  /** 1-based position among published results; `null` for everything else. */
  rank: number | null;
}

/**
 * Number only the published results, in the order the API returned them
 * (best first on the task's primary metric). Provisional, legacy and
 * retracted rows keep their metrics but get no rank: a number would claim a
 * placing the platform does not stand behind yet. PENDING / FAILED rows have
 * no attribution at all and fall out the same way.
 */
export function rankSubmissions(
  submissions: readonly EvaluationSubmissionResult[],
): RankedSubmission[] {
  let nextRank = 0;
  return submissions.map((submission) => ({
    submission,
    rank: isPublishedResult(submission.attribution) ? (nextRank += 1) : null,
  }));
}

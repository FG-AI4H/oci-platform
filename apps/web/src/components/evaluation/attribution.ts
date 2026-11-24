import {
  LEGACY_ATTRIBUTION_NOTE,
  type EvaluationSubmissionResult,
  type ScoreAttribution,
} from '@oci/shared-types';
import type { Translator } from '../../i18n/translator';

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
  /** The label in the interface language, as the badge prints it. */
  text: string;
  tone: AttributionTone;
  /** One sentence a reader (or screen reader) needs to make sense of the label. */
  description: string;
}

/**
 * Map an attribution onto its label, tone and description, worded in the
 * interface language (#654).
 *
 * Precedence: a non-null `retractedAt` wins over every review status — a
 * retracted APPROVED version must not keep reading as "published". LEGACY
 * has no review status at all, so it is its own word and carries the API's
 * note verbatim as its description.
 */
export function describeAttribution(
  attribution: ScoreAttribution,
  t: Translator<'Evaluation'>,
): AttributionDescription {
  const words = (
    label: Exclude<AttributionLabel, 'legacy'>,
    tone: AttributionTone,
  ): AttributionDescription => ({
    label,
    text: t(`attribution.label.${label}`),
    tone,
    description: t(`attribution.description.${label}`),
  });

  if (attribution.kind === 'LEGACY') {
    return {
      label: 'legacy',
      text: t('attribution.label.legacy'),
      tone: 'neutral',
      // The API's note is one fixed sentence (`LEGACY_ATTRIBUTION_NOTE`);
      // that one is worded in the interface language, whose English
      // message is the same sentence. Any other note is shown as sent.
      description:
        attribution.note === LEGACY_ATTRIBUTION_NOTE
          ? t('attribution.description.legacy')
          : attribution.note,
    };
  }

  if (attribution.retractedAt !== null) return words('retracted', 'danger');

  switch (attribution.reviewStatus) {
    case 'APPROVED':
      return words('published', 'success');
    case 'DECLARED':
    case 'UNDER_REVIEW':
      return words('provisional', 'info');
    case 'REJECTED':
    case 'WITHDRAWN':
      return words('withdrawn', 'danger');
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

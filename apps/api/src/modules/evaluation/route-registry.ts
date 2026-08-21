import {
  LEGACY_ATTRIBUTION_NOTE,
  PUBLISHABLE_REVIEW_STATUSES,
  type RouteReviewStatus,
  type ScoreAttribution,
} from '@oci/shared-types';

/**
 * Route attribution at the read boundary (WP5 invariant 3, #412).
 *
 * Pure. Kept beside the score-parsing tolerance rather than in a parallel
 * helper: both handle rows written before a contract existed, and two
 * legacy-coercion paths would drift apart.
 *
 * A row scored before the registry existed carries no route. It is labelled
 * LEGACY — not backfilled with the reference route, which would assert a review
 * that never happened, and not hidden, which would silently delete real
 * results. Naming it is the honest third option.
 */
export interface AttributableRow {
  /** Raw stored scores. Null/undefined means nothing to attribute. */
  scores: unknown;
  retractedAt: Date | null;
  routeVersionRef: {
    version: string;
    reviewStatus: RouteReviewStatus;
    route: { slug: string };
  } | null;
}

export function attributionFor(row: AttributableRow): ScoreAttribution | null {
  // Nothing to attribute a score to if there is no score.
  if (row.scores === null || row.scores === undefined) return null;

  const ref = row.routeVersionRef ?? null;
  if (!ref) return { kind: 'LEGACY', note: LEGACY_ATTRIBUTION_NOTE };

  return {
    kind: 'ROUTED',
    routeSlug: ref.route.slug,
    routeVersion: ref.version,
    reviewStatus: ref.reviewStatus,
    // Invariant 2: only APPROVED produces a published result. DECLARED and
    // UNDER_REVIEW still produce results — they are provisional and excluded
    // from published reporting, which is a rendering decision, not a reason to
    // withhold the row.
    published: PUBLISHABLE_REVIEW_STATUSES.includes(ref.reviewStatus),
    retractedAt: row.retractedAt ? row.retractedAt.toISOString() : null,
  };
}

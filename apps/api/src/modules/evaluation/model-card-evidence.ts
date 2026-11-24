import {
  RETRACTING_REVIEW_STATUSES,
  type ModelFactsPerformanceEntry,
  type ModelFactsStanding,
} from '@oci/shared-types';
import type { DatasetVersionRow, LinkedSubmissionRow } from './evaluation.repository.js';
import { parseScores } from './evaluation.service.js';
import { attributionFor } from './route-registry.js';
import { isScorableTaskKind, primaryMetricLabelOf, primaryMetricOf } from './scoring-registry.js';

/**
 * Validation evidence for a model card (#587): the results of the submissions
 * linked to it, as Model Facts performance rows.
 *
 * Pure. Where a result stands is decided by `attributionFor`, the one rule that
 * decides publication everywhere else (the task page, the submission page):
 *
 *   - APPROVED route version, not retracted -> `PUBLISHED`;
 *   - DECLARED or UNDER_REVIEW route version -> `PROVISIONAL`;
 *   - no route version at all (LEGACY) -> `NOT_ATTRIBUTED`. Until route-version
 *     pinning lands (#583) a direct submission records no route version, so
 *     every such result is here. It is listed, labelled, and never published:
 *     backfilling a route would assert a review that never happened;
 *   - REJECTED or WITHDRAWN route version, or a stamped `retractedAt` ->
 *     retracted: not listed, only counted, so the label can say so.
 *
 * A result whose primary metric is not estimable (balanced accuracy on a split
 * with no positive or no negative case) has no number to show and is counted
 * the same way, rather than printed as 0.
 */
export interface ModelCardPerformance {
  /** Every listable result, newest first, each with its `standing`. */
  entries: ModelFactsPerformanceEntry[];
  /** Linked results retracted because their route version was rejected or withdrawn. */
  retracted: number;
  /** Linked results with no estimable primary metric. */
  notEstimable: number;
}

export function modelCardPerformance(
  rows: ReadonlyArray<LinkedSubmissionRow>,
  datasetVersions: ReadonlyArray<DatasetVersionRow>,
): ModelCardPerformance {
  const entries: ModelFactsPerformanceEntry[] = [];
  let retracted = 0;
  let notEstimable = 0;

  for (const row of rows) {
    const scores = parseScores(row.scores);
    if (!scores || !isScorableTaskKind(scores.kind)) {
      notEstimable += 1;
      continue;
    }

    const standing = standingOf(row);
    if (standing === 'RETRACTED') {
      retracted += 1;
      continue;
    }

    const value = primaryMetricOf(scores);
    if (!Number.isFinite(value)) {
      notEstimable += 1;
      continue;
    }

    const evaluatedAt = row.resultReceivedAt ?? row.createdAt;
    const route = row.routeVersionRef;
    entries.push({
      submissionId: row.id,
      taskSlug: row.task.slug,
      taskName: row.task.name,
      taskKind: row.task.taskKind,
      primaryMetricLabel: primaryMetricLabelOf(scores.kind),
      primaryMetricValue: value,
      coverage: scores.metrics.coverage,
      datasetSlug: row.task.datasetSlug,
      datasetVersion: datasetVersionAt(datasetVersions, row.task.datasetSlug, evaluatedAt),
      routeSlug: route?.route.slug ?? null,
      routeVersion: route?.version ?? null,
      routeReviewStatus: route?.reviewStatus ?? null,
      standing,
      evaluatedAt: evaluatedAt.toISOString(),
    });
  }

  return { entries, retracted, notEstimable };
}

/** Where one linked result stands. Only ever called on a row that has scores. */
export function standingOf(row: LinkedSubmissionRow): ModelFactsStanding | 'RETRACTED' {
  const attribution = attributionFor(row);
  if (!attribution || attribution.kind === 'LEGACY') return 'NOT_ATTRIBUTED';
  if (
    attribution.retractedAt !== null ||
    RETRACTING_REVIEW_STATUSES.includes(attribution.reviewStatus)
  ) {
    return 'RETRACTED';
  }
  return attribution.published ? 'PUBLISHED' : 'PROVISIONAL';
}

/**
 * The version of `datasetSlug` most recently published at or before `at`, or
 * null when the catalogue has none then. `versions` may hold any datasets in any
 * order.
 */
export function datasetVersionAt(
  versions: ReadonlyArray<DatasetVersionRow>,
  datasetSlug: string,
  at: Date,
): string | null {
  let best: DatasetVersionRow | null = null;
  for (const v of versions) {
    if (v.datasetSlug !== datasetSlug || v.publishedAt.getTime() > at.getTime()) continue;
    if (!best || v.publishedAt.getTime() > best.publishedAt.getTime()) best = v;
  }
  return best?.version ?? null;
}

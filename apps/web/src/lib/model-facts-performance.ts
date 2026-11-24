import type { ModelFactsLabel, ModelFactsStanding } from '@oci/shared-types';

/**
 * How the Model Facts card lays out its performance rows (#587).
 *
 * The API has already decided where each linked result stands, by the
 * evaluation module's publication rule: `entries` holds the published results
 * only, `provisional` the rest. This keeps the two apart on the page, so a
 * provisional or unattributed result is never read as validation evidence.
 */
export type PerformanceLayout =
  /** Nothing linked to the card at all. */
  | { kind: 'empty' }
  /** Something linked; `published` may be empty while `provisional` is not. */
  | {
      kind: 'results';
      published: ModelFactsLabel['validationAndPerformance']['entries'];
      provisional: ModelFactsLabel['validationAndPerformance']['provisional'];
    };

export function performanceLayout(
  perf: ModelFactsLabel['validationAndPerformance'],
): PerformanceLayout {
  const { provisional } = perf;
  if (perf.entries.length === 0 && provisional.length === 0) return { kind: 'empty' };
  return { kind: 'results', published: perf.entries, provisional };
}

/** The `Models` message key naming a standing, under `facts.standing`. */
export function standingKey(
  standing: ModelFactsStanding,
): 'published' | 'provisional' | 'notAttributed' {
  switch (standing) {
    case 'PUBLISHED':
      return 'published';
    case 'PROVISIONAL':
      return 'provisional';
    case 'NOT_ATTRIBUTED':
      return 'notAttributed';
  }
}

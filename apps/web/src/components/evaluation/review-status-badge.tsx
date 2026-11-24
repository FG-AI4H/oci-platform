import { getTranslations } from 'next-intl/server';
import { Badge } from '@oci/ui';
import type { ScoreAttribution } from '@oci/shared-types';
import { describeAttribution } from './attribution';

export {
  describeAttribution,
  isPublishedResult,
  rankSubmissions,
  type AttributionDescription,
  type AttributionLabel,
  type AttributionTone,
  type RankedSubmission,
} from './attribution';

/**
 * Review-status badge for a scored result (#486). The badge text carries the
 * meaning on its own — colour is reinforcement, not the signal — and the
 * one-sentence description travels with it twice: as a `title` for pointer
 * users and as visually-hidden text for assistive technology, so the word
 * "provisional" is never announced without what it implies.
 *
 * Pages that want the description visible render it themselves from
 * `describeAttribution(...)` and pass `describe={false}`, so assistive
 * technology hears the sentence once rather than in the badge and again in
 * the line beneath it. The badge stays a single short label either way, so
 * it can sit inline after a route name without wrapping.
 *
 * A server component: the label and the sentence are in the request's
 * language (#654).
 */
export async function ReviewStatusBadge({
  attribution,
  describe = true,
  className,
}: {
  attribution: ScoreAttribution;
  /** Include the description as visually-hidden text. Default true. */
  describe?: boolean;
  className?: string;
}) {
  const t = await getTranslations('Evaluation');
  const { text, tone, description } = describeAttribution(attribution, t);
  return (
    <Badge tone={tone} title={description} className={className}>
      <span>{text}</span>
      {describe ? <span className="sr-only">. {description}</span> : null}
    </Badge>
  );
}

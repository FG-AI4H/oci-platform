import Link from 'next/link';
import { Button } from '@oci/ui';

export interface CreateCampaignCtaProps {
  datasetSlug: string;
  /**
   * Visibility-and-access gate.
   *
   *   - admin: always true.
   *   - host of this dataset: true.
   *   - any caller with an APPROVED access-request row for this
   *     dataset: true.
   *   - PUBLIC dataset + any authenticated viewer: true.
   *
   * Resolved by the page from session + ownRequests + visibility.
   * When false we render nothing — the user is not entitled to
   * launch a campaign here.
   */
  authorized: boolean;
  /**
   * Whether the caller has the campaign-manager (or admin) role.
   * When false we render nothing — non-managers don't have
   * permission to launch campaigns at all, regardless of dataset
   * access.
   */
  isCampaignManager: boolean;
}

/**
 * "Create annotation campaign" CTA on the catalog dataset detail page.
 * Surfaces when the viewer is a campaign-manager AND has access to
 * the dataset (user feedback 2026-05-16). Links to
 * `/annotation/campaigns/new?datasetSlug=<slug>`, which pre-fills the
 * dataset picker server-side via a slug lookup.
 */
export function CreateCampaignCta({
  datasetSlug,
  authorized,
  isCampaignManager,
}: CreateCampaignCtaProps) {
  if (!isCampaignManager || !authorized) return null;

  return (
    <div className="mt-4">
      <Button asChild variant="outline" size="sm">
        <Link
          href={`/annotation/campaigns/new?datasetSlug=${encodeURIComponent(datasetSlug)}`}
          aria-label={`Create an annotation campaign on ${datasetSlug}`}
        >
          Create annotation campaign
        </Link>
      </Button>
    </div>
  );
}

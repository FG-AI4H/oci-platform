import Link from 'next/link';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Container,
  Section,
} from '@oci/ui';
import type { AnnotationToolIntegrationSummary, DatasetDetail } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { apiFetch } from '../../../../lib/api';
import { requireCampaignManager } from '../../../../lib/groups';
import { NewCampaignForm, type PreselectedDataset } from './new-campaign-form';

export const metadata = {
  title: 'New campaign — OCI Annotation',
  robots: { index: false, follow: false },
};

interface NewCampaignPageProps {
  /**
   * Optional `?datasetSlug=` (preferred, set by the catalog detail
   * page's "Create annotation campaign" CTA) or legacy `?datasetId=`
   * (still parsed for back-compat — never produced by the platform).
   */
  searchParams: Promise<{ datasetSlug?: string; datasetId?: string }>;
}

export default async function NewCampaignPage({ searchParams }: NewCampaignPageProps) {
  const session = await auth();
  requireCampaignManager(session);

  const { datasetSlug, datasetId } = await searchParams;

  // Resolve the slug to a full dataset summary server-side so the
  // form can render with the picker already populated. Visibility is
  // enforced by the API — if the manager isn't authorised to see the
  // dataset they get a 404 here, and we fall back to the empty
  // picker.
  let preselected: PreselectedDataset | null = null;
  if (datasetSlug) {
    const ds = await apiFetch<DatasetDetail>(
      `/v2/catalog/datasets/${encodeURIComponent(datasetSlug)}`,
      { session, revalidate: 0 },
    );
    if (ds) {
      preselected = {
        id: ds.id,
        slug: ds.slug,
        name: ds.name,
        accessTier: ds.accessTier ?? 'OPEN',
      };
    }
  } else if (datasetId) {
    // Legacy `?datasetId=` (no longer minted by the platform). The
    // form will try to resolve it client-side via the typeahead.
    preselected = null;
  }

  const tools =
    (await apiFetch<AnnotationToolIntegrationSummary[]>('/v2/annotation/tool-integrations', {
      session,
      revalidate: 0,
    })) ?? [];

  return (
    <Container size="md">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href="/annotation/campaigns"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>Campaigns</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Campaign manager workflow
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">New campaign</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            Define a draft campaign. After this step you&apos;ll attach the dataset, recruit
            annotators, and move the campaign into READY. State transitions land with #215.
          </p>
        </header>

        <Alert tone="info" className="mb-6">
          <AlertTitle>Slug is permanent</AlertTitle>
          <AlertDescription>
            The slug becomes part of the campaign URL and the persistence record. Choose
            deliberately — slugs cannot be renamed once published.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Draft details</CardTitle>
          </CardHeader>
          <CardContent>
            <NewCampaignForm toolIntegrations={tools} preselectedDataset={preselected} />
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}

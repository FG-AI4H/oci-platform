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
import type { AnnotationToolIntegrationSummary } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { apiFetch } from '../../../../lib/api';
import { requireCampaignManager } from '../../../../lib/groups';
import { NewCampaignForm } from './new-campaign-form';

export const metadata = {
  title: 'New campaign — OCI Annotation',
  robots: { index: false, follow: false },
};

export default async function NewCampaignPage() {
  const session = await auth();
  requireCampaignManager(session);

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
            <NewCampaignForm toolIntegrations={tools} />
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}

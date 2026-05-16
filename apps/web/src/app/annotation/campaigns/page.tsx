import Link from 'next/link';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Container,
  FlowIcon,
  Section,
} from '@oci/ui';
import type {
  CampaignStatus,
  CampaignSummary,
  CampaignTaskKind,
  ListCampaignsResponse,
} from '@oci/shared-types';
import { auth } from '../../../auth';
import { apiFetch } from '../../../lib/api';
import { isCampaignManager } from '../../../lib/groups';

/**
 * Annotation campaigns list (Phase B.A.1 — #222). Read-only flat
 * listing for now; faceted filtering + queue badges come with #215
 * once the task / supervisor surfaces land.
 */

export const metadata = {
  title: 'Annotation campaigns — OCI Platform',
  description:
    'Annotation campaigns coordinate multi-rater labelling on OCI datasets using the integration-hub orchestrator (ADR-0006).',
};

const STATUS_TONE: Record<CampaignStatus, 'info' | 'primary' | 'success' | 'warning' | 'neutral'> =
  {
    DRAFT: 'info',
    READY: 'primary',
    RUNNING: 'success',
    COMPLETED: 'neutral',
    ARCHIVED: 'neutral',
  };

const TASK_KIND_LABEL: Record<CampaignTaskKind, string> = {
  CLASSIFICATION: 'Classification',
  DETECTION: 'Detection',
  SEGMENTATION: 'Segmentation',
  LOCALIZATION: 'Localisation',
  MULTI_MODAL: 'Multi-modal',
};

export default async function AnnotationCampaignsPage() {
  const session = await auth();
  const canCreate = isCampaignManager(session);

  let response: ListCampaignsResponse | null = null;
  let error: string | null = null;
  try {
    response = await apiFetch<ListCampaignsResponse>('/v2/annotation/campaigns', {
      session,
      revalidate: 0,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach annotation API';
  }

  return (
    <Container>
      <Section spacing="md">
        <header className="mb-6 flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Annotation
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Campaigns</h1>
            {response ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                <span className="text-[var(--color-foreground)] font-medium tabular-nums">
                  {response.totalEstimate.toLocaleString('en-GB')}
                </span>{' '}
                {response.totalEstimate === 1 ? 'campaign' : 'campaigns'}
              </p>
            ) : null}
          </div>
          <p className="max-w-2xl text-[var(--color-muted-foreground)]">
            Campaigns coordinate multi-rater labelling on OCI datasets. OCI orchestrates the
            workflow and provenance; specialised annotation tools — MONAI Label, OHIF, future
            integrations — handle the actual editing.
          </p>
        </header>

        {canCreate ? (
          <div className="mb-4 flex justify-end">
            <Button asChild>
              <Link href="/annotation/campaigns/new">New campaign</Link>
            </Button>
          </div>
        ) : null}

        {error ? (
          <Alert tone="danger">
            <AlertTitle>Campaigns unavailable</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        ) : !response || response.items.length === 0 ? (
          <EmptyState canCreate={canCreate} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {response.items.map((c) => (
              <li key={c.id}>
                <CampaignCard c={c} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Container>
  );
}

function CampaignCard({ c }: { c: CampaignSummary }) {
  return (
    <Link
      href={`/annotation/campaigns/${c.slug}`}
      className="group block h-full rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
    >
      <Card interactive="hover" className="h-full">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="line-clamp-2 group-hover:text-[var(--color-primary)] transition-colors">
              {c.name}
            </CardTitle>
            <Badge tone={STATUS_TONE[c.status]}>{c.status.toLowerCase()}</Badge>
          </div>
          <CardDescription className="line-clamp-3 min-h-[3.5rem]">
            {c.description ?? <em>No description provided.</em>}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-muted-foreground)]">
          <span className="font-mono truncate">{c.slug}</span>
          <Badge tone="neutral">{TASK_KIND_LABEL[c.taskKind]}</Badge>
        </CardContent>
      </Card>
    </Link>
  );
}

function EmptyState({ canCreate }: { canCreate: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-12 text-center">
      <span
        className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-[var(--shadow-xs)]"
        aria-hidden="true"
      >
        <FlowIcon size={20} />
      </span>
      <h2 className="mt-4 text-lg font-semibold">No campaigns yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-muted-foreground)]">
        {canCreate
          ? 'Start the first campaign to coordinate multi-rater annotation on one of your datasets.'
          : 'Campaign managers will start the first annotation campaign here.'}
      </p>
      {canCreate ? (
        <div className="mt-5">
          <Button asChild size="sm">
            <Link href="/annotation/campaigns/new">New campaign</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

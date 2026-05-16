import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeftIcon,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Container,
  DefinitionItem,
  DefinitionList,
  Section,
} from '@oci/ui';
import {
  availableCampaignActions,
  type CampaignDetail,
  type CampaignStatus,
  type CampaignTaskKind,
} from '@oci/shared-types';
import { auth } from '../../../../auth';
import { apiFetch } from '../../../../lib/api';
import { isCampaignManager } from '../../../../lib/groups';
import { TransitionActions } from './transition-actions';

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

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  return {
    title: `${slug} — Annotation campaigns`,
    robots: { index: false, follow: false },
  };
}

export default async function CampaignDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const session = await auth();

  const detail = await apiFetch<CampaignDetail>(
    `/v2/annotation/campaigns/${encodeURIComponent(slug)}`,
    { session, revalidate: 0 },
  );
  if (!detail) notFound();

  const dateFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const canManage = isCampaignManager(session);
  const actions = availableCampaignActions(detail.status);

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
            Annotation campaign
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{detail.name}</h1>
            <Badge tone={STATUS_TONE[detail.status]}>{detail.status.toLowerCase()}</Badge>
          </div>
          <p className="font-mono text-sm text-[var(--color-muted-foreground)]">{detail.slug}</p>
          {detail.description ? (
            <p className="max-w-prose text-[var(--color-muted-foreground)]">{detail.description}</p>
          ) : null}
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term="Task kind">{TASK_KIND_LABEL[detail.taskKind]}</DefinitionItem>
                <DefinitionItem term="Annotators per data point">
                  <span className="tabular-nums">{detail.workflowConfig.nAnnotators}</span>
                </DefinitionItem>
                <DefinitionItem term="Output license" mono>
                  {detail.outputLicense}
                </DefinitionItem>
                <DefinitionItem term="Dataset" mono>
                  {detail.datasetId}
                </DefinitionItem>
              </DefinitionList>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Annotation tool</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term="Name">{detail.toolIntegration.name}</DefinitionItem>
                <DefinitionItem term="Vendor">{detail.toolIntegration.vendor}</DefinitionItem>
                <DefinitionItem term="Version" mono>
                  {detail.toolIntegration.version}
                </DefinitionItem>
                <DefinitionItem term="Identifier" mono>
                  {detail.toolIntegration.slug}
                </DefinitionItem>
              </DefinitionList>
            </CardContent>
          </Card>
        </div>

        {canManage ? (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Lifecycle</CardTitle>
            </CardHeader>
            <CardContent>
              <TransitionActions slug={detail.slug} current={detail.status} actions={actions} />
            </CardContent>
          </Card>
        ) : null}

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Audit</CardTitle>
          </CardHeader>
          <CardContent>
            <DefinitionList>
              <DefinitionItem term="Created">
                <time dateTime={detail.createdAt}>
                  {dateFmt.format(new Date(detail.createdAt))}
                </time>
              </DefinitionItem>
              <DefinitionItem term="Updated">
                <time dateTime={detail.updatedAt}>
                  {dateFmt.format(new Date(detail.updatedAt))}
                </time>
              </DefinitionItem>
              {detail.startedAt ? (
                <DefinitionItem term="Started">
                  <time dateTime={detail.startedAt}>
                    {dateFmt.format(new Date(detail.startedAt))}
                  </time>
                </DefinitionItem>
              ) : null}
              {detail.completedAt ? (
                <DefinitionItem term="Completed">
                  <time dateTime={detail.completedAt}>
                    {dateFmt.format(new Date(detail.completedAt))}
                  </time>
                </DefinitionItem>
              ) : null}
              <DefinitionItem term="Created by" mono>
                {detail.createdById}
              </DefinitionItem>
            </DefinitionList>
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
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
  type CampaignAgreement,
  type CampaignDetail,
  type CampaignStatus,
  type TaskSummary,
} from '@oci/shared-types';
import { auth } from '../../../../auth';
import { getFormatters } from '../../../../i18n/server';
import { ApiError, apiFetch } from '../../../../lib/api';
import { canOverseeCampaign, isAnnotationWorker, isCampaignManager } from '../../../../lib/groups';
import { AgreementCard } from './agreement-card';
import { ProgressCard } from './progress-card';
import { TasksCard } from './tasks-card';
import { TransitionActions } from './transition-actions';

const STATUS_TONE: Record<CampaignStatus, 'info' | 'primary' | 'success' | 'warning' | 'neutral'> =
  {
    DRAFT: 'info',
    READY: 'primary',
    RUNNING: 'success',
    COMPLETED: 'neutral',
    ARCHIVED: 'neutral',
  };

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const t = await getTranslations('Campaign.detail');
  return {
    title: t('metaTitle', { slug }),
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

  const [t, tc, fmt] = await Promise.all([
    getTranslations('Campaign.detail'),
    getTranslations('Campaign'),
    getFormatters(),
  ]);
  const when = (value: string) => fmt.dateTime(value);
  const canManage = isCampaignManager(session);
  const canAnnotate = isAnnotationWorker(session) && detail.status === 'RUNNING';
  const actions = availableCampaignActions(detail.status);

  // Managers and supervisors read the task list (#556 extends it to
  // supervisors, matching the endpoint's role guard): both get the
  // Progress card, only managers the Tasks card with seeding.
  // Annotators don't need it (they have the /annotate route below).
  const hasTasks = detail.status === 'RUNNING' || detail.status === 'COMPLETED';
  const canOversee = canOverseeCampaign(session);
  const tasks =
    canOversee && hasTasks
      ? ((await apiFetch<TaskSummary[]>(
          `/v2/annotation/campaigns/${encodeURIComponent(detail.slug)}/tasks`,
          { session, revalidate: 0 },
        )) ?? [])
      : [];
  // Agreement between readers (#648), for the same audience. A failure
  // shows in the card, not as a broken page.
  const agreement =
    canOversee && hasTasks
      ? await apiFetch<CampaignAgreement>(
          `/v2/annotation/campaigns/${encodeURIComponent(detail.slug)}/agreement`,
          { session, revalidate: 0 },
        ).catch((err: unknown) => {
          if (err instanceof ApiError) return null;
          throw err;
        })
      : null;

  return (
    <Container size="md">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href="/annotation/campaigns"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>{t('back')}</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('eyebrow')}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{detail.name}</h1>
            <Badge tone={STATUS_TONE[detail.status]}>{tc(`status.${detail.status}`)}</Badge>
          </div>
          <p className="font-mono text-sm text-[var(--color-muted-foreground)]">{detail.slug}</p>
          {detail.description ? (
            <p className="max-w-prose text-[var(--color-muted-foreground)]">{detail.description}</p>
          ) : null}
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('configuration')}</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term={t('taskKind')}>
                  {tc(`taskKind.${detail.taskKind}`)}
                </DefinitionItem>
                <DefinitionItem term={t('nAnnotators')}>
                  <span className="tabular-nums">{detail.workflowConfig.nAnnotators}</span>
                </DefinitionItem>
                <DefinitionItem term={t('outputLicense')} mono>
                  {detail.outputLicense}
                </DefinitionItem>
                <DefinitionItem term={t('dataset')} mono>
                  {detail.datasetId}
                </DefinitionItem>
              </DefinitionList>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('tool')}</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term={t('toolName')}>{detail.toolIntegration.name}</DefinitionItem>
                <DefinitionItem term={t('vendor')}>{detail.toolIntegration.vendor}</DefinitionItem>
                <DefinitionItem term={t('version')} mono>
                  {detail.toolIntegration.version}
                </DefinitionItem>
                <DefinitionItem term={t('identifier')} mono>
                  {detail.toolIntegration.slug}
                </DefinitionItem>
              </DefinitionList>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{t('instructions')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-[var(--color-muted-foreground)]">
              {detail.currentInstructionsVersion
                ? t.rich('currentVersion', {
                    version: detail.currentInstructionsVersion,
                    mono: (chunks) => <span className="font-mono">{chunks}</span>,
                  })
                : t('noInstructions')}
            </p>
            <Link
              href={`/annotation/campaigns/${detail.slug}/instructions`}
              className="inline-flex items-center justify-center rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
            >
              {canManage ? t('editInstructions') : t('readInstructions')}
            </Link>
          </CardContent>
        </Card>

        {canManage ? (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('lifecycle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <TransitionActions slug={detail.slug} current={detail.status} actions={actions} />
            </CardContent>
          </Card>
        ) : null}

        {canOversee ? (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('calibration')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-[var(--color-muted-foreground)]">
                {t('calibrationBody')}
              </p>
              <Link
                href={`/annotation/campaigns/${detail.slug}/calibration`}
                className="inline-flex items-center justify-center rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
              >
                {t('calibrationLink')}
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {canAnnotate ? (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('annotate')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-[var(--color-muted-foreground)]">
                {t('annotateBody')}
              </p>
              <Link
                href={`/annotation/campaigns/${detail.slug}/annotate`}
                className="inline-flex items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
              >
                {t('openQueue')}
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {canOversee && hasTasks ? (
          <Card className="mt-4" id="campaign-progress">
            <CardHeader>
              <CardTitle>{t('progress')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ProgressCard tasks={tasks} today={new Date()} />
            </CardContent>
          </Card>
        ) : null}

        {canOversee && hasTasks ? (
          <AgreementCard slug={detail.slug} agreement={agreement} canExport={canOversee} />
        ) : null}

        {canManage && hasTasks ? (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('tasks')}</CardTitle>
            </CardHeader>
            <CardContent>
              <TasksCard slug={detail.slug} tasks={tasks} canSeed={detail.status === 'RUNNING'} />
            </CardContent>
          </Card>
        ) : null}

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{t('audit')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DefinitionList>
              <DefinitionItem term={t('created')}>
                <time dateTime={detail.createdAt}>{when(detail.createdAt)}</time>
              </DefinitionItem>
              <DefinitionItem term={t('updated')}>
                <time dateTime={detail.updatedAt}>{when(detail.updatedAt)}</time>
              </DefinitionItem>
              {detail.startedAt ? (
                <DefinitionItem term={t('started')}>
                  <time dateTime={detail.startedAt}>{when(detail.startedAt)}</time>
                </DefinitionItem>
              ) : null}
              {detail.completedAt ? (
                <DefinitionItem term={t('completed')}>
                  <time dateTime={detail.completedAt}>{when(detail.completedAt)}</time>
                </DefinitionItem>
              ) : null}
              <DefinitionItem term={t('createdBy')} mono>
                {detail.createdById}
              </DefinitionItem>
            </DefinitionList>
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
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
  ExternalLinkIcon,
  Section,
} from '@oci/ui';
import {
  CANNOT_ASSESS_LABEL,
  parseDicomSeriesSampleRef,
  parseFileSampleRef,
  type AnnotationGateState,
  type AssignmentReading,
  type AssignmentReadingsResponse,
  type AssignmentSampleResponse,
  type AssignmentSummary,
  type CampaignDetail,
  type ClassificationLabelsConfig,
  type PullNextResponse,
} from '@oci/shared-types';
import { auth } from '../../../../../auth';
import { getFormatters } from '../../../../../i18n/server';
import { apiFetch } from '../../../../../lib/api';
import { annotationGateForCaller } from '../../../../../lib/groups';
import { AnnotateForm } from './annotate-form';
import { ImageViewer } from './image-viewer';
import { ReaderView, ViewRequestProvider } from './reader-view';
import { SampleReadyProvider } from './sample-ready';
import { SkipTaskForm } from './skip-task-form';
import { StartTaskForm } from './start-task-form';
import { TaskSeriesViewer } from './task-series-viewer';

/** The answer form's id; the DICOM viewer's `view` field joins it (#674). */
const ANSWER_FORM_ID = 'annotate-answer';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ after?: string | string[] }>;
}

type Translator = Awaited<ReturnType<typeof getTranslations<'Annotate'>>>;

/** What the annotator just did, set by the submit and skip actions. */
function afterNoticeFor(t: Translator, after: string | string[] | undefined): string | null {
  if (after === 'submitted') return t('page.afterSubmitted');
  if (after === 'skipped') return t('page.afterSkipped');
  if (after === 'closed') return t('page.afterClosed');
  return null;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const t = await getTranslations('Annotate');
  return {
    title: t('metaTitle', { slug }),
    robots: { index: false, follow: false },
  };
}

export default async function AnnotatePage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { after } = await searchParams;
  const [t, fmt] = await Promise.all([getTranslations('Annotate'), getFormatters()]);
  /** A step's name, and the same in running text ("at the … step"). */
  const gateName = (g: AnnotationGateState) => t(`gate.${g}`);
  const stepInText = (g: AnnotationGateState) => gateName(g).toLocaleLowerCase(fmt.intlLocale);
  const afterNotice = afterNoticeFor(t, after);
  const session = await auth();
  if (!session?.user) redirect('/');

  const gate = annotationGateForCaller(session);
  if (!gate) {
    // No annotation role — bounce to the campaign detail page where
    // the caller can see what the campaign is and request a role
    // through their manager.
    redirect(`/annotation/campaigns/${slug}`);
  }

  const detail = await apiFetch<CampaignDetail>(
    `/v2/annotation/campaigns/${encodeURIComponent(slug)}`,
    { session, revalidate: 0 },
  );
  if (!detail) notFound();

  // The caller's in-flight assignment, if any. This read reserves
  // nothing (#646): a task is only taken when the annotator presses
  // Start, so opening the page doesn't hold a slot.
  let assignment: AssignmentSummary | null = null;
  let pullError: string | null = null;
  if (detail.status === 'RUNNING') {
    try {
      const body = await apiFetch<PullNextResponse>(
        `/v2/annotation/campaigns/${encodeURIComponent(slug)}/tasks/current`,
        { session, revalidate: 0 },
      );
      assignment = body?.assignment ?? null;
    } catch (err) {
      // The API's English text goes to the log, not to the reader.
      console.warn(`annotate: reading the queue failed: ${String(err)}`);
      pullError = t('page.queueReadFailed');
    }
  }

  const labels = detail.workflowConfig.classificationLabels ?? null;

  // The sample (#646), tagged by kind: an image or a DICOM series
  // (#674), and at arbitration / expert review what the readers
  // answered. A task whose sample is not a hosted file (free-text refs)
  // has none; the page then falls back to showing the reference. A
  // hosted sample that could not be fetched leaves the reader nothing
  // to look at, so the page offers Skip only (#646 review, item 5).
  const hostedSample =
    assignment !== null &&
    (parseFileSampleRef(assignment.sampleRef) !== null ||
      parseDicomSeriesSampleRef(assignment.sampleRef) !== null);
  let sample: AssignmentSampleResponse | null = null;
  let readings: AssignmentReading[] | null = null;
  if (assignment) {
    const body = await apiFetch<AssignmentSampleResponse>(
      `/v2/annotation/assignments/${encodeURIComponent(assignment.id)}/sample`,
      { session, revalidate: 0 },
    ).catch(() => null);
    sample = body ?? null;
    if (assignment.gateAtAssignment !== 'INDEPENDENT' && labels) {
      readings =
        (
          await apiFetch<AssignmentReadingsResponse>(
            `/v2/annotation/assignments/${encodeURIComponent(assignment.id)}/readings`,
            { session, revalidate: 0 },
          ).catch(() => null)
        )?.readings ?? null;
    }
  }

  return (
    <Container size={sample ? 'page' : 'md'}>
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href={`/annotation/campaigns/${detail.slug}`}
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>{t('page.back')}</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('page.eyebrow')}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{detail.name}</h1>
            <Badge tone="info">{gateName(gate)}</Badge>
          </div>
          <p className="font-mono text-sm text-[var(--color-muted-foreground)]">{detail.slug}</p>
          {/* New tab, so the instructions stay open beside the task. */}
          <Link
            href={`/annotation/campaigns/${detail.slug}/instructions`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('page.instructionsNewTab')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <span>{t('page.instructions')}</span>
            <ExternalLinkIcon size={14} aria-hidden="true" />
          </Link>
        </header>

        {detail.status !== 'RUNNING' ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('page.pausedTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                {t.rich('page.pausedBody', {
                  status: t(`campaignStatus.${detail.status}`),
                  code: detail.status,
                  // The raw status, beside its translation, for anyone
                  // telling the campaign manager what they see.
                  raw: (chunks) => <code className="text-xs">{chunks}</code>,
                })}
              </p>
            </CardContent>
          </Card>
        ) : pullError ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('page.queueUnreachableTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{pullError}</p>
            </CardContent>
          </Card>
        ) : assignment && hostedSample && !sample ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('page.sampleFailedTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p role="alert" className="text-sm">
                {t('page.sampleFailedBody')}
              </p>
              <SkipTaskForm slug={detail.slug} assignmentId={assignment.id} />
            </CardContent>
          </Card>
        ) : assignment ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('page.currentTask')}</CardTitle>
            </CardHeader>
            <MaybeSampleReady waitForSample={sample !== null}>
              <CardContent
                className={sample ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]' : 'space-y-5'}
              >
                {sample?.kind === 'image' ? (
                  <ImageViewer
                    // A fresh viewer per task: zoom, filters and the fade-in
                    // start over with each image.
                    key={assignment.id}
                    src={sample.url}
                    alt={t('page.imageAlt', { step: stepInText(assignment.gateAtAssignment) })}
                  />
                ) : sample?.kind === 'dicom-series' ? (
                  <TaskSeriesViewer
                    key={assignment.id}
                    assignmentId={assignment.id}
                    initial={sample}
                    label={t('page.seriesLabel', { step: stepInText(assignment.gateAtAssignment) })}
                    formId={ANSWER_FORM_ID}
                  />
                ) : null}
                <div className="space-y-5">
                  <DefinitionList>
                    {/* The file name can carry the answer (ADR-0010), so it is
                      shown only when there is no image to look at. */}
                    {sample ? null : (
                      <DefinitionItem term={t('page.sample')} mono>
                        {assignment.sampleRef}
                      </DefinitionItem>
                    )}
                    <DefinitionItem term={t('page.step')}>
                      {gateName(assignment.gateAtAssignment)}
                    </DefinitionItem>
                    <DefinitionItem term={t('page.assigned')}>
                      <time dateTime={assignment.assignedAt}>
                        {fmt.dateTime(assignment.assignedAt)}
                      </time>
                    </DefinitionItem>
                  </DefinitionList>
                  {readings && labels ? (
                    <ReadersAnswers
                      readings={readings}
                      labels={labels}
                      text={{
                        title: t('page.readersAnswered'),
                        none: t('page.noReadings'),
                        cannotAssess: t('cannotAssess'),
                      }}
                    />
                  ) : null}
                  <AnnotateForm
                    slug={detail.slug}
                    assignment={assignment}
                    instructionsVersion={detail.currentInstructionsVersion}
                    labels={labels}
                    reasonRequired={
                      labels !== null && assignment.gateAtAssignment === 'AWAITING_ARBITRATION'
                    }
                    formId={ANSWER_FORM_ID}
                  />
                </div>
              </CardContent>
            </MaybeSampleReady>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{afterNotice ? t('page.nextTaskTitle') : t('page.readyTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {afterNotice ? (
                <p role="status" className="text-sm">
                  {afterNotice}
                </p>
              ) : (
                <p className="text-sm">{t('page.startPrompt', { step: stepInText(gate) })}</p>
              )}
              <StartTaskForm
                slug={detail.slug}
                label={afterNotice ? t('page.startNext') : t('page.start')}
                autoFocus={afterNotice !== null}
              />
            </CardContent>
          </Card>
        )}
      </Section>
    </Container>
  );
}

/** The ready-state provider, only when there is a sample to wait for. */
function MaybeSampleReady({
  waitForSample,
  children,
}: {
  waitForSample: boolean;
  children: React.ReactNode;
}) {
  // The readers' answers can ask the viewer to show where each one
  // looked (#674); harmless where there is no series.
  return (
    <ViewRequestProvider>
      {waitForSample ? <SampleReadyProvider>{children}</SampleReadyProvider> : children}
    </ViewRequestProvider>
  );
}

/**
 * What the independent readers answered, for arbitration (#646): each
 * label with its comment, never who gave it. The API sorts them by
 * label, so the order says nothing about who read first.
 */
function ReadersAnswers({
  readings,
  labels,
  text,
}: {
  readings: readonly AssignmentReading[];
  labels: ClassificationLabelsConfig;
  text: { title: string; none: string; cannotAssess: string };
}) {
  const display = new Map(labels.labels.map((l) => [l.value, l.display]));
  display.set(CANNOT_ASSESS_LABEL, text.cannotAssess);
  return (
    <section
      aria-labelledby="readers-answers"
      className="rounded-md border border-[var(--color-border)] p-3"
    >
      <h2 id="readers-answers" className="text-sm font-medium">
        {text.title}
      </h2>
      {readings.length === 0 ? (
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{text.none}</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {readings.map((r, i) => (
            // Readings carry no id; the sorted position is stable.
            <li key={i}>
              <span className="font-medium">{display.get(r.label) ?? r.label}</span>
              {r.comment ? (
                <p className="mt-0.5 whitespace-pre-line text-[var(--color-muted-foreground)]">
                  {r.comment}
                </p>
              ) : null}
              {r.view ? <ReaderView view={r.view} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

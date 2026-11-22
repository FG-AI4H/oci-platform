import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
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
  type AnnotationGateState,
  type AssignmentReading,
  type AssignmentReadingsResponse,
  type AssignmentSampleFile,
  type AssignmentSampleResponse,
  type AssignmentSummary,
  type CampaignDetail,
  type ClassificationLabelsConfig,
  type PullNextResponse,
} from '@oci/shared-types';
import { auth } from '../../../../../auth';
import { apiFetch } from '../../../../../lib/api';
import { annotationGateForCaller } from '../../../../../lib/groups';
import { AnnotateForm } from './annotate-form';
import { ImageViewer } from './image-viewer';
import { StartTaskForm } from './start-task-form';

const GATE_LABEL: Record<AnnotationGateState, string> = {
  INDEPENDENT: 'Independent annotation',
  AWAITING_ARBITRATION: 'Arbitration',
  AWAITING_EXPERT: 'Expert review',
  COMPLETED: 'Completed',
  SKIPPED: 'Skipped',
};

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ after?: string | string[] }>;
}

/** What the annotator just did, set by the submit and skip actions. */
function afterNoticeFor(after: string | string[] | undefined): string | null {
  if (after === 'submitted') return 'Your annotation was saved.';
  if (after === 'skipped') return 'Task skipped. It goes back to the queue for someone else.';
  return null;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  return {
    title: `Annotate · ${slug}`,
    robots: { index: false, follow: false },
  };
}

export default async function AnnotatePage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { after } = await searchParams;
  const afterNotice = afterNoticeFor(after);
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
      pullError = err instanceof Error ? err.message : 'Could not read the queue.';
    }
  }

  const labels = detail.workflowConfig.classificationLabels ?? null;

  // The sample's files (#646), and at arbitration / expert review what
  // the readers answered. A task whose sample is not a hosted file
  // (free-text refs), or not one this page can show, has no image; the
  // page then falls back to showing the reference.
  let sample: AssignmentSampleFile | null = null;
  let readings: AssignmentReading[] | null = null;
  if (assignment) {
    const body = await apiFetch<AssignmentSampleResponse>(
      `/v2/annotation/assignments/${encodeURIComponent(assignment.id)}/sample`,
      { session, revalidate: 0 },
    ).catch(() => null);
    sample = viewableImage(body);
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
            <span>Back to campaign</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Annotator queue
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{detail.name}</h1>
            {/* eslint-disable-next-line security/detect-object-injection -- typed enum key */}
            <Badge tone="info">{GATE_LABEL[gate]}</Badge>
          </div>
          <p className="font-mono text-sm text-[var(--color-muted-foreground)]">{detail.slug}</p>
          {/* New tab, so the instructions stay open beside the task. */}
          <Link
            href={`/annotation/campaigns/${detail.slug}/instructions`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Instructions (opens in new tab)"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <span>Instructions</span>
            <ExternalLinkIcon size={14} aria-hidden="true" />
          </Link>
        </header>

        {detail.status !== 'RUNNING' ? (
          <Card>
            <CardHeader>
              <CardTitle>Queue paused</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                This campaign is <code className="text-xs">{detail.status}</code>. Annotators only
                pick up work while the campaign is RUNNING. Ask the campaign manager when it&apos;s
                expected to resume.
              </p>
            </CardContent>
          </Card>
        ) : pullError ? (
          <Card>
            <CardHeader>
              <CardTitle>Couldn&apos;t reach the queue</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{pullError}</p>
            </CardContent>
          </Card>
        ) : assignment ? (
          <Card>
            <CardHeader>
              <CardTitle>Your current task</CardTitle>
            </CardHeader>
            <CardContent
              className={sample ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]' : 'space-y-5'}
            >
              {sample ? (
                <ImageViewer
                  // A fresh viewer per task: zoom, filters and the fade-in
                  // start over with each image.
                  key={assignment.id}
                  src={sample.url}
                  alt={`Image to read at the ${GATE_LABEL[assignment.gateAtAssignment].toLowerCase()} step`}
                />
              ) : null}
              <div className="space-y-5">
                <DefinitionList>
                  {/* The file name can carry the answer (ADR-0010), so it is
                      shown only when there is no image to look at. */}
                  {sample ? null : (
                    <DefinitionItem term="Sample" mono>
                      {assignment.sampleRef}
                    </DefinitionItem>
                  )}
                  <DefinitionItem term="Step">
                    {GATE_LABEL[assignment.gateAtAssignment]}
                  </DefinitionItem>
                  <DefinitionItem term="Assigned">
                    <time dateTime={assignment.assignedAt}>
                      {new Intl.DateTimeFormat('en-GB', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(assignment.assignedAt))}
                    </time>
                  </DefinitionItem>
                </DefinitionList>
                {readings && labels ? <ReadersAnswers readings={readings} labels={labels} /> : null}
                <AnnotateForm
                  slug={detail.slug}
                  assignment={assignment}
                  instructionsVersion={detail.currentInstructionsVersion}
                  labels={labels}
                  reasonRequired={
                    labels !== null && assignment.gateAtAssignment === 'AWAITING_ARBITRATION'
                  }
                />
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{afterNotice ? 'Next task' : 'Ready when you are'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {afterNotice ? (
                <p role="status" className="text-sm">
                  {afterNotice}
                </p>
              ) : (
                <p className="text-sm">
                  {/* eslint-disable-next-line security/detect-object-injection -- typed enum key */}
                  Press Start to take the next task at the {GATE_LABEL[gate].toLowerCase()} step.
                  Nothing is reserved for you until you do.
                </p>
              )}
              <StartTaskForm
                slug={detail.slug}
                label={afterNotice ? 'Start the next task' : 'Start'}
                autoFocus={afterNotice !== null}
              />
            </CardContent>
          </Card>
        )}
      </Section>
    </Container>
  );
}

/**
 * The one image the viewer can show, or null. The sample address
 * returns a list of files whatever the type (#674 adds DICOM series);
 * this page's viewer reads a single PNG or JPEG.
 */
function viewableImage(sample: AssignmentSampleResponse | null): AssignmentSampleFile | null {
  if (!sample || sample.files.length !== 1) return null;
  const [file] = sample.files;
  return file && (file.contentType === 'image/png' || file.contentType === 'image/jpeg')
    ? file
    : null;
}

/**
 * What the independent readers answered, for arbitration (#646): each
 * label with its comment, never who gave it. The API sorts them by
 * label, so the order says nothing about who read first.
 */
function ReadersAnswers({
  readings,
  labels,
}: {
  readings: readonly AssignmentReading[];
  labels: ClassificationLabelsConfig;
}) {
  const display = new Map(labels.labels.map((l) => [l.value, l.display]));
  display.set(CANNOT_ASSESS_LABEL, 'Cannot assess');
  return (
    <section
      aria-labelledby="readers-answers"
      className="rounded-md border border-[var(--color-border)] p-3"
    >
      <h2 id="readers-answers" className="text-sm font-medium">
        What the readers answered
      </h2>
      {readings.length === 0 ? (
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">No readings recorded.</p>
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

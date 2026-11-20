import Link from 'next/link';
import { notFound, redirect, unstable_rethrow } from 'next/navigation';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Container,
  DefinitionItem,
  DefinitionList,
  Section,
} from '@oci/ui';
import type {
  ClassMetrics,
  EvaluationSubmissionDetail,
  ScoreAttribution,
  SubmissionStatus,
} from '@oci/shared-types';
import { auth } from '../../../../../auth';
import {
  formatRate,
  metricCells,
  TASK_KIND_LABEL,
  type MetricCell,
} from '../../../../../components/evaluation/metrics';
import {
  describeAttribution,
  ReviewStatusBadge,
} from '../../../../../components/evaluation/review-status-badge';
import { ApiError, apiFetch, reauthUrl } from '../../../../../lib/api';

/**
 * One submission's own page (#645): its metrics, the per-class table where the
 * task kind has one, and the evaluation method version behind the numbers.
 *
 * WHO SEES IT is the API's decision, not this page's. A scored or pending
 * submission is public. A failed one comes back only for its submitter and for
 * administrators; for anyone else the API answers 404 and so does this page.
 * The session's token is forwarded server-side so the submitter is recognised.
 *
 * Not here yet, on purpose: the link to the submitter's model card and the
 * link to the evidence summary. Both depend on work that has not landed, and a
 * link to nothing is worse than no link.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

const STATUS_TONE: Record<SubmissionStatus, 'success' | 'info' | 'danger'> = {
  SCORED: 'success',
  PENDING: 'info',
  FAILED: 'danger',
};

const LINK =
  'rounded font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug } = await params;
  return {
    title: `Submission — ${slug} — OCI Evaluation`,
    description: `Result of one submission to the ${slug} evaluation task.`,
    // One page per attempt, most of them of interest to their author only.
    robots: { index: false, follow: false },
  };
}

/**
 * Load the submission as the reader. A session whose token the API no longer
 * accepts must not hide a public result, so a 401 is retried without the
 * token; only if that finds nothing is the reader sent to sign in again, since
 * the page may be a failed attempt of their own.
 */
async function loadSubmission(
  slug: string,
  id: string,
): Promise<EvaluationSubmissionDetail | null> {
  const path = `/v2/evaluation/tasks/${encodeURIComponent(slug)}/submissions/${id}`;
  const session = await auth();
  try {
    return await apiFetch<EvaluationSubmissionDetail>(path, { session, revalidate: 0 });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401 || !session) throw err;
  }
  const anonymous = await apiFetch<EvaluationSubmissionDetail>(path, { revalidate: 0 });
  if (!anonymous) redirect(reauthUrl(`/evaluation/${slug}/submissions/${id}`));
  return anonymous;
}

export default async function SubmissionPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  // Anything that is not a submission id is not found, without asking the API.
  if (!UUID.test(id)) notFound();

  let submission: EvaluationSubmissionDetail | null = null;
  let error: string | null = null;
  try {
    submission = await loadSubmission(slug, id);
  } catch (err) {
    // `redirect()` works by throwing; let it through.
    unstable_rethrow(err);
    error = err instanceof Error ? err.message : 'Unable to reach evaluation API';
  }

  if (error) {
    return (
      <Container size="md">
        <Section spacing="md">
          <Alert tone="danger">
            <AlertTitle as="h1">Evaluation unavailable</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        </Section>
      </Container>
    );
  }
  if (!submission) notFound();

  const { task, scores, attribution, failure } = submission;
  const taskHref = `/evaluation/${encodeURIComponent(task.slug)}` as const;
  const cells = metricCells(task, scores);
  const perClass = scores?.kind === 'CLASSIFICATION' ? scores.metrics.perClass : null;

  return (
    <>
      <Section spacing="md" surface="hero">
        <Container size="lg">
          <Link
            href={taskHref}
            className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <ArrowLeftIcon size={14} />
            <span>{task.name}</span>
          </Link>
          <p className="mt-4 text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Submission
          </p>
          <h1 className="mt-2 break-words text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--color-foreground)]">
            {submission.methodName}
          </h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--color-muted-foreground)]">
            <Badge tone={STATUS_TONE[submission.status]}>{submission.status.toLowerCase()}</Badge>
            <span>
              Submitted{' '}
              <time dateTime={submission.createdAt}>
                {DATE_TIME_FORMATTER.format(new Date(submission.createdAt))} UTC
              </time>
            </span>
            {submission.viewerIsSubmitter ? (
              <span className="font-medium text-[var(--color-foreground)]">
                This is your submission.
              </span>
            ) : null}
          </p>
        </Container>
      </Section>

      <Container size="lg">
        <Section spacing="md" className="space-y-8">
          {failure ? (
            <Alert tone="danger">
              <AlertTitle as="h2">This file was not scored</AlertTitle>
              <AlertDescription className="mt-2 space-y-3">
                <p className="break-words font-mono text-xs text-[var(--color-foreground)]">
                  {failure.reason}
                </p>
                <p>
                  {failure.quotaConsumed
                    ? 'This attempt counted as one scored submission.'
                    : 'This attempt did not count as a scored submission.'}{' '}
                  {submission.viewerIsSubmitter
                    ? 'Only you and the platform’s administrators can see this page.'
                    : 'Only its submitter and the platform’s administrators can see this page.'}
                </p>
                {submission.viewerIsSubmitter ? (
                  <p>
                    <Button asChild variant="secondary">
                      <Link href={`${taskHref}/submit`}>Check a corrected file</Link>
                    </Button>
                  </p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {submission.status === 'PENDING' ? (
            <Alert tone="info">
              <AlertTitle as="h2">Waiting for the result</AlertTitle>
              <AlertDescription>
                This submission has been accepted and is not scored yet. Reload the page later.
              </AlertDescription>
            </Alert>
          ) : null}

          {scores ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Metrics</CardTitle>
                <CardDescription>
                  Computed against the reference labels of{' '}
                  <Link href={taskHref} className={LINK}>
                    {task.name}
                  </Link>
                  . They can be compared with other submissions to this task, and with no other
                  task.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MetricList cells={cells} />
              </CardContent>
            </Card>
          ) : null}

          {perClass ? <PerClassCard perClass={perClass} /> : null}

          {attribution ? <MethodCard attribution={attribution} /> : null}

          <Card>
            <CardHeader>
              <CardTitle as="h2">Task</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term="Task">
                  <Link href={taskHref} className={LINK}>
                    {task.name}
                  </Link>
                </DefinitionItem>
                <DefinitionItem term="Task kind">{TASK_KIND_LABEL[task.taskKind]}</DefinitionItem>
                <DefinitionItem term="Scored dataset">
                  <Link href={`/catalog/${task.datasetSlug}`} className={LINK}>
                    {task.datasetSlug}
                  </Link>
                </DefinitionItem>
                {task.taskKind === 'GRADING' ? (
                  <>
                    <DefinitionItem term="Grades">
                      <span className="tabular-nums">0 to {task.numClasses - 1}</span>
                    </DefinitionItem>
                    <DefinitionItem term="Referable threshold">
                      <span className="tabular-nums">{task.referableThreshold}</span>{' '}
                      <span className="text-[var(--color-muted-foreground)]">
                        — a grade of {task.referableThreshold} or more counts as referable.
                      </span>
                    </DefinitionItem>
                  </>
                ) : (
                  <DefinitionItem term="Classes">
                    <span className="tabular-nums">{task.numClasses}</span>{' '}
                    <span className="text-[var(--color-muted-foreground)]">
                      (label 0 to {task.numClasses - 1})
                    </span>
                  </DefinitionItem>
                )}
              </DefinitionList>
            </CardContent>
          </Card>

          <p className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href={taskHref} className={LINK}>
              All results for this task
            </Link>
            <Link href={`${taskHref}/submit`} className={LINK}>
              {submission.viewerIsSubmitter ? 'Submit another file' : 'Submit predictions'}
            </Link>
          </p>
        </Section>
      </Container>
    </>
  );
}

/**
 * The metrics with what each one measures. The first is the task kind's
 * headline metric (the one results are ordered by) and is set larger; the rest
 * follow in a grid. Every number has its sentence, because this page is where
 * someone reads a result for the first time.
 */
function MetricList({ cells }: { cells: MetricCell[] }) {
  // One level of <div> between <dl> and its <dt>/<dd> pairs is all HTML allows,
  // so the headline and the others are siblings in one grid.
  return (
    <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
      {cells.map((cell, i) =>
        i === 0 ? (
          <div key={cell.label} className="rounded-lg bg-[var(--color-subtle)] p-5 sm:col-span-2">
            <dt className="text-sm font-medium text-[var(--color-muted-foreground)]">
              {cell.label}
            </dt>
            <dd className="mt-1">
              <span className="text-4xl font-semibold tabular-nums text-[var(--color-foreground)]">
                {cell.value}
              </span>
              <span className="mt-2 block max-w-prose text-sm text-[var(--color-muted-foreground)]">
                {cell.explanation}
              </span>
            </dd>
          </div>
        ) : (
          <div key={cell.label}>
            <dt className="text-sm font-medium text-[var(--color-muted-foreground)]">
              {cell.label}
            </dt>
            <dd className="mt-1">
              <span className="text-2xl font-semibold tabular-nums text-[var(--color-foreground)]">
                {cell.value}
              </span>
              <span className="mt-1 block text-sm text-[var(--color-muted-foreground)]">
                {cell.explanation}
              </span>
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

/**
 * Per-class precision, recall and F1. Only a classification task has this
 * breakdown; a grading task's scores carry no per-class figures, so there is
 * no table to show for one.
 */
function PerClassCard({ perClass }: { perClass: ClassMetrics[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Per-class results</CardTitle>
        <CardDescription>
          How the file did on each class. Precision: of the items it gave this label, the share that
          have it. Recall: of the items that have this label, the share it found. F1 combines the
          two. Items is the number of scored items with this reference label.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Fits a phone; focusable in case a very narrow screen still makes it scroll. */}
        <div
          tabIndex={0}
          role="region"
          aria-label="Per-class results table"
          className="overflow-x-auto rounded-lg border border-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          <table className="w-full border-collapse text-xs sm:text-sm">
            <thead className="bg-[var(--color-subtle)] text-[var(--color-muted-foreground)]">
              <tr>
                <th scope="col" className="px-1.5 py-2.5 text-start font-medium sm:px-4">
                  Class
                </th>
                {['Precision', 'Recall', 'F1', 'Items'].map((h) => (
                  <th key={h} scope="col" className="px-1.5 py-2.5 text-end font-medium sm:px-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perClass.map((c) => (
                <tr key={c.label} className="border-t border-[var(--color-border)]">
                  <th
                    scope="row"
                    className="px-1.5 py-2.5 text-start font-medium tabular-nums sm:px-4"
                  >
                    {c.label}
                  </th>
                  {/* With no item of a class, its rates are 0 by convention, not by merit. */}
                  {[c.precision, c.recall, c.f1].map((value, i) => (
                    <td key={i} className="px-1.5 py-2.5 text-end tabular-nums sm:px-4">
                      {c.support === 0 && i > 0 ? (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">Not applicable: no item of this class</span>
                        </>
                      ) : (
                        formatRate(value)
                      )}
                    </td>
                  ))}
                  <td className="px-1.5 py-2.5 text-end tabular-nums sm:px-4">
                    {c.support.toLocaleString('en-GB')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The evaluation method version behind the score, and where it stands in
 * review. A result that carries no version is said to be not attributed yet,
 * in plain words: submissions made directly on the platform are not pinned to
 * a version at the moment, so that is the state of every new result until
 * they are.
 */
function MethodCard({ attribution }: { attribution: ScoreAttribution }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Evaluation method</CardTitle>
        <CardDescription>
          The scoring procedure that produced these numbers, and whether it has been reviewed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {attribution.kind === 'ROUTED' ? (
          <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Link
                href={`/evaluation/routes/${encodeURIComponent(attribution.routeSlug)}`}
                className={`${LINK} break-words font-mono text-xs`}
              >
                {attribution.routeSlug}
              </Link>
              <span className="font-mono text-xs text-[var(--color-muted-foreground)]">
                version {attribution.routeVersion}
              </span>
              <ReviewStatusBadge attribution={attribution} describe={false} />
            </p>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {describeAttribution(attribution).description}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p>
              <Badge tone="neutral">not attributed yet</Badge>
            </p>
            <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">
              This result is not linked to a version of an evaluation method, so there is no review
              status to show and it is not part of published reporting.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
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
  Separator,
} from '@oci/ui';
import type {
  EvaluationSubmissionResult,
  EvaluationTaskDetail,
  ScoreAttribution,
  SubmissionStatus,
} from '@oci/shared-types';
import { apiFetch } from '../../../lib/api';
import { BINARY_DIAGNOSTIC_TEXT as BD } from '../../../components/evaluation/binary-diagnostic-text';
import {
  metricCells,
  TASK_KIND_LABEL,
  type MetricCell,
} from '../../../components/evaluation/metrics';
import {
  describeAttribution,
  isPublishedResult,
  rankSubmissions,
  ReviewStatusBadge,
} from '../../../components/evaluation/review-status-badge';

/**
 * Evaluation task detail (ADR-0017, Phase C-lite). Anonymous —
 * `GET /v2/evaluation/tasks/:slug` is public and strips ground truth
 * server-side, so nothing here is gated and nothing here can leak the
 * reference labels.
 *
 * Submissions are rendered in the order the API returns them (best first on
 * the task kind's own primary metric — QWK for grading, macro F1 for
 * classification; PENDING / FAILED sink to the bottom) — the ordering is the
 * API's decision, not this page's. `scores` is null for anything that isn't
 * SCORED; those rows render dashes. The public DTO carries no `error`
 * field, so a FAILED row exposes nothing beyond its status.
 *
 * Every scored row also carries its `attribution` (#486, WP5 invariant 3):
 * the route version that produced the score and where that version stands in
 * review, or a LEGACY marker for scores that predate the route registry. The
 * page shows it next to the method name and hands out rank numbers only to
 * published results — a provisional, legacy or retracted score keeps its
 * metrics but is not "#1" of anything.
 *
 * Each row's method name links to the submission's own page (#645), except a
 * FAILED row: the API returns a failed submission to its submitter and to
 * administrators only, and this page does not know who is reading it, so a
 * link there would be a 404 for nearly everyone who followed it.
 */

const STATUS_TONE: Record<SubmissionStatus, 'success' | 'info' | 'danger'> = {
  SCORED: 'success',
  PENDING: 'info',
  FAILED: 'danger',
};

const STATUS_NOTE: Record<SubmissionStatus, string | null> = {
  SCORED: null,
  PENDING: 'Awaiting scoring — no metrics yet.',
  FAILED: 'Scoring did not complete, so this submission has no metrics.',
};

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return {
    title: `${slug} — OCI Evaluation`,
    description: `Scored submissions for the ${slug} evaluation task. Metrics only — the reference labels are never published.`,
  };
}

export default async function EvaluationTaskDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let detail: EvaluationTaskDetail | null = null;
  let error: string | null = null;
  try {
    detail = await apiFetch<EvaluationTaskDetail>(
      `/v2/evaluation/tasks/${encodeURIComponent(slug)}`,
      { revalidate: 0 },
    );
  } catch (err) {
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

  if (!detail) notFound();

  const topLabel = detail.numClasses - 1;
  const isGrading = detail.taskKind === 'GRADING';
  const isBinary = detail.taskKind === 'BINARY_DIAGNOSTIC';
  const submitHref = `/evaluation/${encodeURIComponent(detail.slug)}/submit` as const;
  const scoredCount = detail.submissions.filter((s) => s.scores !== null).length;
  const publishedCount = detail.submissions.filter((s) => isPublishedResult(s.attribution)).length;

  // Rank only the published results — numbering a PENDING row "4th" would
  // imply it placed, and numbering a provisional or legacy row would imply
  // the platform stands behind that placing. Neither is true.
  const ranked = rankSubmissions(detail.submissions);

  return (
    <>
      <Section spacing="md" surface="hero">
        <Container size="xl">
          <Link
            href="/evaluation"
            className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <ArrowLeftIcon size={14} />
            <span>Evaluation</span>
          </Link>
          <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs text-[var(--color-muted-foreground)]">
                {detail.slug}
              </p>
              <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--color-foreground)]">
                {detail.name}
              </h1>
              <p className="mt-4 max-w-2xl text-[var(--color-muted-foreground)]">
                Predictions submitted for this task are scored against reference labels held by the
                platform. The labels are never published and are not part of any response — only the
                metrics below come back.
              </p>
            </div>
            <div className="flex flex-col items-start gap-4 lg:items-end">
              <div className="flex flex-row flex-wrap items-start gap-2">
                <Badge tone="info">{TASK_KIND_LABEL[detail.taskKind]}</Badge>
                <Badge tone={detail.submissions.length > 0 ? 'primary' : 'neutral'}>
                  {detail.submissions.length.toLocaleString('en-GB')}{' '}
                  {detail.submissions.length === 1 ? 'submission' : 'submissions'}
                </Badge>
              </div>
              <Button asChild size="lg">
                <Link href={submitHref}>Submit predictions</Link>
              </Button>
            </div>
          </div>
        </Container>
      </Section>

      <Container size="xl">
        <Section spacing="md" className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle as="h2">About this task</CardTitle>
              <CardDescription>
                {isGrading
                  ? 'What is being scored, on which dataset, and where the referable cut-off sits.'
                  : isBinary
                    ? BD.about.description
                    : 'What is being scored, on which dataset, and which labels a prediction may take.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term="Slug" mono>
                  {detail.slug}
                </DefinitionItem>
                <DefinitionItem term="Task kind">{TASK_KIND_LABEL[detail.taskKind]}</DefinitionItem>
                <DefinitionItem term="Scored dataset">
                  <Link
                    href={`/catalog/${detail.datasetSlug}`}
                    className="rounded font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
                  >
                    {detail.datasetSlug}
                  </Link>
                </DefinitionItem>
                {/*
                 * "Grades" and the referable threshold describe an ordinal
                 * scale, so they appear on grading tasks only (#645). A
                 * classification task has neither: its labels are categories
                 * with no order, and nothing is split at a cut-off.
                 */}
                {isGrading ? (
                  <>
                    <DefinitionItem term="Grades">
                      <span className="tabular-nums">
                        {detail.numClasses.toLocaleString('en-GB')} classes
                      </span>{' '}
                      <span className="text-[var(--color-muted-foreground)]">
                        (grade 0 to {topLabel.toLocaleString('en-GB')})
                      </span>
                    </DefinitionItem>
                    <DefinitionItem term="Referable threshold">
                      <span className="tabular-nums">
                        {detail.referableThreshold.toLocaleString('en-GB')}
                      </span>{' '}
                      <span className="text-[var(--color-muted-foreground)]">
                        — referable means grade ≥{' '}
                        {detail.referableThreshold.toLocaleString('en-GB')}; anything below that
                        counts as non-referable.
                      </span>
                    </DefinitionItem>
                  </>
                ) : isBinary ? (
                  // The published metric configuration states the positive
                  // class in words (#650): it is what sensitivity and the
                  // positive predictive value are about.
                  <>
                    <DefinitionItem term={BD.about.positiveClassTerm}>
                      {detail.positiveClassName
                        ? BD.about.positiveClass(detail.positiveClassName)
                        : BD.about.positiveClassMissing}
                    </DefinitionItem>
                    <DefinitionItem term={BD.about.classesTerm}>{BD.about.classes}</DefinitionItem>
                  </>
                ) : (
                  <DefinitionItem term="Classes">
                    <span className="tabular-nums">
                      {detail.numClasses.toLocaleString('en-GB')}
                    </span>{' '}
                    <span className="text-[var(--color-muted-foreground)]">
                      (label 0 to {topLabel.toLocaleString('en-GB')})
                    </span>
                  </DefinitionItem>
                )}
                <DefinitionItem term="Items">
                  <span className="tabular-nums">{detail.itemCount.toLocaleString('en-GB')}</span>{' '}
                  <span className="text-[var(--color-muted-foreground)]">
                    — listed in full below; predictions are keyed on these identifiers.
                  </span>
                </DefinitionItem>
                <DefinitionItem term="Created">
                  <time dateTime={detail.createdAt}>
                    {DATE_FORMATTER.format(new Date(detail.createdAt))}
                  </time>
                </DefinitionItem>
              </DefinitionList>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Item identifiers</CardTitle>
              <CardDescription>
                Every item this task scores against. A predictions file is a map keyed on these
                identifiers, and a sealed container receives the same set at run time as{' '}
                <code className="font-mono text-xs">index.json</code> on its{' '}
                <code className="font-mono text-xs">/input</code> mount. They are identifiers only —
                the reference labels behind them are held by the platform and are not part of any
                response.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {detail.itemCount === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
                  This task has no items yet.
                </p>
              ) : (
                <>
                  {/*
                   * `tabIndex={0}` is load-bearing, not decoration: the list
                   * scrolls once the item count outgrows `max-h-72` (which it
                   * does at mobile widths even for the 30-item reference
                   * slice), and a scrollable region that cannot be focused is
                   * unreachable by keyboard — axe `scrollable-region-focusable`.
                   * The label and focus ring come with it, so the region
                   * announces what it is when it takes focus.
                   */}
                  <ul
                    tabIndex={0}
                    aria-label={`${detail.itemCount.toLocaleString('en-GB')} item identifiers for ${detail.slug}`}
                    className="grid max-h-72 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-4 font-mono text-xs text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] sm:grid-cols-3 lg:grid-cols-5"
                  >
                    {detail.itemIds.map((id) => (
                      <li key={id} className="truncate" title={id}>
                        {id}
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    Read this list rather than generating it — the identifiers are not guaranteed to
                    be contiguous or densely numbered. Items you omit are permitted and reported as
                    reduced coverage; identifiers this task does not recognise are a validation
                    failure, so a mismatched naming convention fails loudly instead of scoring zero.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Alert tone="info">
            <AlertTitle as="h2">Metrics are per task, not a global ranking</AlertTitle>
            <AlertDescription>
              Each host brings a different clinical question, dataset and grading scale, so scores
              on this task cannot be compared with scores on any other task. There is deliberately
              no cross-task leaderboard (ADR-0017).
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Results</CardTitle>
              <CardDescription>
                {isBinary ? (
                  <>
                    {BD.results.ordering} {BD.results.intervals}
                  </>
                ) : detail.taskKind === 'CLASSIFICATION' ? (
                  <>
                    Ordered best first by <strong>macro F1</strong> — the mean per-class F1 over the
                    classes this evaluation set contains, so a model that ignores a rare class
                    cannot hide behind a common one. Accuracy is shown alongside it because the two
                    diverge exactly when the classes are imbalanced.
                  </>
                ) : (
                  <>
                    Ordered best first by <strong>QWK</strong> — quadratic-weighted kappa, the
                    headline metric: agreement with the reference grades on a −1 to 1 scale where 1
                    is perfect and 0 is chance. The referable rates are measured against the grade ≥{' '}
                    {detail.referableThreshold.toLocaleString('en-GB')} cut-off.
                  </>
                )}{' '}
                Coverage is the share of the reference set a submission actually predicted. Results
                are provisional until the evaluation method that produced them is approved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {detail.submissions.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
                  No submissions scored yet. Results appear here as soon as the first predictions
                  file is submitted.{' '}
                  <Link
                    href={submitHref}
                    className="rounded font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
                  >
                    Submit predictions
                  </Link>
                </p>
              ) : (
                <ol aria-label="Submissions, best first" className="space-y-4">
                  {ranked.map(({ submission, rank }) => (
                    <li key={submission.id}>
                      <SubmissionRow submission={submission} rank={rank} task={detail} />
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Separator />

          <p className="text-center text-xs text-[var(--color-muted-foreground)]">
            {scoredCount.toLocaleString('en-GB')} of{' '}
            {detail.submissions.length.toLocaleString('en-GB')} submissions scored ·{' '}
            {publishedCount.toLocaleString('en-GB')} published.{' '}
            <Link
              href="/evaluation"
              className="underline underline-offset-2 hover:text-[var(--color-foreground)]"
            >
              Back to evaluation tasks
            </Link>
            .
          </p>
        </Section>
      </Container>
    </>
  );
}

function SubmissionRow({
  submission,
  rank,
  task,
}: {
  submission: EvaluationSubmissionResult;
  rank: number | null;
  task: Pick<
    EvaluationTaskDetail,
    'slug' | 'taskKind' | 'referableThreshold' | 'positiveClassName'
  >;
}) {
  const { scores, attribution } = submission;
  const note = STATUS_NOTE[submission.status];
  // The one-sentence explanation is shown in full only where the reader
  // needs it to interpret the metrics: a published result speaks for itself,
  // a provisional, legacy or retracted one does not.
  const attributionNote = attribution ? attributionNoteFor(attribution) : null;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3 className="flex min-w-0 items-baseline gap-2 text-base font-semibold">
            {rank !== null ? (
              <span className="tabular-nums text-[var(--color-muted-foreground)]">#{rank}</span>
            ) : null}
            {submission.status === 'FAILED' ? (
              <span className="min-w-0 break-words">{submission.methodName}</span>
            ) : (
              <Link
                href={`/evaluation/${encodeURIComponent(task.slug)}/submissions/${submission.id}`}
                className="min-w-0 break-words rounded underline decoration-[var(--color-border-strong)] underline-offset-4 hover:text-[var(--color-primary)] hover:decoration-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
              >
                {submission.methodName}
              </Link>
            )}
          </h3>
          {attribution ? (
            <AttributionLine attribution={attribution} describe={attributionNote === null} />
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={STATUS_TONE[submission.status]}>{submission.status.toLowerCase()}</Badge>
          <time
            dateTime={submission.createdAt}
            className="text-xs text-[var(--color-muted-foreground)]"
          >
            {DATE_FORMATTER.format(new Date(submission.createdAt))}
          </time>
        </div>
      </div>

      {note ? <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">{note}</p> : null}
      {attributionNote ? (
        <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">{attributionNote}</p>
      ) : null}

      <dl
        className={
          'mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 ' +
          // A binary row's cells carry an interval line; three columns keep
          // each label and each interval on one line and the values aligned.
          (task.taskKind === 'BINARY_DIAGNOSTIC' ? '' : 'lg:grid-cols-5')
        }
      >
        {metricCells(task, scores, 'row').map((cell, i) => (
          <Metric
            key={cell.key}
            cell={cell}
            headline={i === 0}
            className={i === 0 ? 'col-span-2 sm:col-span-1' : undefined}
          />
        ))}
      </dl>
    </div>
  );
}

/**
 * Which results get their review-status sentence spelled out under the row.
 * "published" needs no caveat; the other four change how the metrics should
 * be read, so the reader gets the sentence without hovering the badge.
 */
function attributionNoteFor(attribution: ScoreAttribution): string | null {
  const { label, description } = describeAttribution(attribution);
  return label === 'published' ? null : description;
}

/**
 * The route version that produced a score, plus its review-status badge. Sits
 * under the method name and wraps as a unit at narrow widths, so at 375px the
 * slug, version and badge stack beneath the heading instead of overflowing.
 * The route page (`/evaluation/routes/:slug`) is linked directly; a LEGACY
 * score has no route to link to, so it shows the badge alone.
 */
function AttributionLine({
  attribution,
  describe,
}: {
  attribution: ScoreAttribution;
  /** False when the row prints the description itself, so it is not read twice. */
  describe: boolean;
}) {
  if (attribution.kind === 'LEGACY') {
    return (
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="sr-only">Evaluation method: </span>
        <ReviewStatusBadge attribution={attribution} describe={describe} />
      </p>
    );
  }

  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="sr-only">Evaluation method: </span>
      <Link
        href={`/evaluation/routes/${encodeURIComponent(attribution.routeSlug)}`}
        className="min-w-0 break-words rounded font-mono text-xs text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
      >
        {attribution.routeSlug}
        <span className="text-[var(--color-muted-foreground)]">@{attribution.routeVersion}</span>
      </Link>
      <ReviewStatusBadge attribution={attribution} describe={describe} />
    </p>
  );
}

/**
 * One metric cell. `value === null` renders an em dash — the case for a
 * PENDING or FAILED submission, which carries no scores at all — or, on a
 * scored binary result, the short reason the figure is absent. A binary rate
 * also carries its 95% interval on a second line.
 */
function Metric({
  cell,
  headline,
  className,
}: {
  cell: MetricCell;
  headline?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
        {cell.label}
      </dt>
      <dd
        className={
          'mt-1 font-semibold tabular-nums text-[var(--color-foreground)] ' +
          (headline ? 'text-3xl' : 'text-lg')
        }
      >
        {cell.value ??
          (cell.absent ? (
            <span className="text-sm font-medium text-[var(--color-muted-foreground)]">
              {cell.absent.label}
            </span>
          ) : (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">Not scored</span>
            </>
          ))}
      </dd>
      {cell.interval ? (
        <dd className="mt-0.5 text-xs tabular-nums text-[var(--color-muted-foreground)]">
          <span aria-hidden="true">{cell.interval.text}</span>
          <span className="sr-only">{cell.interval.spoken}</span>
        </dd>
      ) : null}
    </div>
  );
}

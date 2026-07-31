import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Badge,
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
  EvaluationTaskKindDb,
  SubmissionStatus,
} from '@oci/shared-types';
import { apiFetch } from '../../../lib/api';

/**
 * Evaluation task detail (ADR-0017, Phase C-lite). Anonymous —
 * `GET /v2/evaluation/tasks/:slug` is public and strips ground truth
 * server-side, so nothing here is gated and nothing here can leak the
 * reference labels.
 *
 * Submissions are rendered in the order the API returns them (best QWK
 * first; PENDING / FAILED sink to the bottom) — the ranking is the API's
 * decision, not this page's. `scores` is null for anything that isn't
 * SCORED; those rows render dashes. The public DTO carries no `error`
 * field, so a FAILED row exposes nothing beyond its status.
 */

const TASK_KIND_LABEL: Record<EvaluationTaskKindDb, string> = {
  GRADING: 'Grading',
};

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

/**
 * QWK stays a 0–1-scale figure (and can be negative — worse than chance),
 * so it is never rendered as a percentage. `signDisplay: 'negative'` keeps
 * the minus sign without prefixing positives with a `+`.
 */
const QWK_FORMATTER = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
  signDisplay: 'negative',
});

/** The four bounded 0–1 rates read better as percentages. */
const RATE_FORMATTER = new Intl.NumberFormat('en-GB', {
  style: 'percent',
  maximumFractionDigits: 1,
});

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

  const topGrade = detail.numClasses - 1;
  const scoredCount = detail.submissions.filter((s) => s.scores !== null).length;

  // Rank only the scored submissions — numbering a PENDING row "4th"
  // would imply it placed, which it hasn't.
  let nextRank = 0;
  const ranked = detail.submissions.map((s) => ({
    submission: s,
    rank: s.scores !== null ? (nextRank += 1) : null,
  }));

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
            <div className="flex flex-row flex-wrap items-start gap-2 lg:flex-col lg:items-end">
              <Badge tone="info">{TASK_KIND_LABEL[detail.taskKind]}</Badge>
              <Badge tone={detail.submissions.length > 0 ? 'primary' : 'neutral'}>
                {detail.submissions.length.toLocaleString('en-GB')}{' '}
                {detail.submissions.length === 1 ? 'submission' : 'submissions'}
              </Badge>
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
                What is being scored, on which dataset, and where the referable cut-off sits.
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
                <DefinitionItem term="Grades">
                  <span className="tabular-nums">
                    {detail.numClasses.toLocaleString('en-GB')} classes
                  </span>{' '}
                  <span className="text-[var(--color-muted-foreground)]">
                    (grade 0 to {topGrade.toLocaleString('en-GB')})
                  </span>
                </DefinitionItem>
                <DefinitionItem term="Referable threshold">
                  <span className="tabular-nums">
                    {detail.referableThreshold.toLocaleString('en-GB')}
                  </span>{' '}
                  <span className="text-[var(--color-muted-foreground)]">
                    — referable means grade ≥ {detail.referableThreshold.toLocaleString('en-GB')};
                    anything below that counts as non-referable.
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
                Ordered best first by <strong>QWK</strong> — quadratic-weighted kappa, the headline
                metric: agreement with the reference grades on a −1 to 1 scale where 1 is perfect
                and 0 is chance. The referable rates are measured against the grade ≥{' '}
                {detail.referableThreshold.toLocaleString('en-GB')} cut-off. Coverage is the share
                of the reference set a submission actually predicted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {detail.submissions.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
                  No submissions scored yet. Results appear here as soon as the first predictions
                  file is submitted.
                </p>
              ) : (
                <ol aria-label="Submissions, best QWK first" className="space-y-4">
                  {ranked.map(({ submission, rank }) => (
                    <li key={submission.id}>
                      <SubmissionRow submission={submission} rank={rank} />
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Separator />

          <p className="text-center text-xs text-[var(--color-muted-foreground)]">
            {scoredCount.toLocaleString('en-GB')} of{' '}
            {detail.submissions.length.toLocaleString('en-GB')} submissions scored.{' '}
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
}: {
  submission: EvaluationSubmissionResult;
  rank: number | null;
}) {
  const { scores } = submission;
  const note = STATUS_NOTE[submission.status];

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h3 className="flex min-w-0 items-baseline gap-2 text-base font-semibold">
          {rank !== null ? (
            <span className="tabular-nums text-[var(--color-muted-foreground)]">#{rank}</span>
          ) : null}
          <span className="min-w-0 break-words">{submission.methodName}</span>
        </h3>
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

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        <Metric
          label="QWK"
          value={scores ? QWK_FORMATTER.format(scores.qwk) : null}
          headline
          className="col-span-2 sm:col-span-1"
        />
        <Metric label="Accuracy" value={scores ? RATE_FORMATTER.format(scores.accuracy) : null} />
        <Metric
          label="Referable sensitivity"
          value={scores ? RATE_FORMATTER.format(scores.referableSensitivity) : null}
        />
        <Metric
          label="Referable specificity"
          value={scores ? RATE_FORMATTER.format(scores.referableSpecificity) : null}
        />
        <Metric label="Coverage" value={scores ? RATE_FORMATTER.format(scores.coverage) : null} />
      </dl>
    </div>
  );
}

/**
 * One metric cell. `value === null` renders an em dash — the case for a
 * PENDING or FAILED submission, which carries no scores at all.
 */
function Metric({
  label,
  value,
  headline,
  className,
}: {
  label: string;
  value: string | null;
  headline?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
        {label}
      </dt>
      <dd
        className={
          'mt-1 font-semibold tabular-nums text-[var(--color-foreground)] ' +
          (headline ? 'text-3xl' : 'text-lg')
        }
      >
        {value ?? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">Not scored</span>
          </>
        )}
      </dd>
    </div>
  );
}

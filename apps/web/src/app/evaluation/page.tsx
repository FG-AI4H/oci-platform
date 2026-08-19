import Link from 'next/link';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChartIcon,
  Container,
  Section,
} from '@oci/ui';
import type { EvaluationTaskKindDb, EvaluationTaskSummary } from '@oci/shared-types';
import { apiFetch } from '../../lib/api';

/**
 * Evaluation tasks list (ADR-0017, Phase C-lite). Read-only, anonymous:
 * `GET /v2/evaluation/tasks` is public and never returns ground truth, so
 * there is no session to thread through and nothing to role-gate.
 *
 * The list DTO (`EvaluationTaskSummary`) deliberately carries only the
 * identity fields + a submission count — `numClasses` /
 * `referableThreshold` live on the detail DTO, so the metric configuration
 * is surfaced on `/evaluation/[slug]` rather than fanning out one detail
 * fetch per card here.
 */

export const metadata = {
  title: 'Evaluation — OCI Platform',
  description:
    'Benchmarking tasks on the OCI Platform. A model’s predictions are scored against ground truth held by the platform — the labels themselves are never published.',
};

const TASK_KIND_LABEL: Record<EvaluationTaskKindDb, string> = {
  GRADING: 'Grading',
  CLASSIFICATION: 'Classification',
};

export default async function EvaluationTasksPage() {
  let tasks: EvaluationTaskSummary[] | null = null;
  let error: string | null = null;
  try {
    tasks = await apiFetch<EvaluationTaskSummary[]>('/v2/evaluation/tasks', { revalidate: 0 });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach evaluation API';
  }

  const count = tasks?.length ?? 0;

  return (
    <Container>
      <Section spacing="md">
        <header className="mb-6 flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Evaluation
          </p>
          {/* Count sits *beside* the heading rather than pushed to the far
              edge — at desktop widths `justify-between` orphaned it ~1000px
              away from the title it counts. */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Tasks</h1>
            {tasks ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                <span className="text-[var(--color-foreground)] font-medium tabular-nums">
                  {count.toLocaleString('en-GB')}
                </span>{' '}
                {count === 1 ? 'task' : 'tasks'}
              </p>
            ) : null}
          </div>
          <p className="max-w-2xl text-[var(--color-muted-foreground)]">
            These are benchmarking tasks. A model’s predictions are scored against ground truth held
            by the platform — the reference labels are never published, and no submission can read
            them. Only the resulting metrics come back.
          </p>
        </header>

        {error ? (
          <Alert tone="danger">
            <AlertTitle as="h2">Evaluation unavailable</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        ) : !tasks || tasks.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tasks.map((t) => (
              <li key={t.id}>
                <TaskCard t={t} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Container>
  );
}

function TaskCard({ t }: { t: EvaluationTaskSummary }) {
  return (
    <Card accent="phase-c" interactive="hover" className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          {/* `as="h2"`: the cards are the content of this page, so they sit
              directly under the h1 — an h3 here would skip a level. */}
          <CardTitle as="h2" className="line-clamp-2">
            <Link
              href={`/evaluation/${t.slug}`}
              className="rounded hover:text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
            >
              {t.name}
            </Link>
          </CardTitle>
          <Badge tone="info">{TASK_KIND_LABEL[t.taskKind]}</Badge>
        </div>
        <CardDescription>
          Scores predictions against held-back labels for{' '}
          <Link
            href={`/catalog/${t.datasetSlug}`}
            className="rounded font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            {t.datasetSlug}
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-muted-foreground)]">
        <span className="min-w-0 truncate font-mono">{t.slug}</span>
        <Badge tone={t.submissionCount > 0 ? 'primary' : 'neutral'}>
          {t.submissionCount.toLocaleString('en-GB')}{' '}
          {t.submissionCount === 1 ? 'submission' : 'submissions'}
        </Badge>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-12 text-center">
      <span
        className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-[var(--shadow-xs)]"
        aria-hidden="true"
      >
        <ChartIcon size={20} />
      </span>
      <h2 className="mt-4 text-lg font-semibold">No evaluation tasks yet.</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-muted-foreground)]">
        A task binds a catalogued dataset to a scoring configuration and a set of reference labels
        the platform keeps private. Once a host creates the first one, it will appear here.
      </p>
    </div>
  );
}

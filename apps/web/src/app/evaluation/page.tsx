import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
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
  ShieldIcon,
} from '@oci/ui';
import type { EvaluationTaskSummary } from '@oci/shared-types';
import type { EvaluationI18n } from '../../components/evaluation/i18n';
import { taskKindLabel } from '../../components/evaluation/metrics';
import { getEvaluationI18n } from '../../components/evaluation/server-i18n';
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
 *
 * Text in the interface language (#654): `EvaluationTasks.list`.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('EvaluationTasks');
  return { title: t('list.metaTitle'), description: t('list.metaDescription') };
}

type ListT = Awaited<ReturnType<typeof getTranslations<'EvaluationTasks'>>>;

export default async function EvaluationTasksPage() {
  const [t, i18n] = await Promise.all([getTranslations('EvaluationTasks'), getEvaluationI18n()]);
  let tasks: EvaluationTaskSummary[] | null = null;
  let error: string | null = null;
  try {
    tasks = await apiFetch<EvaluationTaskSummary[]>('/v2/evaluation/tasks', { revalidate: 0 });
  } catch (err) {
    error = err instanceof Error ? err.message : i18n.t('unavailable.fallback');
  }

  const count = tasks?.length ?? 0;

  return (
    <Container>
      <Section spacing="md">
        <header className="mb-6 flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('list.eyebrow')}
          </p>
          {/* Count sits *beside* the heading rather than pushed to the far
              edge — at desktop widths `justify-between` orphaned it ~1000px
              away from the title it counts. */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              {t('list.heading')}
            </h1>
            {tasks ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                {t.rich('list.count', {
                  count,
                  total: i18n.f.number(count),
                  num: (chunks) => (
                    <span className="text-[var(--color-foreground)] font-medium tabular-nums">
                      {chunks}
                    </span>
                  ),
                })}
              </p>
            ) : null}
          </div>
          <p className="max-w-2xl text-[var(--color-muted-foreground)]">{t('list.intro')}</p>
        </header>

        {error ? (
          <Alert tone="danger">
            <AlertTitle as="h2">{i18n.t('unavailable.title')}</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        ) : !tasks || tasks.length === 0 ? (
          <EmptyState t={t} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {/* `min-w-0`: a grid item is as wide as its longest unbreakable
                line otherwise, and a long task slug pushed the cards past a
                375 px screen instead of being truncated. */}
            {tasks.map((task) => (
              <li key={task.id} className="min-w-0">
                <TaskCard task={task} t={t} i18n={i18n} />
              </li>
            ))}
          </ul>
        )}

        <EvaluationMethodsLink t={t} />
      </Section>
    </Container>
  );
}

/**
 * Pointer to the evaluation-method registry (#487). Sits below the tasks
 * because a reader arrives here for tasks; the methods explain the review
 * status shown next to each result on a task page.
 */
function EvaluationMethodsLink({ t }: { t: ListT }) {
  return (
    <aside
      aria-labelledby="evaluation-methods-heading"
      className="mt-10 flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-subtle)] p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-[var(--shadow-xs)]"
          aria-hidden="true"
        >
          <ShieldIcon size={18} />
        </span>
        <div className="min-w-0">
          <h2 id="evaluation-methods-heading" className="text-base font-semibold">
            {t('list.methodsHeading')}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            {t('list.methodsBody')}
          </p>
        </div>
      </div>
      <Link
        href="/evaluation/routes"
        className="shrink-0 rounded font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
      >
        {t('list.methodsLink')}
      </Link>
    </aside>
  );
}

function TaskCard({
  task,
  t,
  i18n,
}: {
  task: EvaluationTaskSummary;
  t: ListT;
  i18n: EvaluationI18n;
}) {
  return (
    <Card accent="phase-c" interactive="hover" className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          {/* `as="h2"`: the cards are the content of this page, so they sit
              directly under the h1 — an h3 here would skip a level. */}
          <CardTitle as="h2" className="line-clamp-2">
            <Link
              href={`/evaluation/${task.slug}`}
              className="rounded hover:text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
            >
              {task.name}
            </Link>
          </CardTitle>
          <Badge tone="info">{taskKindLabel(i18n, task.taskKind)}</Badge>
        </div>
        <CardDescription>
          {t.rich('list.cardDescription', {
            dataset: task.datasetSlug,
            link: (chunks) => (
              <Link
                href={`/catalog/${task.datasetSlug}`}
                className="rounded font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
              >
                {chunks}
              </Link>
            ),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-muted-foreground)]">
        <span className="min-w-0 truncate font-mono">{task.slug}</span>
        <Badge tone={task.submissionCount > 0 ? 'primary' : 'neutral'}>
          {t('list.submissions', {
            count: task.submissionCount,
            n: i18n.f.number(task.submissionCount),
          })}
        </Badge>
      </CardContent>
    </Card>
  );
}

function EmptyState({ t }: { t: ListT }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-12 text-center">
      <span
        className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-[var(--shadow-xs)]"
        aria-hidden="true"
      >
        <ChartIcon size={20} />
      </span>
      <h2 className="mt-4 text-lg font-semibold">{t('list.emptyTitle')}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-muted-foreground)]">
        {t('list.emptyBody')}
      </p>
    </div>
  );
}

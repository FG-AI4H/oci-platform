import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound, redirect, unstable_rethrow } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
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
  BinaryDiagnosticScores,
  ClassMetrics,
  EvaluationSubmissionDetail,
  ScoreAttribution,
  SubmissionStatus,
} from '@oci/shared-types';
import { auth } from '../../../../../auth';
import type { EvaluationI18n } from '../../../../../components/evaluation/i18n';
import {
  formatRate,
  metricCells,
  positiveClassOf,
  taskKindLabel,
  type MetricCell,
} from '../../../../../components/evaluation/metrics';
import {
  describeAttribution,
  ReviewStatusBadge,
} from '../../../../../components/evaluation/review-status-badge';
import { getEvaluationI18n } from '../../../../../components/evaluation/server-i18n';
import { SubgroupResultsCard } from '../../../../../components/evaluation/subgroup-results';
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
 *
 * Text in the interface language (#654): `EvaluationSubmission` and the
 * shared `Evaluation` vocabulary. The failure reason comes from the scoring
 * service and is shown as it gave it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SubmissionT = Awaited<ReturnType<typeof getTranslations<'EvaluationSubmission'>>>;

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
}): Promise<Metadata> {
  const [{ slug }, t] = await Promise.all([params, getTranslations('EvaluationSubmission')]);
  return {
    title: t('metaTitle', { slug }),
    description: t('metaDescription', { slug }),
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
  const [t, i18n] = await Promise.all([
    getTranslations('EvaluationSubmission'),
    getEvaluationI18n(),
  ]);
  const { f } = i18n;

  let submission: EvaluationSubmissionDetail | null = null;
  let error: string | null = null;
  try {
    submission = await loadSubmission(slug, id);
  } catch (err) {
    // `redirect()` works by throwing; let it through.
    unstable_rethrow(err);
    error = err instanceof Error ? err.message : i18n.t('unavailable.fallback');
  }

  if (error) {
    return (
      <Container size="md">
        <Section spacing="md">
          <Alert tone="danger">
            <AlertTitle as="h1">{i18n.t('unavailable.title')}</AlertTitle>
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
  const cells = metricCells(i18n, task, scores);
  const perClass = scores?.kind === 'CLASSIFICATION' ? scores.metrics.perClass : null;
  const binary = scores?.kind === 'BINARY_DIAGNOSTIC' ? scores.metrics : null;
  const num = (chunks: ReactNode) => <span className="tabular-nums">{chunks}</span>;
  const muted = (chunks: ReactNode) => (
    <span className="text-[var(--color-muted-foreground)]">{chunks}</span>
  );
  // Printed in UTC and said to be: a submitter may be reading from anywhere.
  const submittedAt = f.dateTime(submission.createdAt, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });

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
            {t('eyebrow')}
          </p>
          <h1 className="mt-2 break-words text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--color-foreground)]">
            {submission.methodName}
          </h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--color-muted-foreground)]">
            <Badge tone={STATUS_TONE[submission.status]}>
              {i18n.t(`status.${submission.status}`)}
            </Badge>
            <span>
              {t.rich('submitted', {
                date: submittedAt,
                time: (chunks) => <time dateTime={submission.createdAt}>{chunks}</time>,
              })}
            </span>
            {submission.viewerIsSubmitter ? (
              <span className="font-medium text-[var(--color-foreground)]">{t('yours')}</span>
            ) : null}
          </p>
        </Container>
      </Section>

      <Container size="lg">
        <Section spacing="md" className="space-y-8">
          {failure ? (
            <Alert tone="danger">
              <AlertTitle as="h2">{t('failure.title')}</AlertTitle>
              <AlertDescription className="mt-2 space-y-3">
                <p className="break-words font-mono text-xs text-[var(--color-foreground)]">
                  {failure.reason}
                </p>
                <p>
                  {failure.quotaConsumed
                    ? t('failure.quotaConsumed')
                    : t('failure.quotaNotConsumed')}{' '}
                  {submission.viewerIsSubmitter
                    ? t('failure.visibleToYou')
                    : t('failure.visibleToSubmitter')}
                </p>
                {submission.viewerIsSubmitter ? (
                  <p>
                    <Button asChild variant="secondary">
                      <Link href={`${taskHref}/submit`}>{t('failure.checkCorrected')}</Link>
                    </Button>
                  </p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {submission.status === 'PENDING' ? (
            <Alert tone="info">
              <AlertTitle as="h2">{t('pending.title')}</AlertTitle>
              <AlertDescription>{t('pending.body')}</AlertDescription>
            </Alert>
          ) : null}

          {scores ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">{t('metrics.title')}</CardTitle>
                <CardDescription>
                  {t.rich('metrics.description', {
                    task: task.name,
                    link: (chunks) => (
                      <Link href={taskHref} className={LINK}>
                        {chunks}
                      </Link>
                    ),
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MetricList cells={cells} />
              </CardContent>
            </Card>
          ) : null}

          {/* #410: right after the overall figures, which each group reads against. */}
          {scores && submission.subgroups ? (
            <SubgroupResultsCard subgroups={submission.subgroups} scores={scores} />
          ) : null}

          {perClass ? <PerClassCard perClass={perClass} t={t} i18n={i18n} /> : null}

          {binary ? (
            <ConfusionCard metrics={binary} positive={positiveClassOf(i18n, task)} i18n={i18n} />
          ) : null}

          {attribution ? <MethodCard attribution={attribution} t={t} i18n={i18n} /> : null}

          <Card>
            <CardHeader>
              <CardTitle as="h2">{t('task.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term={t('task.taskTerm')}>
                  <Link href={taskHref} className={LINK}>
                    {task.name}
                  </Link>
                </DefinitionItem>
                <DefinitionItem term={t('task.kindTerm')}>
                  {taskKindLabel(i18n, task.taskKind)}
                </DefinitionItem>
                <DefinitionItem term={t('task.datasetTerm')}>
                  <Link href={`/catalog/${task.datasetSlug}`} className={LINK}>
                    {task.datasetSlug}
                  </Link>
                </DefinitionItem>
                {task.taskKind === 'GRADING' ? (
                  <>
                    <DefinitionItem term={t('task.gradesTerm')}>
                      <span className="tabular-nums">
                        {t('task.grades', { top: f.number(task.numClasses - 1) })}
                      </span>
                    </DefinitionItem>
                    <DefinitionItem term={t('task.thresholdTerm')}>
                      {t.rich('task.threshold', {
                        threshold: f.number(task.referableThreshold),
                        num,
                        muted,
                      })}
                    </DefinitionItem>
                  </>
                ) : task.taskKind === 'BINARY_DIAGNOSTIC' ? (
                  <>
                    <DefinitionItem term={i18n.t('binary.about.positiveClassTerm')}>
                      {task.positiveClassName
                        ? i18n.t('binary.about.positiveClass', { name: task.positiveClassName })
                        : i18n.t('binary.about.positiveClassMissing')}
                    </DefinitionItem>
                    <DefinitionItem term={i18n.t('binary.about.classesTerm')}>
                      {i18n.t('binary.about.classes')}
                    </DefinitionItem>
                  </>
                ) : (
                  <DefinitionItem term={t('task.classesTerm')}>
                    {t.rich('task.classes', {
                      n: f.number(task.numClasses),
                      top: f.number(task.numClasses - 1),
                      num,
                      muted,
                    })}
                  </DefinitionItem>
                )}
              </DefinitionList>
            </CardContent>
          </Card>

          <p className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href={taskHref} className={LINK}>
              {t('allResults')}
            </Link>
            <Link href={`${taskHref}/submit`} className={LINK}>
              {submission.viewerIsSubmitter ? t('submitAnother') : t('submit')}
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
          <div key={cell.key} className="rounded-lg bg-[var(--color-subtle)] p-5 sm:col-span-2">
            <dt className="text-sm font-medium text-[var(--color-muted-foreground)]">
              {cell.label}
            </dt>
            <dd className="mt-1">
              <MetricValue cell={cell} size="text-4xl" />
              <span className="mt-2 block max-w-prose text-sm text-[var(--color-muted-foreground)]">
                {cell.explanation}
              </span>
            </dd>
          </div>
        ) : (
          <div key={cell.key}>
            <dt className="text-sm font-medium text-[var(--color-muted-foreground)]">
              {cell.label}
            </dt>
            <dd className="mt-1">
              <MetricValue cell={cell} size="text-2xl" />
              <span className="mt-1 block text-sm text-[var(--color-muted-foreground)]">
                {cell.absent ? cell.absent.reason : cell.explanation}
              </span>
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

/**
 * The number, then — for a binary-finding rate — its 95% interval and the
 * counts it rests on, on one quieter line. An absent figure on a scored result
 * says so in words instead of showing a blank.
 */
function MetricValue({ cell, size }: { cell: MetricCell; size: string }) {
  if (cell.value === null) {
    return (
      <span className="text-base font-semibold text-[var(--color-muted-foreground)]">
        {cell.absent?.label ?? '—'}
      </span>
    );
  }
  return (
    <>
      <span className={`${size} font-semibold tabular-nums text-[var(--color-foreground)]`}>
        {cell.value}
      </span>
      {cell.interval || cell.basis ? (
        <span className="mt-1 block text-sm tabular-nums text-[var(--color-foreground)]">
          {cell.interval ? (
            <>
              <span aria-hidden="true">{cell.interval.text}</span>
              <span className="sr-only">{cell.interval.spoken}</span>
            </>
          ) : null}
          {cell.interval && cell.basis ? <span aria-hidden="true"> · </span> : null}
          {cell.basis ? (
            <span className="text-[var(--color-muted-foreground)]">
              {cell.interval ? <span className="sr-only">, </span> : null}
              {cell.basis}
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );
}

/**
 * The four counts of a binary-finding result as a two-by-two table, reference
 * label down the side and the file's label across the top — the layout a
 * diagnostic-accuracy reader expects. Every rate in the metrics card is a ratio
 * of two of these cells.
 */
function ConfusionCard({
  metrics,
  positive,
  i18n,
}: {
  metrics: BinaryDiagnosticScores;
  positive: string;
  i18n: EvaluationI18n;
}) {
  const { t, f } = i18n;
  const positiveHeading = t('binary.confusion.positive', { name: positive });
  const cell = (count: number, name: string) => (
    <td className="px-3 py-3 text-end sm:px-4">
      <span className="block text-xl font-semibold tabular-nums text-[var(--color-foreground)]">
        {f.number(count)}
      </span>
      <span className="block text-xs text-[var(--color-muted-foreground)]">{name}</span>
    </td>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('binary.confusion.title')}</CardTitle>
        <CardDescription>{t('binary.confusion.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          tabIndex={0}
          role="region"
          aria-label={t('binary.confusion.tableLabel')}
          className="overflow-x-auto rounded-lg border border-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          <table className="w-full border-collapse text-sm">
            <thead className="bg-[var(--color-subtle)] text-[var(--color-muted-foreground)]">
              <tr>
                <td className="px-3 py-2.5 text-xs sm:px-4">{t('binary.confusion.corner')}</td>
                <th scope="col" className="px-3 py-2.5 text-end font-medium sm:px-4">
                  {positiveHeading}
                </th>
                <th scope="col" className="px-3 py-2.5 text-end font-medium sm:px-4">
                  {t('binary.confusion.negative')}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[var(--color-border)]">
                <th scope="row" className="px-3 py-3 text-start font-medium sm:px-4">
                  {positiveHeading}
                </th>
                {cell(metrics.truePositives, t('binary.confusion.truePositive'))}
                {cell(metrics.falseNegatives, t('binary.confusion.falseNegative'))}
              </tr>
              <tr className="border-t border-[var(--color-border)]">
                <th scope="row" className="px-3 py-3 text-start font-medium sm:px-4">
                  {t('binary.confusion.negative')}
                </th>
                {cell(metrics.falsePositives, t('binary.confusion.falsePositive'))}
                {cell(metrics.trueNegatives, t('binary.confusion.trueNegative'))}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Per-class precision, recall and F1. Only a classification task has this
 * breakdown; a grading task's scores carry no per-class figures, so there is
 * no table to show for one.
 */
function PerClassCard({
  perClass,
  t,
  i18n,
}: {
  perClass: ClassMetrics[];
  t: SubmissionT;
  i18n: EvaluationI18n;
}) {
  const { f } = i18n;
  const headings = [
    t('perClass.precision'),
    t('perClass.recall'),
    t('perClass.f1'),
    t('perClass.items'),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('perClass.title')}</CardTitle>
        <CardDescription>{t('perClass.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Fits a phone; focusable in case a very narrow screen still makes it scroll. */}
        <div
          tabIndex={0}
          role="region"
          aria-label={t('perClass.tableLabel')}
          className="overflow-x-auto rounded-lg border border-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          <table className="w-full border-collapse text-xs sm:text-sm">
            <thead className="bg-[var(--color-subtle)] text-[var(--color-muted-foreground)]">
              <tr>
                <th scope="col" className="px-1.5 py-2.5 text-start font-medium sm:px-4">
                  {t('perClass.class')}
                </th>
                {headings.map((h) => (
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
                          <span className="sr-only">{t('perClass.notApplicable')}</span>
                        </>
                      ) : (
                        formatRate(f, value)
                      )}
                    </td>
                  ))}
                  <td className="px-1.5 py-2.5 text-end tabular-nums sm:px-4">
                    {f.number(c.support)}
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
function MethodCard({
  attribution,
  t,
  i18n,
}: {
  attribution: ScoreAttribution;
  t: SubmissionT;
  i18n: EvaluationI18n;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('method.title')}</CardTitle>
        <CardDescription>{t('method.description')}</CardDescription>
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
                {t('method.version', { version: attribution.routeVersion })}
              </span>
              <ReviewStatusBadge attribution={attribution} describe={false} />
            </p>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {describeAttribution(attribution, i18n.t).description}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p>
              <Badge tone="neutral">{t('method.notAttributed')}</Badge>
            </p>
            <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">
              {t('method.notAttributedBody')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

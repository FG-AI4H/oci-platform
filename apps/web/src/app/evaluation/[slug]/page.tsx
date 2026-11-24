import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
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
  Field,
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
import type { EvaluationI18n } from '../../../components/evaluation/i18n';
import {
  metricCells,
  taskKindLabel,
  type MetricCell,
} from '../../../components/evaluation/metrics';
import {
  describeAttribution,
  isPublishedResult,
  rankSubmissions,
  ReviewStatusBadge,
} from '../../../components/evaluation/review-status-badge';
import { getEvaluationI18n } from '../../../components/evaluation/server-i18n';

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
 *
 * Text in the interface language (#654): `EvaluationTasks.detail` and the
 * shared `Evaluation` vocabulary. Task names, method names, slugs and
 * subgroup field labels come from the API and are shown as given.
 */

const STATUS_TONE: Record<SubmissionStatus, 'success' | 'info' | 'danger'> = {
  SCORED: 'success',
  PENDING: 'info',
  FAILED: 'danger',
};

const LINK =
  'rounded font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

type TasksT = Awaited<ReturnType<typeof getTranslations<'EvaluationTasks'>>>;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const [{ slug }, t] = await Promise.all([params, getTranslations('EvaluationTasks')]);
  return {
    title: t('detail.metaTitle', { slug }),
    description: t('detail.metaDescription', { slug }),
  };
}

export default async function EvaluationTaskDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [t, i18n] = await Promise.all([getTranslations('EvaluationTasks'), getEvaluationI18n()]);
  const { f } = i18n;

  let detail: EvaluationTaskDetail | null = null;
  let error: string | null = null;
  try {
    detail = await apiFetch<EvaluationTaskDetail>(
      `/v2/evaluation/tasks/${encodeURIComponent(slug)}`,
      { revalidate: 0 },
    );
  } catch (err) {
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

  if (!detail) notFound();

  const topLabel = detail.numClasses - 1;
  const isGrading = detail.taskKind === 'GRADING';
  const isBinary = detail.taskKind === 'BINARY_DIAGNOSTIC';
  const submitHref = `/evaluation/${encodeURIComponent(detail.slug)}/submit` as const;
  const scoredCount = detail.submissions.filter((s) => s.scores !== null).length;
  const publishedCount = detail.submissions.filter((s) => isPublishedResult(s.attribution)).length;
  const kindLabel = taskKindLabel(i18n, detail.taskKind);
  const threshold = f.number(detail.referableThreshold);
  const num = (chunks: ReactNode) => <span className="tabular-nums">{chunks}</span>;
  const muted = (chunks: ReactNode) => (
    <span className="text-[var(--color-muted-foreground)]">{chunks}</span>
  );

  // Rank only the published results — numbering a PENDING row "4th" would
  // imply it placed, and numbering a provisional or legacy row would imply
  // the platform stands behind that placing. Neither is true.
  const ranked = rankSubmissions(detail.submissions);

  // #410: the comparison needs two scored results of a task that reports by
  // subgroup. Results scored before the task declared its fields simply show
  // no breakdown on the comparison page.
  const hasSubgroups = detail.subgroupFields.length > 0;
  const comparable = hasSubgroups ? detail.submissions.filter((s) => s.scores !== null) : [];

  return (
    <>
      <Section spacing="md" surface="hero">
        <Container size="xl">
          <Link
            href="/evaluation"
            className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <ArrowLeftIcon size={14} />
            <span>{t('detail.back')}</span>
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
                {t('detail.lead')}
              </p>
            </div>
            <div className="flex flex-col items-start gap-4 lg:items-end">
              <div className="flex flex-row flex-wrap items-start gap-2">
                <Badge tone="info">{kindLabel}</Badge>
                <Badge tone={detail.submissions.length > 0 ? 'primary' : 'neutral'}>
                  {t('list.submissions', {
                    count: detail.submissions.length,
                    n: f.number(detail.submissions.length),
                  })}
                </Badge>
              </div>
              <Button asChild size="lg">
                <Link href={submitHref}>{t('detail.submit')}</Link>
              </Button>
            </div>
          </div>
        </Container>
      </Section>

      <Container size="xl">
        <Section spacing="md" className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle as="h2">{t('detail.aboutTitle')}</CardTitle>
              <CardDescription>
                {isGrading
                  ? t('detail.aboutGrading')
                  : isBinary
                    ? i18n.t('binary.about.description')
                    : t('detail.aboutClassification')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term={t('detail.slugTerm')} mono>
                  {detail.slug}
                </DefinitionItem>
                <DefinitionItem term={t('detail.taskKindTerm')}>{kindLabel}</DefinitionItem>
                <DefinitionItem term={t('detail.datasetTerm')}>
                  <Link href={`/catalog/${detail.datasetSlug}`} className={LINK}>
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
                    <DefinitionItem term={t('detail.gradesTerm')}>
                      {t.rich('detail.grades', {
                        count: detail.numClasses,
                        n: f.number(detail.numClasses),
                        top: f.number(topLabel),
                        num,
                        muted,
                      })}
                    </DefinitionItem>
                    <DefinitionItem term={t('detail.thresholdTerm')}>
                      {t.rich('detail.threshold', { threshold, num, muted })}
                    </DefinitionItem>
                  </>
                ) : isBinary ? (
                  // The published metric configuration states the positive
                  // class in words (#650): it is what sensitivity and the
                  // positive predictive value are about.
                  <>
                    <DefinitionItem term={i18n.t('binary.about.positiveClassTerm')}>
                      {detail.positiveClassName
                        ? i18n.t('binary.about.positiveClass', { name: detail.positiveClassName })
                        : i18n.t('binary.about.positiveClassMissing')}
                    </DefinitionItem>
                    <DefinitionItem term={i18n.t('binary.about.classesTerm')}>
                      {i18n.t('binary.about.classes')}
                    </DefinitionItem>
                  </>
                ) : (
                  <DefinitionItem term={t('detail.classesTerm')}>
                    {t.rich('detail.classes', {
                      n: f.number(detail.numClasses),
                      top: f.number(topLabel),
                      num,
                      muted,
                    })}
                  </DefinitionItem>
                )}
                {hasSubgroups ? (
                  <DefinitionItem term={i18n.t('subgroup.task.fieldsTerm')}>
                    {i18n.t('subgroup.task.fields', {
                      list: detail.subgroupFields.map((sf) => sf.label.toLowerCase()).join(', '),
                    })}
                  </DefinitionItem>
                ) : null}
                <DefinitionItem term={t('detail.itemsTerm')}>
                  {t.rich('detail.items', { n: f.number(detail.itemCount), num, muted })}
                </DefinitionItem>
                <DefinitionItem term={t('detail.createdTerm')}>
                  <time dateTime={detail.createdAt}>{f.date(detail.createdAt)}</time>
                </DefinitionItem>
              </DefinitionList>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">{t('detail.identifiersTitle')}</CardTitle>
              <CardDescription>
                {t.rich('detail.identifiersDescription', {
                  code: (chunks) => <code className="font-mono text-xs">{chunks}</code>,
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {detail.itemCount === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
                  {t('detail.noItems')}
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
                    aria-label={t('detail.identifiersLabel', {
                      n: f.number(detail.itemCount),
                      slug: detail.slug,
                    })}
                    className="grid max-h-72 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-4 font-mono text-xs text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] sm:grid-cols-3 lg:grid-cols-5"
                  >
                    {detail.itemIds.map((id) => (
                      <li key={id} className="truncate" title={id} translate="no">
                        {id}
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {t('detail.identifiersHint')}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Alert tone="info">
            <AlertTitle as="h2">{t('detail.perTaskTitle')}</AlertTitle>
            <AlertDescription>{t('detail.perTaskBody')}</AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle as="h2">{t('detail.resultsTitle')}</CardTitle>
              <CardDescription>
                {isBinary ? (
                  <>
                    {i18n.t('binary.results.ordering')} {i18n.t('binary.results.intervals')}
                  </>
                ) : detail.taskKind === 'CLASSIFICATION' ? (
                  t.rich('detail.resultsClassification', {
                    strong: (chunks) => <strong>{chunks}</strong>,
                  })
                ) : (
                  t.rich('detail.resultsGrading', {
                    threshold,
                    strong: (chunks) => <strong>{chunks}</strong>,
                  })
                )}{' '}
                {t('detail.resultsCoverage')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {detail.submissions.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
                  {t('detail.noSubmissions')}{' '}
                  <Link href={submitHref} className={LINK}>
                    {t('detail.submit')}
                  </Link>
                </p>
              ) : (
                <ol aria-label={t('detail.submissionsLabel')} className="space-y-4">
                  {ranked.map(({ submission, rank }) => (
                    <li key={submission.id}>
                      <SubmissionRow
                        submission={submission}
                        rank={rank}
                        task={detail}
                        hasSubgroups={hasSubgroups}
                        t={t}
                        i18n={i18n}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {comparable.length >= 2 ? (
            <CompareForm slug={detail.slug} submissions={comparable} i18n={i18n} />
          ) : null}

          <Separator />

          <p className="text-center text-xs text-[var(--color-muted-foreground)]">
            {t('detail.footer', {
              scored: f.number(scoredCount),
              total: f.number(detail.submissions.length),
              published: f.number(publishedCount),
            })}{' '}
            <Link
              href="/evaluation"
              className="underline underline-offset-2 hover:text-[var(--color-foreground)]"
            >
              {t('detail.backToTasks')}
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
  hasSubgroups,
  t,
  i18n,
}: {
  submission: EvaluationSubmissionResult;
  rank: number | null;
  /** The task reports by subgroup (#410): a scored row links to its breakdown. */
  hasSubgroups: boolean;
  task: Pick<
    EvaluationTaskDetail,
    'slug' | 'taskKind' | 'referableThreshold' | 'positiveClassName'
  >;
  t: TasksT;
  i18n: EvaluationI18n;
}) {
  const { scores, attribution } = submission;
  const note =
    submission.status === 'PENDING'
      ? t('detail.statusNotePending')
      : submission.status === 'FAILED'
        ? t('detail.statusNoteFailed')
        : null;
  // The one-sentence explanation is shown in full only where the reader
  // needs it to interpret the metrics: a published result speaks for itself,
  // a provisional, legacy or retracted one does not.
  const attributionNote = attribution ? attributionNoteFor(attribution, i18n) : null;

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
            <AttributionLine
              attribution={attribution}
              describe={attributionNote === null}
              prefix={t('detail.methodPrefix')}
            />
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={STATUS_TONE[submission.status]}>
            {i18n.t(`status.${submission.status}`)}
          </Badge>
          <time
            dateTime={submission.createdAt}
            className="text-xs text-[var(--color-muted-foreground)]"
          >
            {i18n.f.date(submission.createdAt)}
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
        {metricCells(i18n, task, scores, 'row').map((cell, i) => (
          <Metric
            key={cell.key}
            cell={cell}
            headline={i === 0}
            notScored={t('detail.notScored')}
            className={i === 0 ? 'col-span-2 sm:col-span-1' : undefined}
          />
        ))}
      </dl>

      {hasSubgroups && scores ? (
        <p className="mt-4 text-sm">
          <Link
            href={`/evaluation/${encodeURIComponent(task.slug)}/submissions/${submission.id}#subgroups`}
            className={LINK}
          >
            {i18n.t('subgroup.task.rowLink')}
            <span className="sr-only">: {submission.methodName}</span>
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Two scored results side by side, group by group (#410). A plain GET form:
 * it works without JavaScript and the comparison has its own address, which a
 * facilitator can put on a slide. The second choice defaults to the second
 * result so the button does something useful at once.
 */
function CompareForm({
  slug,
  submissions,
  i18n,
}: {
  slug: string;
  submissions: EvaluationSubmissionResult[];
  i18n: EvaluationI18n;
}) {
  const { t, f } = i18n;
  const select =
    'block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';
  const option = (s: EvaluationSubmissionResult) => (
    <option key={s.id} value={s.id}>
      {s.methodName} · {f.date(s.createdAt)}
    </option>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('subgroup.task.compareTitle')}</CardTitle>
        <CardDescription>{t('subgroup.task.compareDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          method="get"
          action={`/evaluation/${encodeURIComponent(slug)}/compare`}
          className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <Field label={t('subgroup.task.compareFirst')} htmlFor="compare-a">
            <select id="compare-a" name="a" defaultValue={submissions[0]?.id} className={select}>
              {submissions.map(option)}
            </select>
          </Field>
          <Field label={t('subgroup.task.compareSecond')} htmlFor="compare-b">
            <select id="compare-b" name="b" defaultValue={submissions[1]?.id} className={select}>
              {submissions.map(option)}
            </select>
          </Field>
          <Button type="submit" variant="secondary">
            {t('subgroup.task.compareSubmit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Which results get their review-status sentence spelled out under the row.
 * "published" needs no caveat; the other four change how the metrics should
 * be read, so the reader gets the sentence without hovering the badge.
 */
function attributionNoteFor(attribution: ScoreAttribution, { t }: EvaluationI18n): string | null {
  const { label, description } = describeAttribution(attribution, t);
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
  prefix,
}: {
  attribution: ScoreAttribution;
  /** False when the row prints the description itself, so it is not read twice. */
  describe: boolean;
  /** "Evaluation method: ", read before the line by a screen reader. */
  prefix: string;
}) {
  if (attribution.kind === 'LEGACY') {
    return (
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="sr-only">{prefix}</span>
        <ReviewStatusBadge attribution={attribution} describe={describe} />
      </p>
    );
  }

  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="sr-only">{prefix}</span>
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
  notScored,
  className,
}: {
  cell: MetricCell;
  headline?: boolean;
  /** Read by a screen reader in place of the dash. */
  notScored: string;
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
              <span className="sr-only">{notScored}</span>
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

import type { ReactNode } from 'react';
import { cache } from 'react';
import Link from 'next/link';
import { notFound, redirect, unstable_rethrow } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Badge,
  Container,
  Section,
} from '@oci/ui';
import type {
  BinaryDiagnosticScores,
  ClassMetrics,
  EvidenceGap,
  EvidenceStanding,
  EvidenceSummary,
  IntendedUseStatement,
  RouteReviewStatus,
} from '@oci/shared-types';
import { auth } from '../../../../../../auth';
import { getFormatters } from '../../../../../../i18n/server';
import type { Formatters } from '../../../../../../i18n/format';
import { ApiError, apiFetch, reauthUrl } from '../../../../../../lib/api';
import {
  clinicalPathwayText,
  intendedUserText,
  medicalPurposeText,
  operatingEnvironmentText,
  type ModelLabelTranslator,
} from '../../../../../../lib/model-card-labels';
import {
  excerpt,
  gapValues,
  knownEvent,
  metricRows,
  rate,
  shortHash,
  subgroupViews,
  type MetricRow,
  type SubgroupFigure,
  type SubgroupTableView,
} from './evidence-view';
import { PrintButton } from './print-button';
import './evidence.css';

/**
 * The evidence summary of one evaluated submission (#652): what the model is
 * for, what it was tested on, how, how well, for whom, and what is missing,
 * on two A4 pages a decision-maker can read without the platform open.
 *
 * Everything on it comes from `GET /v2/evaluation/submissions/:id/evidence`,
 * which decides who may read it (the submitter, administrators,
 * `evaluation-reviewer`, `regulator`), withholds small subgroups as the
 * submission page does, and computes the gaps listed in section 6. This page
 * only lays it out, in the interface language.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Translator = Awaited<ReturnType<typeof getTranslations<'EvidenceSummary'>>>;

type Loaded =
  | { kind: 'ok'; summary: EvidenceSummary }
  | { kind: 'signedOut' }
  | { kind: 'expired' }
  | { kind: 'forbidden' }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string | null };

/** One read per request, shared by the metadata and the page. */
const loadEvidence = cache(async (id: string): Promise<Loaded> => {
  const session = await auth();
  if (!session?.user) return { kind: 'signedOut' };
  try {
    const summary = await apiFetch<EvidenceSummary>(`/v2/evaluation/submissions/${id}/evidence`, {
      session,
      revalidate: 0,
    });
    return summary ? { kind: 'ok', summary } : { kind: 'notFound' };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ApiError && err.status === 403) return { kind: 'forbidden' };
    if (err instanceof ApiError && err.status === 401) return { kind: 'expired' };
    return { kind: 'error', message: err instanceof Error ? err.message : null };
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations('EvidenceSummary');
  const loaded = UUID.test(id) ? await loadEvidence(id) : null;
  return {
    title: t('metaTitle', {
      method: loaded?.kind === 'ok' ? loaded.summary.submission.methodName : t('eyebrow'),
    }),
    description: t('metaDescription'),
    robots: { index: false, follow: false },
  };
}

export default async function EvidenceSummaryPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const path = `/evaluation/${encodeURIComponent(slug)}/submissions/${id}/evidence`;
  const [t, tm, f, loaded] = await Promise.all([
    getTranslations('EvidenceSummary'),
    getTranslations('Models'),
    getFormatters(),
    loadEvidence(id),
  ]);

  if (loaded.kind === 'notFound') notFound();
  if (loaded.kind === 'expired') redirect(reauthUrl(path));
  if (loaded.kind === 'signedOut') {
    return (
      <Notice tone="info" title={t('signedOut.title')}>
        {t('signedOut.body')}{' '}
        <Link
          href={`/signin?callbackUrl=${encodeURIComponent(path)}`}
          className="font-medium underline underline-offset-2"
        >
          {t('signedOut.action')}
        </Link>
      </Notice>
    );
  }
  if (loaded.kind === 'forbidden') {
    return (
      <Notice tone="info" title={t('forbidden.title')}>
        {t('forbidden.body')}{' '}
        <Link
          href={`/evaluation/${encodeURIComponent(slug)}/submissions/${id}`}
          className="font-medium underline underline-offset-2"
        >
          {t('back')}
        </Link>
      </Notice>
    );
  }
  if (loaded.kind === 'error') {
    return (
      <Notice tone="danger" title={t('unavailable.title')}>
        <span className="block whitespace-pre-wrap break-words font-mono text-xs">
          {loaded.message ?? t('unavailable.fallback')}
        </span>
      </Notice>
    );
  }

  const summary = loaded.summary;
  // A submission is only answered under the task it belongs to.
  if (summary.task.slug !== slug) notFound();
  return <EvidenceDocument summary={summary} t={t} tm={tm} f={f} />;
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'danger';
  title: string;
  children: ReactNode;
}) {
  return (
    <Container size="md">
      <Section spacing="md">
        <Alert tone={tone}>
          <AlertTitle as="h1">{title}</AlertTitle>
          <AlertDescription>{children}</AlertDescription>
        </Alert>
      </Section>
    </Container>
  );
}

// ---- The document --------------------------------------------------------------

const MUTED = 'text-[var(--color-muted-foreground)]';
const LINK =
  'rounded font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';
const REGION =
  'overflow-x-auto rounded-md border border-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';
const TH = 'px-1.5 py-1.5 font-medium sm:px-2.5';
const TD = 'px-1.5 py-1.5 align-top sm:px-2.5';

function standingTone(standing: EvidenceStanding): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (standing) {
    case 'PUBLISHED':
      return 'success';
    case 'PROVISIONAL':
      return 'warning';
    case 'RETRACTED':
      return 'danger';
    default:
      return 'neutral';
  }
}

const REVIEW_TONE: Record<RouteReviewStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  APPROVED: 'success',
  DECLARED: 'neutral',
  UNDER_REVIEW: 'warning',
  REJECTED: 'danger',
  WITHDRAWN: 'danger',
};

interface DocProps {
  summary: EvidenceSummary;
  t: Translator;
  tm: ModelLabelTranslator;
  f: Formatters;
}

function EvidenceDocument({ summary, t, tm, f }: DocProps) {
  const { submission, task } = summary;
  const utc = (iso: string) =>
    f.dateTime(iso, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const submissionHref = `/evaluation/${encodeURIComponent(task.slug)}/submissions/${submission.id}`;

  return (
    <article
      aria-labelledby="evidence-title"
      className="evidence-summary mx-auto w-full max-w-4xl px-4 pb-12 pt-6 sm:px-6 sm:pt-8"
    >
      <div className="evidence-screen-only mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href={submissionHref}
          className={`inline-flex items-center gap-1.5 rounded text-sm ${MUTED} hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]`}
        >
          <ArrowLeftIcon size={14} />
          <span>{t('back')}</span>
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className={`text-sm ${MUTED}`}>{t('printHint')}</span>
          <PrintButton label={t('print')} />
        </div>
      </div>

      <header className="border-b border-[var(--color-border)] pb-4">
        <p className={`text-xs font-medium uppercase tracking-[0.16em] ${MUTED}`}>{t('eyebrow')}</p>
        <h1
          id="evidence-title"
          className="mt-1.5 break-words text-2xl font-semibold tracking-tight text-[var(--color-foreground)] sm:text-3xl"
        >
          {submission.methodName}
        </h1>
        <p className="mt-1 text-base text-[var(--color-foreground)]">
          {t('testedOn', { task: task.name })}
        </p>
        <p className={`mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm ${MUTED}`}>
          <span>{t('submitted', { date: utc(submission.createdAt) })}</span>
          <span>{t('generated', { date: utc(summary.generatedAt) })}</span>
          <span className="break-all font-mono text-xs leading-5">
            {t('submissionId', { id: submission.id })}
          </span>
          {submission.viewerIsSubmitter ? (
            <span className="evidence-screen-only font-medium text-[var(--color-foreground)]">
              {t('yourSubmission')}
            </span>
          ) : null}
        </p>
      </header>

      <Glance summary={summary} t={t} f={f} />

      <EvidenceSection n={1} id="intended-use" title={t('section.intendedUse')}>
        <IntendedUse summary={summary} t={t} tm={tm} />
      </EvidenceSection>
      <EvidenceSection n={2} id="data" title={t('section.data')}>
        <Data summary={summary} t={t} f={f} />
      </EvidenceSection>
      <EvidenceSection n={3} id="method" title={t('section.method')}>
        <Method summary={summary} t={t} f={f} />
      </EvidenceSection>
      <EvidenceSection n={4} id="performance" title={t('section.performance')}>
        <Performance summary={summary} t={t} f={f} />
      </EvidenceSection>
      <EvidenceSection n={5} id="subgroups" title={t('section.subgroups')}>
        <Subgroups summary={summary} t={t} f={f} />
      </EvidenceSection>
      <EvidenceSection n={6} id="gaps" title={t('section.gaps')}>
        <Gaps gaps={summary.gaps} t={t} f={f} />
      </EvidenceSection>
      <EvidenceSection n={7} id="trace" title={t('section.trace')}>
        <Trace summary={summary} t={t} f={f} />
      </EvidenceSection>

      <footer className={`mt-8 border-t border-[var(--color-border)] pt-3 text-xs ${MUTED}`}>
        {t('footer', { id: submission.id, date: utc(summary.generatedAt) })}
      </footer>
    </article>
  );
}

function EvidenceSection({
  n,
  id,
  title,
  children,
}: {
  n: number;
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="evidence-section mt-8 scroll-mt-24 border-t border-[var(--color-border)] pt-6"
    >
      <h2
        id={`${id}-title`}
        className="flex items-baseline gap-2 text-lg font-semibold text-[var(--color-foreground)]"
      >
        <span className={`tabular-nums ${MUTED}`}>{n}.</span>
        <span>{title}</span>
      </h2>
      <div className="mt-3 space-y-3 text-base leading-relaxed text-[var(--color-foreground)] print:text-sm">
        {children}
      </div>
    </section>
  );
}

/** Term and value pairs, one per line; the term column collapses on a phone. */
function Facts({ items }: { items: ReadonlyArray<readonly [string, ReactNode] | null> }) {
  return (
    <dl className="space-y-1.5">
      {items.map((item) =>
        item === null ? null : (
          <div key={item[0]} className="evidence-keep sm:grid sm:grid-cols-[12rem_1fr] sm:gap-x-4">
            <dt className={`font-medium ${MUTED}`}>{item[0]}</dt>
            <dd className="min-w-0 break-words">{item[1]}</dd>
          </div>
        ),
      )}
    </dl>
  );
}

// ---- At a glance ----------------------------------------------------------------

function Glance({ summary, t, f }: { summary: EvidenceSummary; t: Translator; f: Formatters }) {
  const { standing, scores } = summary.performance;
  const headline = scores ? metricRows(scores, f).slice(0, 2) : [];
  return (
    <section
      aria-labelledby="glance-title"
      className="evidence-keep evidence-glance mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2
          id="glance-title"
          className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--color-foreground)]"
        >
          {t('glance.title')}
        </h2>
        <Badge tone={standingTone(standing)}>{t(`standing.${standing}`)}</Badge>
      </div>
      <p className="mt-2 max-w-prose text-sm text-[var(--color-foreground)]">
        {t(`standingNote.${standing}`)}
      </p>
      {headline.length > 0 ? (
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {headline.map((row) => (
            <div key={row.key}>
              <dt className={`text-sm font-medium ${MUTED}`}>{t(`metric.${row.key}`)}</dt>
              <dd className="mt-0.5">
                <span className="text-3xl font-semibold tabular-nums text-[var(--color-foreground)]">
                  {row.value ?? t('performance.notEstimable')}
                </span>
                {row.interval ? (
                  <span className="mt-0.5 block text-sm tabular-nums text-[var(--color-foreground)]">
                    {t('performance.interval')}{' '}
                    {t('performance.intervalValue', {
                      lower: row.interval.lower,
                      upper: row.interval.upper,
                    })}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="mt-4 text-sm font-medium">
        <a href="#gaps" className={LINK}>
          {t('glance.gapCount', { count: summary.gaps.length })}
        </a>
      </p>
    </section>
  );
}

// ---- 1 · Intended use -------------------------------------------------------------

function IntendedUse({
  summary,
  t,
  tm,
}: {
  summary: EvidenceSummary;
  t: Translator;
  tm: ModelLabelTranslator;
}) {
  const card = summary.modelCard;
  if (!card) return <p>{t('intendedUse.noCard')}</p>;
  const ius = card.intendedUse;
  return (
    <>
      <Facts
        items={[
          [
            t('intendedUse.card'),
            <>
              {t('intendedUse.cardValue', { slug: card.slug, version: card.version })} ·{' '}
              {t('intendedUse.cardStatus', { status: card.status })}
            </>,
          ],
          card.modelDeveloper ? [t('intendedUse.developer'), card.modelDeveloper] : null,
          card.clinicalSummary ? [t('intendedUse.summary'), card.clinicalSummary] : null,
          ...(ius ? statementFacts(ius, t, tm) : []),
          card.knownBiases ? [t('intendedUse.knownBiases'), card.knownBiases] : null,
        ]}
      />
      {ius ? null : <p>{t('intendedUse.noStatement')}</p>}
    </>
  );
}

function statementFacts(
  ius: IntendedUseStatement,
  t: Translator,
  tm: ModelLabelTranslator,
): Array<readonly [string, ReactNode] | null> {
  const purpose =
    ius.medicalPurpose === 'other' && ius.medicalPurposeOther
      ? ius.medicalPurposeOther
      : medicalPurposeText(tm, ius.medicalPurpose);
  return [
    [
      t('intendedUse.purpose'),
      ius.bodySystemOrSite ? `${purpose} · ${ius.bodySystemOrSite}` : purpose,
    ],
    [
      t('intendedUse.riskTier'),
      <strong key="tier">{t('intendedUse.riskTierValue', { tier: ius.riskTier })}</strong>,
    ],
    ius.intendedUserRole?.length
      ? [
          t('intendedUse.users'),
          ius.intendedUserRole.map((r) => intendedUserText(tm, r)).join(', '),
        ]
      : null,
    ius.intendedClinicalPathway
      ? [t('intendedUse.pathway'), clinicalPathwayText(tm, ius.intendedClinicalPathway)]
      : null,
    ius.operatingEnvironment?.length
      ? [
          t('intendedUse.environments'),
          ius.operatingEnvironment.map((e) => operatingEnvironmentText(tm, e)).join(', '),
        ]
      : null,
    ius.targetPopulation?.populationDescription
      ? [t('intendedUse.population'), ius.targetPopulation.populationDescription]
      : null,
    [t('intendedUse.misuse'), ius.foreseeableMisuse],
    ius.contraindications.trim()
      ? [t('intendedUse.contraindications'), ius.contraindications]
      : null,
  ];
}

// ---- 2 · Data ---------------------------------------------------------------------

function Data({ summary, t, f }: { summary: EvidenceSummary; t: Translator; f: Formatters }) {
  const { dataset, referenceLabels: labels } = summary.data;
  const items: [string, ReactNode] = [
    t('data.items'),
    t('data.itemsValue', { count: summary.task.itemCount }),
  ];
  if (!dataset) {
    return (
      <>
        <p>{t('data.notAvailable', { slug: summary.task.datasetSlug })}</p>
        <Facts items={[items]} />
      </>
    );
  }
  const collection = dataset.collection ? excerpt(dataset.collection) : null;
  const annotation = labels?.annotationProtocol ? excerpt(labels.annotationProtocol, 200) : null;
  const labelLines = labels
    ? [
        labels.readersPerItem !== null
          ? t('data.readers', { count: labels.readersPerItem })
          : t('data.readersUnknown'),
        labels.readerQualification
          ? t('data.qualification', { qualification: labels.readerQualification })
          : null,
        labels.adjudication ? t('data.adjudication', { adjudication: labels.adjudication }) : null,
        labels.agreement
          ? t('data.agreement', {
              metric: labels.agreement.metric,
              value: f.number(labels.agreement.value, { maximumFractionDigits: 3 }),
            })
          : null,
        labels.labelScale ? t('data.labelScale', { scale: labels.labelScale }) : null,
        labels.protocolVersion ? t('data.protocol', { version: labels.protocolVersion }) : null,
      ].filter((line): line is string => line !== null)
    : [];

  return (
    <>
      {dataset.synthetic ? (
        <p className="evidence-keep rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning-soft)] px-3 py-2 font-medium text-[var(--color-warning-foreground)]">
          {t('data.synthetic')}
        </p>
      ) : null}
      <Facts
        items={[
          [
            t('data.dataset'),
            <>
              {dataset.name}
              <Link
                href={`/catalog/${encodeURIComponent(dataset.slug)}`}
                className={`${LINK} block w-fit break-all font-mono text-xs`}
              >
                {dataset.slug}
              </Link>
            </>,
          ],
          [
            t('data.version'),
            dataset.version ? (
              <>
                {dataset.publishedAt
                  ? t('data.versionValue', {
                      version: dataset.version,
                      date: f.date(dataset.publishedAt, { dateStyle: 'medium', timeZone: 'UTC' }),
                    })
                  : dataset.version}
                <span className={`block text-xs ${MUTED}`}>{t('data.versionNote')}</span>
              </>
            ) : (
              t('data.noVersion')
            ),
          ],
          [t('data.licence'), dataset.licence ?? t('data.notDeclared')],
          dataset.sourceOrganizations.length > 0 || dataset.derivedFrom.length > 0
            ? [
                t('data.source'),
                <>
                  {dataset.sourceOrganizations.join('; ')}
                  {dataset.derivedFrom.length > 0 ? (
                    <span className={`block break-all text-xs ${MUTED}`}>
                      {t('data.derivedFrom', { value: dataset.derivedFrom.join(', ') })}
                    </span>
                  ) : null}
                </>,
              ]
            : null,
          collection
            ? [
                t('data.collection'),
                <>
                  {collection.text}
                  {dataset.collectionTimeframe ? (
                    <span className={`block text-xs ${MUTED}`}>
                      {t('data.collectionTimeframe', { value: dataset.collectionTimeframe })}
                    </span>
                  ) : null}
                  {collection.cut ? (
                    <span className={`block text-xs ${MUTED}`}>{t('data.readMore')}</span>
                  ) : null}
                </>,
              ]
            : null,
          items,
          [
            t('data.labels'),
            labelLines.length > 0 || annotation ? (
              <>
                {labelLines.length > 0 ? (
                  <span className="block">{labelLines.join(' · ')}</span>
                ) : null}
                {annotation ? (
                  <span className={`block text-xs ${MUTED}`}>{annotation.text}</span>
                ) : null}
              </>
            ) : (
              t('data.labelsUndocumented')
            ),
          ],
          dataset.manifestSha256
            ? [
                t('data.manifestHash'),
                <code key="hash" className="break-all font-mono text-xs">
                  {dataset.manifestSha256}
                </code>,
              ]
            : null,
        ]}
      />
    </>
  );
}

// ---- 3 · Method -------------------------------------------------------------------

function Method({ summary, t, f }: { summary: EvidenceSummary; t: Translator; f: Formatters }) {
  const method = summary.method;
  if (method.kind === 'NOT_ATTRIBUTED') return <p>{t('method.notAttributed')}</p>;
  return (
    <Facts
      items={[
        [
          t('method.name'),
          <>
            <Link
              href={`/evaluation/routes/${encodeURIComponent(method.routeSlug)}`}
              className={LINK}
            >
              {method.routeName}
            </Link>
            <span className={`block text-xs ${MUTED}`}>
              {method.isReference
                ? t('method.reference')
                : method.providerName
                  ? t('method.provider', { provider: method.providerName })
                  : null}
            </span>
          </>,
        ],
        [t('method.version'), <span className="font-mono text-xs">{method.version}</span>],
        [
          t('method.status'),
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={REVIEW_TONE[method.reviewStatus]}>
              {t(`reviewStatus.${method.reviewStatus}`)}
            </Badge>
            <span className={`text-xs ${MUTED}`}>
              {method.reviewedAt
                ? t('method.reviewedOn', {
                    date: f.date(method.reviewedAt, { dateStyle: 'medium', timeZone: 'UTC' }),
                  })
                : t('method.notReviewed')}
            </span>
          </span>,
        ],
        method.reviewedAt || method.reviewNotes
          ? [
              t('method.rationale'),
              method.reviewNotes ? (
                <blockquote className="whitespace-pre-line border-s-2 border-[var(--color-border-strong)] ps-3">
                  {method.reviewNotes}
                </blockquote>
              ) : (
                t('method.noRationale')
              ),
            ]
          : null,
      ]}
    />
  );
}

// ---- 4 · Performance --------------------------------------------------------------

function Performance({
  summary,
  t,
  f,
}: {
  summary: EvidenceSummary;
  t: Translator;
  f: Formatters;
}) {
  const scores = summary.performance.scores;
  if (!scores) return <p>{t('performance.notScored')}</p>;
  const rows = metricRows(scores, f);
  const withIntervals = rows.some((r) => r.interval !== null);
  const threshold = f.number(summary.task.referableThreshold);
  return (
    <>
      <p className={MUTED}>{t('performance.intro', { task: summary.task.name })}</p>
      <div tabIndex={0} role="region" aria-label={t('performance.tableLabel')} className={REGION}>
        <table className="w-full border-collapse text-xs sm:text-sm">
          <thead className={`bg-[var(--color-subtle)] ${MUTED}`}>
            <tr>
              <th scope="col" className={`${TH} text-start`}>
                {t('performance.measure')}
              </th>
              <th scope="col" className={`${TH} text-end`}>
                {t('performance.result')}
              </th>
              {withIntervals ? (
                <>
                  <th scope="col" className={`${TH} text-end`}>
                    {t('performance.interval')}
                  </th>
                  <th scope="col" className={`${TH} text-end`}>
                    {t('performance.basis')}
                  </th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <MeasureRow
                key={row.key}
                row={row}
                withIntervals={withIntervals}
                gloss={t(`gloss.${row.key}`, { threshold })}
                t={t}
              />
            ))}
          </tbody>
        </table>
      </div>
      {scores.kind === 'BINARY_DIAGNOSTIC' ? (
        <Confusion
          m={scores.metrics}
          positive={summary.task.positiveClassName ?? t('performance.positiveFallback')}
          t={t}
          f={f}
        />
      ) : null}
      {scores.kind === 'CLASSIFICATION' ? (
        <PerClass perClass={scores.metrics.perClass} t={t} f={f} />
      ) : null}
    </>
  );
}

function MeasureRow({
  row,
  withIntervals,
  gloss,
  t,
}: {
  row: MetricRow;
  withIntervals: boolean;
  gloss: string;
  t: Translator;
}) {
  return (
    <tr className="border-t border-[var(--color-border)]">
      <th scope="row" className={`${TD} text-start font-medium`}>
        {t(`metric.${row.key}`)}
        <span className={`block text-xs font-normal ${MUTED}`}>{gloss}</span>
      </th>
      <td className={`${TD} whitespace-nowrap text-end text-sm font-semibold tabular-nums`}>
        {row.value ??
          (row.absent === 'aucNeedsScores'
            ? t('performance.aucNeedsScores')
            : t('performance.notEstimable'))}
      </td>
      {withIntervals ? (
        <>
          <td className={`${TD} whitespace-nowrap text-end tabular-nums`}>
            {row.interval
              ? t('performance.intervalValue', {
                  lower: row.interval.lower,
                  upper: row.interval.upper,
                })
              : t('performance.noInterval')}
          </td>
          <td className={`${TD} whitespace-nowrap text-end tabular-nums ${MUTED}`}>
            {row.basis
              ? t('performance.basisValue', {
                  numerator: row.basis.numerator,
                  denominator: row.basis.denominator,
                })
              : row.resamples
                ? t('performance.aucBasis', { count: row.resamples })
                : t('performance.noInterval')}
          </td>
        </>
      ) : null}
    </tr>
  );
}

function Confusion({
  m,
  positive,
  t,
  f,
}: {
  m: BinaryDiagnosticScores;
  positive: string;
  t: Translator;
  f: Formatters;
}) {
  const cell = (n: number) => (
    <td className={`${TD} text-end text-sm font-semibold tabular-nums`}>{f.number(n)}</td>
  );
  return (
    <div className="evidence-keep space-y-1.5">
      <h3 className="font-semibold">{t('performance.confusion')}</h3>
      <div
        tabIndex={0}
        role="region"
        aria-label={t('performance.confusionLabel')}
        className={`${REGION} max-w-md`}
      >
        <table className="w-full border-collapse text-xs sm:text-sm">
          <thead className={`bg-[var(--color-subtle)] ${MUTED}`}>
            <tr>
              <td className={`${TD} text-xs`}>
                {t('performance.reference')} ↓ · {t('performance.answer')} →
              </td>
              <th scope="col" className={`${TH} text-end`}>
                {positive}
              </th>
              <th scope="col" className={`${TH} text-end`}>
                {t('performance.negative')}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-[var(--color-border)]">
              <th scope="row" className={`${TD} text-start font-medium`}>
                {positive}
              </th>
              {cell(m.truePositives)}
              {cell(m.falseNegatives)}
            </tr>
            <tr className="border-t border-[var(--color-border)]">
              <th scope="row" className={`${TD} text-start font-medium`}>
                {t('performance.negative')}
              </th>
              {cell(m.falsePositives)}
              {cell(m.trueNegatives)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PerClass({ perClass, t, f }: { perClass: ClassMetrics[]; t: Translator; f: Formatters }) {
  return (
    <div className="evidence-keep space-y-1.5">
      <h3 className="font-semibold">{t('performance.perClass')}</h3>
      <div
        tabIndex={0}
        role="region"
        aria-label={t('performance.perClassLabel')}
        className={REGION}
      >
        <table className="w-full border-collapse text-xs sm:text-sm">
          <thead className={`bg-[var(--color-subtle)] ${MUTED}`}>
            <tr>
              <th scope="col" className={`${TH} text-start`}>
                {t('performance.class')}
              </th>
              {(['precision', 'recall', 'f1', 'images'] as const).map((h) => (
                <th key={h} scope="col" className={`${TH} text-end`}>
                  {t(`performance.${h}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {perClass.map((c) => (
              <tr key={c.label} className="border-t border-[var(--color-border)]">
                <th scope="row" className={`${TD} text-start font-medium tabular-nums`}>
                  {f.number(c.label)}
                </th>
                {[c.precision, c.recall, c.f1].map((value, i) => (
                  <td key={i} className={`${TD} text-end tabular-nums`}>
                    {c.support === 0 && i > 0 ? (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">{t('performance.notApplicable')}</span>
                      </>
                    ) : (
                      rate(f, value)
                    )}
                  </td>
                ))}
                <td className={`${TD} text-end tabular-nums`}>{f.number(c.support)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- 5 · Subgroups ----------------------------------------------------------------

function Subgroups({ summary, t, f }: { summary: EvidenceSummary; t: Translator; f: Formatters }) {
  const scores = summary.performance.scores;
  if (!scores) return <p>{t('performance.notScored')}</p>;
  if (!summary.subgroups) return <p>{t('subgroups.none')}</p>;
  const tables = subgroupViews(summary.subgroups, scores, f, t('subgroups.overall'));
  return (
    <>
      <p className={MUTED}>
        {t('subgroups.intro', { min: f.number(summary.subgroups.minCellSize) })}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {tables.map((table) => (
          <SubgroupTable key={table.key} table={table} t={t} />
        ))}
      </div>
    </>
  );
}

function SubgroupTable({ table, t }: { table: SubgroupTableView; t: Translator }) {
  const field = table.label;
  return (
    <div className="evidence-keep min-w-0 space-y-1.5">
      <h3 className="font-semibold">{field}</h3>
      <div
        tabIndex={0}
        role="region"
        aria-label={t('subgroups.tableLabel', { field })}
        className={REGION}
      >
        <table className="w-full border-collapse text-xs">
          <thead className={`bg-[var(--color-subtle)] ${MUTED}`}>
            <tr>
              <th scope="col" className={`${TH} text-start`}>
                {t('subgroups.group')}
              </th>
              <th scope="col" className={`${TH} text-end`}>
                {t('subgroups.items')}
              </th>
              {table.columns.map((key) => (
                <th key={key} scope="col" className={`${TH} text-end`}>
                  {t(`metric.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr
                key={row.key}
                className={`border-t border-[var(--color-border)] ${
                  row.kind === 'overall' ? 'bg-[var(--color-subtle)]' : ''
                }`}
              >
                <th scope="row" className={`${TD} text-start font-medium`}>
                  {row.label}
                </th>
                {row.kind === 'suppressed' ? (
                  <td colSpan={table.columns.length + 1} className={`${TD} ${MUTED}`}>
                    <span aria-hidden="true">{t('subgroups.notReported')}</span>
                    <span className="sr-only">
                      {t('subgroups.notReportedSpoken', { group: row.label })}
                    </span>
                  </td>
                ) : (
                  <>
                    <td className={`${TD} text-end tabular-nums`}>
                      {row.items === null
                        ? '—'
                        : row.items.total === null
                          ? row.items.scored
                          : t('subgroups.itemsOf', {
                              scored: row.items.scored,
                              total: row.items.total,
                            })}
                    </td>
                    {row.figures.map((figure, i) => (
                      <td key={i} className={`${TD} text-end tabular-nums`}>
                        <Figure figure={figure} t={t} />
                      </td>
                    ))}
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Figure({ figure, t }: { figure: SubgroupFigure; t: Translator }) {
  if (figure.state === 'withheld') {
    return (
      <>
        <span aria-hidden="true">{t('subgroups.withheld')}</span>
        <span className="sr-only">{t('subgroups.withheldSpoken')}</span>
      </>
    );
  }
  if (figure.state === 'na') {
    return (
      <>
        <span aria-hidden="true">{t('subgroups.notEstimable')}</span>
        <span className="sr-only">{t('subgroups.notEstimableSpoken')}</span>
      </>
    );
  }
  return (
    <>
      <span className="font-semibold">{figure.text}</span>
      {figure.interval ? (
        <span className={`block whitespace-nowrap ${MUTED}`}>
          {t('performance.intervalValue', {
            lower: figure.interval.lower,
            upper: figure.interval.upper,
          })}
        </span>
      ) : null}
    </>
  );
}

// ---- 6 · Gaps ---------------------------------------------------------------------

function Gaps({ gaps, t, f }: { gaps: readonly EvidenceGap[]; t: Translator; f: Formatters }) {
  if (gaps.length === 0) return <p>{t('gaps.none')}</p>;
  return (
    <>
      <p className={MUTED}>{t('gaps.intro')}</p>
      <ul aria-label={t('gaps.listLabel')} className="space-y-1.5">
        {gaps.map((gap) => (
          <li
            key={gap.code}
            data-gap={gap.code}
            className="flex gap-3 rounded-md border-s-4 border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-3 py-1.5 text-[var(--color-foreground)]"
          >
            <span className="min-w-0 flex-1">{t(`gaps.${gap.code}`, gapValues(gap, f))}</span>
            <span className={`shrink-0 whitespace-nowrap text-xs leading-5 ${MUTED}`}>
              {t('gaps.inSection', { number: gap.section })}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---- 7 · Trace --------------------------------------------------------------------

function Trace({ summary, t, f }: { summary: EvidenceSummary; t: Translator; f: Formatters }) {
  const { events, truncated } = summary.trace;
  if (events.length === 0) return <p>{t('trace.none')}</p>;
  const last = events.at(-1);
  return (
    <>
      <p className={MUTED}>{t('trace.intro')}</p>
      <div tabIndex={0} role="region" aria-label={t('trace.tableLabel')} className={REGION}>
        <table className="w-full border-collapse text-xs">
          <thead className={`bg-[var(--color-subtle)] ${MUTED}`}>
            <tr>
              <th scope="col" className={`${TH} text-end`}>
                {t('trace.sequence')}
              </th>
              <th scope="col" className={`${TH} text-start`}>
                {t('trace.time')}
              </th>
              <th scope="col" className={`${TH} text-start`}>
                {t('trace.event')}
              </th>
              <th scope="col" className={`${TH} text-start`}>
                {t('trace.recordHash')}
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const known = knownEvent(event.eventType);
              return (
                <tr key={event.sequenceNumber} className="border-t border-[var(--color-border)]">
                  <td className={`${TD} text-end tabular-nums`}>{event.sequenceNumber}</td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>
                    <time dateTime={event.occurredAt}>
                      {f.dateTime(event.occurredAt, {
                        dateStyle: 'short',
                        timeStyle: 'medium',
                        timeZone: 'UTC',
                      })}
                    </time>
                  </td>
                  <td className={TD}>
                    {known ? t(`trace.eventName.${known}`) : null}{' '}
                    <code className={`font-mono ${MUTED}`}>{event.eventType}</code>
                  </td>
                  <td className={`${TD} font-mono`}>
                    <span title={event.recordHash}>{shortHash(event.recordHash)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {last ? (
        <p className="evidence-keep text-xs">
          <span className={`font-medium ${MUTED}`}>{t('trace.lastHash')}</span>{' '}
          <code className="break-all font-mono">{last.recordHash}</code>
        </p>
      ) : null}
      {truncated ? (
        <p className={`text-xs ${MUTED}`}>
          {t('trace.truncated', { count: f.number(events.length) })}
        </p>
      ) : null}
    </>
  );
}

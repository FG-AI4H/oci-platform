import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Alert, AlertDescription, AlertTitle, Button, Container, Section } from '@oci/ui';
import {
  ActivityReportMonthSchema,
  lastCompleteMonth,
  recentMonths,
  type ActivityReport,
} from '@oci/shared-types';
import { auth } from '../../../auth';
import { getFormatters } from '../../../i18n/server';
import { apiFetch } from '../../../lib/api';
import { requireActivityReportReader } from '../../../lib/groups';
import './reports.css';

/**
 * `/admin/reports` (#828): the activity report of one calendar month, for the
 * people who run a deployment or oversee it (`admin`, `regulator`,
 * `supervisor`). The API assembles it (`GET /v2/reports/activity`); this page
 * picks the month and lays the figures out, on screen and on A4.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ActivityReport');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

const SELECT_CLASS =
  'block h-10 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-base sm:text-sm text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

const TH = 'px-3 py-2 text-start text-xs font-medium text-[var(--color-muted-foreground)]';
const TD = 'px-3 py-2 align-top';
const NUM = `${TD} tabular-nums`;

/** One figure with its label, in a section's summary list. */
function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-[var(--color-border)] py-2 last:border-b-0">
      <dt className="text-sm text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className="text-end font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function ReportSection({
  id,
  heading,
  note,
  children,
}: {
  id: string;
  heading: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="text-xl font-semibold tracking-tight">
        {heading}
      </h2>
      <div className="mt-3 space-y-4">{children}</div>
      {note ? (
        <p className="mt-3 max-w-3xl text-sm text-[var(--color-muted-foreground)]">{note}</p>
      ) : null}
    </section>
  );
}

/** A table that scrolls sideways inside its frame on a narrow screen. */
function ReportTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
    >
      <table className="w-full min-w-[36rem] border-collapse text-sm">{children}</table>
    </div>
  );
}

export default async function ActivityReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const session = requireActivityReportReader(await auth());
  const [t, f, params] = await Promise.all([
    getTranslations('ActivityReport'),
    getFormatters(),
    searchParams,
  ]);

  const now = new Date();
  const asked = ActivityReportMonthSchema.safeParse(
    Array.isArray(params.month) ? params.month[0] : params.month,
  );
  const month = asked.success ? asked.data : lastCompleteMonth(now);
  const months = recentMonths(now, 12);
  const choices = months.includes(month) ? months : [month, ...months];
  const monthName = (m: string) =>
    f.date(`${m}-01T00:00:00.000Z`, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  let report: ActivityReport | null = null;
  let error: string | null = null;
  try {
    report = await apiFetch<ActivityReport>(`/v2/reports/activity?month=${month}`, {
      session,
      revalidate: 0,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : t('unavailable.fallback');
  }

  const day = (iso: string) => f.date(iso, { dateStyle: 'long', timeZone: 'UTC' });
  const dash = t('dash');
  const ratio = (value: number | null) => (value === null ? dash : f.percent(value));

  return (
    <Container size="page">
      <Section spacing="md">
        <div className="activity-report">
          <header className="max-w-3xl space-y-3">
            <p className="activity-report-screen-only text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
              {t('eyebrow')}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {report ? t('meta.title', { month: monthName(report.month) }) : t('heading')}
            </h1>
            <p className="text-[var(--color-muted-foreground)]">{t('lead')}</p>
          </header>

          <div className="activity-report-screen-only mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <form action="/admin/reports" method="get" className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label htmlFor="report-month" className="block text-sm font-medium">
                  {t('month.label')}
                </label>
                <select
                  id="report-month"
                  name="month"
                  defaultValue={month}
                  className={SELECT_CLASS}
                >
                  {choices.map((m) => (
                    <option key={m} value={m}>
                      {m === months[0] ? t('month.current', { month: monthName(m) }) : monthName(m)}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" variant="outline">
                {t('month.show')}
              </Button>
            </form>
            {report ? (
              // A plain link, not a Next link: it is a file, not a page to prefetch.
              <a
                href={`/admin/reports/export?month=${report.month}`}
                className="inline-flex min-h-11 items-center rounded text-sm font-medium text-[var(--color-primary)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] sm:min-h-0"
              >
                {t('actions.json')}
              </a>
            ) : null}
          </div>
          <p className="activity-report-screen-only mt-2 text-sm text-[var(--color-muted-foreground)]">
            {t('actions.printHint')}
          </p>

          {error ? (
            <Alert tone="danger" className="mt-8">
              <AlertTitle>{t('unavailable.title')}</AlertTitle>
              <AlertDescription>
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">
                  {error}
                </pre>
              </AlertDescription>
            </Alert>
          ) : null}

          {report ? (
            <>
              {report.partial ? (
                <p
                  role="note"
                  className="mt-6 max-w-3xl rounded-md bg-[var(--color-warning-soft)] px-4 py-3 text-sm text-[var(--color-warning-foreground)]"
                >
                  {t('meta.partial')}
                </p>
              ) : null}
              <dl className="mt-6 max-w-xl">
                <Figure label={t('meta.deployment')} value={report.deployment} />
                <Figure
                  label={t('meta.period')}
                  value={t('meta.periodValue', {
                    from: day(report.from),
                    // The period is [from, to): its last day is the day before `to`.
                    to: day(new Date(Date.parse(report.to) - 86_400_000).toISOString()),
                  })}
                />
                <Figure label={t('meta.generated')} value={f.dateTime(report.generatedAt)} />
              </dl>

              <ReportSection id="report-datasets" heading={t('datasets.heading')}>
                <dl className="max-w-xl">
                  <Figure
                    label={t('datasets.publishedAtEnd')}
                    value={f.number(report.datasets.publishedAtEnd)}
                  />
                  <Figure
                    label={t('datasets.versionsPublished')}
                    value={f.number(report.datasets.versionsPublished)}
                  />
                </dl>
                {report.datasets.versions.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {t('datasets.none')}
                  </p>
                ) : (
                  <>
                    <ReportTable label={t('datasets.listHeading')}>
                      <thead className="bg-[var(--color-muted)]">
                        <tr>
                          <th scope="col" className={TH}>
                            {t('datasets.colDataset')}
                          </th>
                          <th scope="col" className={TH}>
                            {t('datasets.colVersion')}
                          </th>
                          <th scope="col" className={TH}>
                            {t('datasets.colPublished')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.datasets.versions.map((v) => (
                          <tr
                            key={`${v.slug}@${v.version}`}
                            className="border-t border-[var(--color-border)]"
                          >
                            <th scope="row" className={`${TD} text-start font-normal`}>
                              <Link
                                href={`/catalog/${encodeURIComponent(v.slug)}`}
                                className="font-medium text-[var(--color-primary)] hover:underline"
                              >
                                {v.name}
                              </Link>
                            </th>
                            <td className={`${TD} font-mono text-xs`}>{v.version}</td>
                            <td className={TD}>{day(v.publishedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </ReportTable>
                    {report.datasets.versionsPublished > report.datasets.versions.length ? (
                      <p className="text-sm text-[var(--color-muted-foreground)]">
                        {t('datasets.more')}
                      </p>
                    ) : null}
                  </>
                )}
              </ReportSection>

              <ReportSection
                id="report-access"
                heading={t('accessRequests.heading')}
                note={t('accessRequests.note')}
              >
                <dl className="max-w-xl">
                  <Figure
                    label={t('accessRequests.submitted')}
                    value={f.number(report.accessRequests.submitted)}
                  />
                  <Figure
                    label={t('accessRequests.approved')}
                    value={f.number(report.accessRequests.approved)}
                  />
                  <Figure
                    label={t('accessRequests.denied')}
                    value={f.number(report.accessRequests.denied)}
                  />
                  <Figure
                    label={t('accessRequests.pendingAtEnd')}
                    value={f.number(report.accessRequests.pendingAtEnd)}
                  />
                </dl>
              </ReportSection>

              <ReportSection
                id="report-evaluation"
                heading={t('evaluation.heading')}
                note={t('evaluation.note')}
              >
                <dl className="max-w-xl">
                  <Figure label={t('evaluation.tasks')} value={f.number(report.evaluation.tasks)} />
                  <Figure
                    label={t('evaluation.received')}
                    value={f.number(report.evaluation.received)}
                  />
                  <Figure
                    label={t('evaluation.scored')}
                    value={f.number(report.evaluation.scored)}
                  />
                  <Figure
                    label={t('evaluation.failed')}
                    value={f.number(report.evaluation.failed)}
                  />
                </dl>
                {report.evaluation.byTask.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {t('evaluation.none')}
                  </p>
                ) : (
                  <ReportTable label={t('evaluation.heading')}>
                    <thead className="bg-[var(--color-muted)]">
                      <tr>
                        <th scope="col" className={TH}>
                          {t('evaluation.colTask')}
                        </th>
                        <th scope="col" className={TH}>
                          {t('evaluation.colReceived')}
                        </th>
                        <th scope="col" className={TH}>
                          {t('evaluation.colScored')}
                        </th>
                        <th scope="col" className={TH}>
                          {t('evaluation.colFailed')}
                        </th>
                        <th scope="col" className={TH}>
                          {t('evaluation.colPublished')}
                        </th>
                        <th scope="col" className={TH}>
                          {t('evaluation.colBest')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.evaluation.byTask.map((task) => (
                        <tr key={task.slug} className="border-t border-[var(--color-border)]">
                          <th scope="row" className={`${TD} text-start font-normal`}>
                            <Link
                              href={`/evaluation/${encodeURIComponent(task.slug)}`}
                              className="font-medium text-[var(--color-primary)] hover:underline"
                            >
                              {task.name}
                            </Link>
                          </th>
                          <td className={NUM}>{f.number(task.received)}</td>
                          <td className={NUM}>{f.number(task.scored)}</td>
                          <td className={NUM}>{f.number(task.failed)}</td>
                          <td className={NUM}>{f.number(task.publishedResults)}</td>
                          <td className={TD}>
                            {task.best
                              ? t('evaluation.best', {
                                  value: f.number(task.best.value, { maximumFractionDigits: 3 }),
                                  metric: task.best.metricLabel,
                                  method: task.best.methodName,
                                })
                              : t('evaluation.noBest')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </ReportTable>
                )}
              </ReportSection>

              <ReportSection id="report-models" heading={t('models.heading')}>
                <dl className="max-w-xl">
                  <Figure label={t('models.published')} value={f.number(report.models.published)} />
                  <Figure
                    label={t('models.publishedInPeriod')}
                    value={f.number(report.models.publishedInPeriod)}
                  />
                </dl>
              </ReportSection>

              <ReportSection
                id="report-annotation"
                heading={t('annotation.heading')}
                note={report.annotation.campaigns.length > 0 ? t('annotation.note') : undefined}
              >
                {report.annotation.campaigns.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {t('annotation.none')}
                  </p>
                ) : (
                  <ReportTable label={t('annotation.heading')}>
                    <thead className="bg-[var(--color-muted)]">
                      <tr>
                        <th scope="col" className={TH}>
                          {t('annotation.colCampaign')}
                        </th>
                        <th scope="col" className={TH}>
                          {t('annotation.colStatus')}
                        </th>
                        <th scope="col" className={TH}>
                          {t('annotation.colCounted')}
                        </th>
                        <th scope="col" className={TH}>
                          {t('annotation.colOpen')}
                        </th>
                        <th scope="col" className={TH}>
                          {t('annotation.colArbitration')}
                        </th>
                        <th scope="col" className={TH}>
                          {t('annotation.colKappa')}
                        </th>
                        <th scope="col" className={TH}>
                          {t('annotation.colAgreement')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.annotation.campaigns.map((c) => (
                        <tr key={c.slug} className="border-t border-[var(--color-border)]">
                          <th scope="row" className={`${TD} text-start font-normal`}>
                            {c.name}
                          </th>
                          <td className={TD}>
                            {c.status === 'RUNNING' || c.status === 'COMPLETED'
                              ? t(`annotation.status.${c.status}`)
                              : c.status}
                          </td>
                          <td className={NUM}>{f.number(c.tasksCounted)}</td>
                          <td className={NUM}>{f.number(c.tasksOpen)}</td>
                          <td className={NUM}>{ratio(c.arbitrationShare)}</td>
                          <td className={NUM}>
                            {c.fleissKappa === null
                              ? dash
                              : f.number(c.fleissKappa, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                          </td>
                          <td className={NUM}>{ratio(c.percentAgreement)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </ReportTable>
                )}
              </ReportSection>

              <ReportSection id="report-audit" heading={t('audit.heading')}>
                <dl className="max-w-xl">
                  <Figure label={t('audit.events')} value={f.number(report.audit.events)} />
                  <Figure
                    label={t('audit.chain')}
                    value={t(`audit.status.${report.audit.chain}`, {
                      checked: report.audit.checked,
                    })}
                  />
                </dl>
              </ReportSection>
            </>
          ) : null}
        </div>
      </Section>
    </Container>
  );
}

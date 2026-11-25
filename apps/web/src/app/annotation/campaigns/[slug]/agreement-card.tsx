import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle, DownloadIcon, buttonVariants } from '@oci/ui';
import { CANNOT_ASSESS_LABEL, type CampaignAgreement } from '@oci/shared-types';
import { getFormatters } from '../../../../i18n/server';
import { intervalBands, kappaBand } from './agreement-reading';

/**
 * « Agreement between readers » on the campaign page (#648), for the
 * campaign's managers and supervisors: Fleiss' kappa with its interval
 * and a plain-language reading, the counts, the pairwise table and the
 * answers per reader, with the export beside it (managers and
 * supervisors alike, as the API allows).
 *
 * `agreement` is null when the API could not give it (the card says so
 * rather than breaking the page).
 */
export async function AgreementCard({
  slug,
  agreement,
  canExport,
}: {
  slug: string;
  agreement: CampaignAgreement | null;
  canExport: boolean;
}) {
  const [t, fmt] = await Promise.all([getTranslations('Campaign.agreement'), getFormatters()]);
  const kappa = (value: number) =>
    fmt.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const share = (value: number) => fmt.percent(value, { maximumFractionDigits: 1 });
  const n = (value: number) => fmt.number(value);
  const muted = 'text-[var(--color-muted-foreground)]';

  const exportHref = (format: 'csv' | 'json') =>
    `/annotation/campaigns/${encodeURIComponent(slug)}/export?format=${format}`;

  return (
    <Card className="mt-4" id="campaign-agreement">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <CardTitle>{t('title')}</CardTitle>
        {canExport ? (
          <div
            role="group"
            aria-labelledby="campaign-export-title"
            className="flex flex-wrap items-center gap-2"
          >
            <span
              id="campaign-export-title"
              className={`basis-full text-sm sm:basis-auto ${muted}`}
            >
              {t('export.title')}
            </span>
            {(['csv', 'json'] as const).map((format) => (
              // A plain link, never prefetched: every request is an
              // export, and every export is recorded.
              <a
                key={format}
                href={exportHref(format)}
                download
                aria-label={t(`export.${format}Label`)}
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                <DownloadIcon size={14} />
                {t(`export.${format}`)}
              </a>
            ))}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6">
        {agreement === null ? (
          <p className={`text-sm ${muted}`}>{t('unavailable')}</p>
        ) : (
          <AgreementBody
            agreement={agreement}
            t={t}
            f={{ kappa, share, n }}
            canExport={canExport}
          />
        )}
      </CardContent>
    </Card>
  );
}

type Translator = Awaited<ReturnType<typeof getTranslations<'Campaign.agreement'>>>;
interface Format {
  kappa: (v: number) => string;
  share: (v: number) => string;
  n: (v: number) => string;
}

function AgreementBody({
  agreement: a,
  t,
  f,
  canExport,
}: {
  agreement: CampaignAgreement;
  t: Translator;
  f: Format;
  canExport: boolean;
}) {
  const muted = 'text-[var(--color-muted-foreground)]';
  const overall = a.overall;
  const answerName = (value: string) =>
    value === CANNOT_ASSESS_LABEL
      ? t('cannotAssess')
      : (a.labels.find((l) => l.value === value)?.display ?? value);
  const notCounted = a.tasks.open + a.tasks.skipped + a.tasks.excluded;

  return (
    <>
      <section aria-labelledby="agreement-overall" className="space-y-2">
        <h4 id="agreement-overall" className="sr-only">
          {t('fleiss')}
        </h4>
        {overall.status === 'computed' && overall.fleissKappa !== null ? (
          <>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={`text-sm ${muted}`}>{t('fleiss')}</span>
              <span className="text-3xl font-semibold tabular-nums" data-testid="fleiss-kappa">
                {f.kappa(overall.fleissKappa)}
              </span>
              {overall.interval ? (
                <span className="text-sm tabular-nums">
                  <span aria-hidden="true">
                    {t('interval', {
                      lower: f.kappa(overall.interval.lower),
                      upper: f.kappa(overall.interval.upper),
                    })}
                  </span>
                  <span className="sr-only">
                    {t('intervalSpoken', {
                      lower: f.kappa(overall.interval.lower),
                      upper: f.kappa(overall.interval.upper),
                    })}
                  </span>
                </span>
              ) : null}
            </p>
            <p className="max-w-prose text-sm">
              {t.rich('reading', {
                band: t(`band.${kappaBand(overall.fleissKappa)}`),
                strong: (chunks) => <strong className="font-semibold">{chunks}</strong>,
              })}{' '}
              {(() => {
                const span = intervalBands(overall.interval);
                return span
                  ? t('readingSpan', { from: t(`band.${span.from}`), to: t(`band.${span.to}`) })
                  : null;
              })()}
            </p>
            <p className={`max-w-prose text-xs ${muted}`}>{t('caveat')}</p>
          </>
        ) : (
          <p className="max-w-prose text-sm" data-testid="agreement-state">
            {overall.status === 'single-answer'
              ? t('status.singleAnswer')
              : overall.status === 'single-reader'
                ? t('status.singleReader')
                : t('status.tooFewTasks', { minimum: a.minimumTasks, counted: a.tasks.counted })}
          </p>
        )}
      </section>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Count term={t('counts.counted')} value={f.n(a.tasks.counted)} />
        <Count term={t('counts.readers')} value={f.n(a.readers)} />
        <Count
          term={t('counts.readersPerTask')}
          value={a.readersPerTask === null ? '–' : f.n(a.readersPerTask)}
        />
        <Count
          term={t('counts.arbitration')}
          value={
            a.tasks.arbitrationShare === null
              ? f.n(a.tasks.sentToArbitration)
              : t('counts.arbitrationValue', {
                  count: f.n(a.tasks.sentToArbitration),
                  share: f.share(a.tasks.arbitrationShare),
                })
          }
        />
        {overall.percentAgreement !== null ? (
          <Count term={t('counts.percentAgreement')} value={f.share(overall.percentAgreement)} />
        ) : null}
        {overall.unanimousTasks !== null ? (
          <Count term={t('counts.unanimous')} value={f.n(overall.unanimousTasks)} />
        ) : null}
      </dl>

      <section aria-labelledby="agreement-pairs" className="space-y-2">
        <h4 id="agreement-pairs" className="text-sm font-semibold">
          {t('pairs.title')}
        </h4>
        {a.pairwise.length === 0 ? (
          <p className={`text-sm ${muted}`}>{t('pairs.none')}</p>
        ) : (
          <>
            <p className={`text-xs ${muted}`} aria-hidden="true">
              {t('pairs.caption')}
            </p>
            {/* Scrolls sideways on a narrow screen; focusable so a keyboard can scroll it. */}
            <div
              className="overflow-x-auto rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
              role="region"
              aria-labelledby="agreement-pairs"
              tabIndex={0}
            >
              <table className="w-full min-w-[22rem] text-sm">
                <caption className="sr-only">{t('pairs.caption')}</caption>
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-start">
                    <th scope="col" className="py-2 pe-3 text-start font-medium">
                      {t('pairs.pair')}
                    </th>
                    <th scope="col" className="py-2 pe-3 text-end font-medium">
                      {t('pairs.shared')}
                    </th>
                    <th scope="col" className="py-2 pe-3 text-end font-medium">
                      {t('pairs.kappa')}
                    </th>
                    <th scope="col" className="py-2 text-end font-medium">
                      {t('pairs.agreement')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {a.pairwise.map((p) => (
                    <tr
                      key={`${p.readerA}-${p.readerB}`}
                      className="border-b border-[var(--color-border)] last:border-0"
                    >
                      <th
                        scope="row"
                        className="py-2 pe-3 text-start font-mono text-xs font-normal"
                      >
                        {t.rich('pairs.pairValue', {
                          a: p.readerA,
                          b: p.readerB,
                          id: (chunks) => <span className="whitespace-nowrap">{chunks}</span>,
                        })}
                      </th>
                      <td className="py-2 pe-3 text-end tabular-nums">{f.n(p.sharedTasks)}</td>
                      <td className="py-2 pe-3 text-end tabular-nums">
                        {p.cohensKappa !== null ? (
                          f.kappa(p.cohensKappa)
                        ) : (
                          <span className={`text-xs ${muted}`}>
                            {p.status === 'single-answer'
                              ? t('pairs.singleAnswer')
                              : t('pairs.tooFew', { minimum: a.minimumTasks })}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-end tabular-nums">
                        {p.percentAgreement !== null ? f.share(p.percentAgreement) : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {a.labelCountsByReader.length > 0 ? (
        <details className="group space-y-2">
          <summary
            id="agreement-answers"
            className="cursor-pointer text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            {t('answers.title')}
          </summary>
          <p className={`pt-2 text-xs ${muted}`} aria-hidden="true">
            {t('answers.caption')}
          </p>
          <div
            className="overflow-x-auto rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
            role="region"
            aria-labelledby="agreement-answers"
            tabIndex={0}
          >
            <table className="w-full text-sm">
              <caption className="sr-only">{t('answers.caption')}</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th scope="col" className="py-2 pe-3 text-start font-medium">
                    {t('answers.reader')}
                  </th>
                  {a.labels.map((l) => (
                    <th key={l.value} scope="col" className="py-2 pe-3 text-end font-medium">
                      {answerName(l.value)}
                    </th>
                  ))}
                  <th scope="col" className="py-2 text-end font-medium">
                    {t('answers.readings')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {a.labelCountsByReader.map((r) => (
                  <tr
                    key={r.reader}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <th
                      scope="row"
                      className="whitespace-nowrap py-2 pe-3 text-start font-mono text-xs font-normal"
                    >
                      {r.reader}
                    </th>
                    {r.counts.map((c) => (
                      <td key={c.label} className="py-2 pe-3 text-end tabular-nums">
                        {f.n(c.count)}
                      </td>
                    ))}
                    <td className="py-2 text-end tabular-nums">{f.n(r.readings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <div className={`max-w-prose space-y-1 text-xs ${muted}`}>
        <p>{t('method.basis')}</p>
        <p data-testid="cannot-assess-rule">{t('method.cannotAssess')}</p>
        {overall.interval ? (
          <p>{t('method.interval', { resamples: f.n(overall.interval.resamples) })}</p>
        ) : null}
        {notCounted > 0 ? (
          <p>
            {t('method.notCounted', {
              open: f.n(a.tasks.open),
              skipped: f.n(a.tasks.skipped),
              excluded: f.n(a.tasks.excluded),
            })}
          </p>
        ) : null}
        <p>{canExport ? t('method.readersExport') : t('method.readers')}</p>
      </div>
    </>
  );
}

function Count({ term, value }: { term: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-[var(--color-muted-foreground)]">{term}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

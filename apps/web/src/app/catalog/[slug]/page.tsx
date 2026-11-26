import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Button,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Container,
  DefinitionItem,
  DefinitionList,
  ExternalLinkIcon,
  Section,
  Separator,
  ShieldIcon,
} from '@oci/ui';
import type {
  AccessRequestSummary,
  AccessTier,
  CommercialUseTerms,
  DatasetDetail,
  DatasetVisibility,
  DicomSeriesList,
} from '@oci/shared-types';
import { lookupDuoTerm } from '@oci/croissant';
import { auth } from '../../../auth';
import { apiFetch } from '../../../lib/api';
import {
  isPlatformHosted,
  isPreviewableImage,
  summariseBulkDownload,
} from '../../../lib/dataset-files';
import { datasetJsonLd } from '../../../lib/dataset-jsonld';
import { heldImageCount, seriesRows, type SeriesWords } from '../../../lib/dicom-series';
import { getFormatters } from '../../../i18n/server';
import { siteUrl } from '../../../lib/site-url';
import { isAdmin, isCampaignManager } from '../../../lib/groups';
import { isHostOfDataset } from '../../../lib/identity';
import { AccessCta } from './access-cta';
import { BulkDownload } from './bulk-download';
import { CreateCampaignCta } from './create-campaign-cta';
import { ImagePreviewButton } from './image-preview';
import { JsonTree } from './json-tree';
import { ManifestFullView } from './manifest-full-view';
import { ManifestTabs } from './manifest-tabs';
import { ProvenanceCard } from './provenance-card';
import { SeriesViewButton } from './series-viewer';

const visibilityTone: Record<DatasetVisibility, 'success' | 'info' | 'warning'> = {
  PUBLIC: 'success',
  RESTRICTED: 'warning',
  PRIVATE: 'info',
};

/**
 * Access-tier (#115) → badge tone. `OPEN` keeps a neutral/info tone so it
 * doesn't dominate the header; the higher tiers escalate visually because
 * they carry real consequences for the requester (will need a quiz pass /
 * passport / countersign before download will work).
 */
const accessTierTone: Record<AccessTier, 'info' | 'warning' | 'danger' | 'neutral'> = {
  OPEN: 'neutral',
  REGISTERED: 'info',
  CONTROLLED: 'warning',
  SENSITIVE: 'danger',
};

/**
 * Commercial-use band → badge tone (#119). `OK` is the affirmative
 * "this dataset welcomes commercial use" — green/success. Non-commercial
 * is a hard no for builders — flagged in warning. `CASE_BY_CASE` is
 * the talk-to-the-host band — neutral so it doesn't read as a refusal.
 */
const commercialTone: Record<CommercialUseTerms, 'success' | 'warning' | 'neutral'> = {
  OK: 'success',
  NON_COMMERCIAL_ONLY: 'warning',
  CASE_BY_CASE: 'neutral',
};

interface CroissantPreview {
  conformsTo?: string;
  license?: unknown;
  url?: string;
  citeAs?: string;
  keywords?: unknown;
  imagingModality?: unknown;
  bodyRegion?: unknown;
  diseaseCondition?: unknown;
  anonymizationLevel?: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('Dataset');
  return { title: t('metaTitle', { slug }) };
}

export default async function DatasetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ requested?: string }>;
}) {
  const { slug } = await params;
  const { requested } = await searchParams;
  const justRequested = requested === '1';
  const session = await auth();
  const t = await getTranslations('Dataset');
  const f = await getFormatters();

  let detail: DatasetDetail | null = null;
  let error: string | null = null;
  let ownRequests: AccessRequestSummary[] = [];
  try {
    // Never cached: the files listed depend on who asks (ADR-0026), and
    // a host landing here from the publish page must see the files of
    // the version just published; the 30 s fetch cache kept the old
    // list even after the publish action's revalidatePath.
    detail = await apiFetch<DatasetDetail>(`/v2/catalog/datasets/${encodeURIComponent(slug)}`, {
      session,
      revalidate: 0,
    });
    if (session) {
      // Pull the caller's own access requests so the CTA can render
      // status-aware (PENDING / APPROVED / DENIED). Best-effort —
      // failure here doesn't break the detail page; we just fall back
      // to the unauthenticated CTA shape.
      const all = await apiFetch<AccessRequestSummary[]>('/v2/me/access-requests', {
        session,
        revalidate: 0,
      });
      ownRequests = (all ?? []).filter((r) => r.dataset.slug === slug);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : t('catalogApiUnreachable');
  }

  if (error) {
    return (
      <Container size="md">
        <Section spacing="md">
          <Alert tone="danger">
            <AlertTitle>{t('catalogUnavailable')}</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        </Section>
      </Container>
    );
  }

  if (!detail) notFound();

  // DICOM series of the latest version (ADR-0026). Best effort: a
  // dataset the caller may not download from answers 403, and then
  // there is simply nothing to view. Never cached: the list depends on
  // who asks.
  let dicomSeries: DicomSeriesList | null = null;
  try {
    dicomSeries = await apiFetch<DicomSeriesList>(
      `/v2/storage/datasets/${encodeURIComponent(slug)}/dicom/series`,
      { session, revalidate: 0 },
    );
  } catch {
    dicomSeries = null;
  }
  // Series are named in the interface language; the English words are
  // the helper's default, so English reads exactly as before.
  const seriesWords: SeriesWords = {
    name: (modality, number) =>
      number === null
        ? t('series.nameNoNumber', { modality })
        : t('series.name', { modality, number }),
    images: (count) => t('series.images', { count }),
    inExam: (exam, name) => t('series.inExam', { exam, name }),
    nthOf: (title, place, total) => t('series.nthOf', { title, place, total }),
  };
  const seriesList = dicomSeries ? seriesRows(dicomSeries.series, seriesWords) : [];
  const heldImages = dicomSeries ? heldImageCount(dicomSeries.series) : 0;

  const m = (detail.croissant ?? {}) as Record<string, unknown> & CroissantPreview;
  const conformsTo =
    typeof m['dct:conformsTo'] === 'string'
      ? (m['dct:conformsTo'] as string)
      : (m.conformsTo ?? null);
  const license = m.license ?? m['sc:license'] ?? null;
  const homepage = m.url ?? m['sc:url'] ?? null;
  const citeAs = m.citeAs ?? m['sc:citeAs'] ?? null;
  const keywords = normalizeStringArray(m.keywords ?? m['sc:keywords']);
  const modalityNames = extractTermNames(m['bio:imagingModality'] ?? m.imagingModality);
  const bodyRegionNames = extractTermNames(m['bio:bodyRegion'] ?? m.bodyRegion);
  const diseaseNames = extractTermNames(m['bio:diseaseCondition'] ?? m.diseaseCondition);
  const anonymization = (m['bio:anonymizationLevel'] ?? m.anonymizationLevel) as string | undefined;

  // Google Dataset Search ingestion. Only emit for the slice of datasets
  // that are actually crawlable: PUBLIC + PUBLISHED.
  const indexable = detail.visibility === 'PUBLIC' && detail.status === 'PUBLISHED';
  const jsonLd = indexable ? datasetJsonLd(detail, siteUrl()) : null;

  // What a "Download all" would and wouldn't contain, from the rows the
  // page already has — so the archive's scope is stated before the click.
  const bulk = summariseBulkDownload(detail.distributions);

  return (
    <>
      {jsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
          }}
        />
      ) : null}

      <Section spacing="md" surface="hero">
        <Container size="xl">
          <Link
            href="/catalog"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>{t('breadcrumb')}</span>
          </Link>
          <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1 min-w-0">
              <p className="font-mono text-xs text-[var(--color-muted-foreground)]">
                {detail.slug}
              </p>
              <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--color-foreground)]">
                {detail.name}
              </h1>
              {detail.description ? (
                <p className="mt-4 max-w-2xl text-[var(--color-muted-foreground)]">
                  {detail.description}
                </p>
              ) : null}
            </div>
            <div className="flex flex-row flex-wrap items-start gap-2 lg:flex-col lg:items-end">
              {detail.status !== 'PUBLISHED' ? (
                <Badge tone="neutral">{t(`statusBadge.${detail.status}`)}</Badge>
              ) : null}
              <Badge tone={visibilityTone[detail.visibility]}>
                {t(`visibilityBadge.${detail.visibility}`)}
              </Badge>
              {/* Access tier (#115). Hidden for OPEN to avoid badge clutter
                  on the most common case; visible from REGISTERED upward
                  so requesters know what assurance they'll need. */}
              {detail.accessTier !== 'OPEN' ? (
                <Badge tone={accessTierTone[detail.accessTier]}>
                  {t(`accessTier.${detail.accessTier}`)}
                </Badge>
              ) : null}
              {/* Commercial-use band (#119). Always shown — even
                  CASE_BY_CASE — because builders need to know whether
                  to negotiate before investing in a deployment. */}
              <Badge tone={commercialTone[detail.commercialUseTerms]}>
                {t(`commercial.${detail.commercialUseTerms}`)}
              </Badge>
              {detail.latestVersion ? <Badge tone="primary">v{detail.latestVersion}</Badge> : null}
              {detail.conformanceVersion ? (
                <Badge tone="accent">Croissant {detail.conformanceVersion}</Badge>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="inline-flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
              <ShieldIcon size={12} />
              <span>
                {detail.status === 'PUBLISHED'
                  ? t(`visibilityCopy.${detail.visibility}`)
                  : t(`statusCopy.${detail.status}`)}
              </span>
            </p>
            {/* The host's way back into the publish flow. A draft has no
                version yet, so the wording says what is missing. */}
            {isAdmin(session) || isHostOfDataset(session, detail.hostId) ? (
              <Button asChild size="sm" variant={detail.latestVersion ? 'outline' : 'primary'}>
                <Link href={`/catalog/${detail.slug}/publish`}>
                  {detail.latestVersion ? t('publishNewVersion') : t('publishFirstVersion')}
                </Link>
              </Button>
            ) : null}
          </div>

          {/*
           * Access-request widget (PR L.3). Visible whenever the
           * dataset is gated for the caller — RESTRICTED, or PUBLIC
           * with at-least-one `requiresAccess` distribution. Hidden
           * for admins. Status-aware: shows PENDING / APPROVED /
           * DENIED inline rather than just a "Request access" link
           * the user has to click to find out where they stand.
           */}
          <div className="mt-6 max-w-xl">
            <AccessCta
              detail={detail}
              ownRequests={ownRequests}
              isAuthenticated={!!session}
              isPrivilegedForDataset={isAdmin(session) || isHostOfDataset(session, detail.hostId)}
              justRequested={justRequested}
            />
            <CreateCampaignCta
              datasetSlug={detail.slug}
              authorized={canLaunchCampaignFromHere(detail, ownRequests, session)}
              isCampaignManager={isCampaignManager(session)}
            />
          </div>
        </Container>
      </Section>

      <Container size="xl">
        <Section spacing="md" className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>{t('about.title')}</CardTitle>
              <CardDescription>
                {t.rich('about.description', {
                  strong: (chunks) => <strong>{chunks}</strong>,
                  link: (chunks) => (
                    <Link
                      className="font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)]"
                      href={`/catalog/${detail.slug}/croissant`}
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ManifestTabs
                summary={
                  <div className="space-y-6">
                    <DefinitionList>
                      {conformsTo ? (
                        <DefinitionItem term={t('summary.conformsTo')} mono>
                          {conformsTo}
                        </DefinitionItem>
                      ) : null}
                      {license ? (
                        <DefinitionItem term={t('summary.license')}>
                          <span className="font-mono">{stringifyLicense(license)}</span>
                        </DefinitionItem>
                      ) : null}
                      {homepage ? (
                        <DefinitionItem term={t('summary.homepage')}>
                          <a
                            className="inline-flex items-center gap-1 text-[var(--color-primary)] underline underline-offset-2 break-all hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
                            href={String(homepage)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <span>{String(homepage)}</span>
                            <ExternalLinkIcon size={14} />
                          </a>
                        </DefinitionItem>
                      ) : null}
                      {keywords && keywords.length > 0 ? (
                        <DefinitionItem term={t('summary.keywords')}>
                          <span className="flex flex-wrap gap-1.5">
                            {keywords.map((k) => (
                              <Badge key={k} tone="neutral">
                                {k}
                              </Badge>
                            ))}
                          </span>
                        </DefinitionItem>
                      ) : null}
                      {modalityNames.length > 0 ? (
                        <DefinitionItem term={t('summary.modality')}>
                          <span className="flex flex-wrap gap-1.5">
                            {modalityNames.map((n) => (
                              <Badge key={n} tone="info">
                                {n}
                              </Badge>
                            ))}
                          </span>
                        </DefinitionItem>
                      ) : null}
                      {bodyRegionNames.length > 0 ? (
                        <DefinitionItem term={t('summary.bodyRegion')}>
                          <span className="flex flex-wrap gap-1.5">
                            {bodyRegionNames.map((n) => (
                              <Badge key={n} tone="info">
                                {n}
                              </Badge>
                            ))}
                          </span>
                        </DefinitionItem>
                      ) : null}
                      {diseaseNames.length > 0 ? (
                        <DefinitionItem term={t('summary.conditions')}>
                          <span className="flex flex-wrap gap-1.5">
                            {diseaseNames.map((n) => (
                              <Badge key={n} tone="warning">
                                {n}
                              </Badge>
                            ))}
                          </span>
                        </DefinitionItem>
                      ) : null}
                      {anonymization ? (
                        <DefinitionItem term={t('summary.anonymization')}>
                          <Badge tone={anonymization === 'IDENTIFIED' ? 'danger' : 'success'}>
                            {anonymization}
                          </Badge>
                        </DefinitionItem>
                      ) : null}
                      {/* Commercial-use disclosure (#119). Show the band
                        + any host-specified clauses verbatim so AI
                        builders can scan terms before investing in a
                        deployment. The badge in the header gives the
                        at-a-glance band; this shows the rationale. */}
                      <DefinitionItem term={t('summary.commercialUse')}>
                        <div className="space-y-1 text-sm">
                          <p className="font-medium">
                            {t(`commercial.${detail.commercialUseTerms}`)}
                          </p>
                          {detail.commercialClauses ? (
                            <p className="whitespace-pre-wrap text-[var(--color-muted-foreground)]">
                              {detail.commercialClauses}
                            </p>
                          ) : null}
                        </div>
                      </DefinitionItem>
                      {detail.duoTerms.length > 0 ? (
                        <DefinitionItem term={t('summary.permittedUse')}>
                          <ul className="space-y-1.5 text-sm">
                            {detail.duoTerms.map((id) => {
                              const term = lookupDuoTerm(id);
                              if (!term) {
                                return (
                                  <li key={id} className="font-mono text-xs">
                                    {id}
                                  </li>
                                );
                              }
                              return (
                                <li key={id} className="flex items-start gap-2">
                                  <Badge tone="info" className="font-mono">
                                    {term.code}
                                  </Badge>
                                  <span>
                                    <span className="font-medium">{term.label}.</span>{' '}
                                    <span className="text-[var(--color-muted-foreground)]">
                                      {term.summary}
                                    </span>
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </DefinitionItem>
                      ) : null}
                      {citeAs ? (
                        <DefinitionItem term={t('summary.citeAs')}>
                          <pre className="whitespace-pre-wrap break-words text-xs font-mono leading-relaxed text-[var(--color-foreground)]/85">
                            {String(citeAs)}
                          </pre>
                        </DefinitionItem>
                      ) : null}
                    </DefinitionList>
                    {/* bio-prov provenance (#496): rendered only when the
                      manifest carries something the profile recognises. */}
                    <ProvenanceCard manifest={detail.croissant} />
                  </div>
                }
                full={<ManifestFullView manifest={detail.croissant} />}
                raw={<JsonTree value={detail.croissant} />}
              />
            </CardContent>
          </Card>

          {dicomSeries && seriesList.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('imaging.title')}</CardTitle>
                <CardDescription>{t('imaging.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {heldImages > 0 ? (
                  <Alert tone="warning">
                    <AlertTitle as="h3">{t('imaging.heldTitle', { count: heldImages })}</AlertTitle>
                    <AlertDescription>
                      {t('imaging.heldBody')}
                      {isAdmin(session) ? (
                        <>
                          {' '}
                          {t.rich('imaging.reviewFindings', {
                            link: (chunks) => (
                              <Link
                                href={`/admin/dicom/${detail.slug}`}
                                className="font-medium underline underline-offset-2"
                              >
                                {chunks}
                              </Link>
                            ),
                          })}
                        </>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <ul className="space-y-2">
                  {seriesList.map((row, i) => (
                    <li
                      key={row.id}
                      className={
                        'flex flex-col gap-3 rounded-md p-3 sm:flex-row sm:items-center sm:justify-between' +
                        (i % 2 === 0 ? ' bg-[var(--color-subtle)]' : '')
                      }
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium text-[var(--color-foreground)]">
                          {row.title}
                        </p>
                        <p className="text-xs text-[var(--color-muted-foreground)]">{row.meta}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {row.held ? (
                          <Badge tone="warning">
                            {row.held === 'all'
                              ? t('imaging.heldAll')
                              : t('imaging.heldSome', { count: row.heldCount })}
                          </Badge>
                        ) : null}
                        <SeriesViewButton
                          slug={detail.slug}
                          seriesId={row.id}
                          title={row.title}
                          meta={row.meta}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                {dicomSeries.total > seriesList.length ? (
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {t('imaging.showingFirst', {
                      shown: f.number(seriesList.length),
                      total: f.number(dicomSeries.total),
                    })}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {detail.distributions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('files.title')}</CardTitle>
                <CardDescription>
                  {t.rich('files.description', { em: (chunks) => <em>{chunks}</em> })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Whole-dataset archive. Above the list because it's
                    the action most researchers want, and because the
                    counts it states are the frame for the list below. */}
                <BulkDownload
                  slug={detail.slug}
                  includedCount={bulk.includedCount}
                  gatedCount={bulk.gatedCount}
                  upstreamCount={bulk.upstreamCount}
                  totalCount={bulk.totalCount}
                  sizeLabel={bulk.knownBytes > 0 ? f.bytes(bulk.knownBytes) : null}
                  unknownSizeCount={bulk.unknownSizeCount}
                />

                <div className="space-y-2">
                  {detail.distributions.map((d, i) => {
                    const platformHosted = isPlatformHosted(d.contentUrl);
                    // `filename` is derived server-side from the storage
                    // key (or the upstream URL); `croissantId` is a bare
                    // UUID for anything uploaded through the platform, so
                    // it's the fallback, never the headline.
                    const label = d.filename ?? d.croissantId;
                    const meta = [
                      d.contentType,
                      d.contentSizeBytes !== null ? f.bytes(d.contentSizeBytes) : null,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(' · ');
                    return (
                      <div
                        key={d.id}
                        className={
                          'flex flex-col gap-3 rounded-md p-3 sm:flex-row sm:items-center sm:justify-between' +
                          (i % 2 === 0 ? ' bg-[var(--color-subtle)]' : '')
                        }
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="font-mono text-sm font-medium break-all text-[var(--color-foreground)]">
                            {label}
                          </p>
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {d.contentType}
                            {d.contentSizeBytes !== null
                              ? ` · ${f.bytes(d.contentSizeBytes)}`
                              : null}
                            {d.contentHash ? (
                              <>
                                {' · '}
                                <span className="font-mono">
                                  sha256:{d.contentHash.slice(0, 12)}…
                                </span>
                              </>
                            ) : null}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {d.requiresAccess ? (
                            <Badge tone="warning">{t('files.requiresAccess')}</Badge>
                          ) : platformHosted ? (
                            <>
                              <Badge tone="success">{t('files.hosted')}</Badge>
                              {isPreviewableImage(d) ? (
                                <ImagePreviewButton
                                  filename={label}
                                  src={`/catalog/${detail.slug}/distributions/${d.id}/download`}
                                  meta={meta}
                                />
                              ) : null}
                              <a
                                href={`/catalog/${detail.slug}/distributions/${d.id}/download`}
                                aria-label={t('files.downloadAria', { file: label })}
                                className="inline-flex min-h-11 items-center gap-1 rounded px-1 text-sm font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] sm:min-h-0"
                              >
                                <span>{t('files.download')}</span>
                              </a>
                            </>
                          ) : d.contentUrl ? (
                            <>
                              <Badge tone="neutral">{t('files.upstream')}</Badge>
                              <a
                                href={d.contentUrl}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t('files.openAria', { file: label })}
                                className="inline-flex min-h-11 items-center gap-1 rounded px-1 text-sm font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] sm:min-h-0"
                              >
                                <span>{t('files.open')}</span>
                                <ExternalLinkIcon size={14} />
                              </a>
                            </>
                          ) : (
                            <Badge tone="neutral">{t('files.noUrl')}</Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {detail.versions.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('versions.title')}</CardTitle>
                <CardDescription>{t('versions.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="divide-y divide-[var(--color-border)] text-sm">
                  {detail.versions.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                    >
                      <span className="font-mono text-[var(--color-foreground)]">v{v.version}</span>
                      <time
                        dateTime={v.publishedAt}
                        className="text-xs text-[var(--color-muted-foreground)]"
                      >
                        {f.date(v.publishedAt)}
                      </time>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}

          <Separator />

          <p className="text-center text-xs text-[var(--color-muted-foreground)]">
            {t.rich('footer', {
              link: (chunks) => (
                <Link href="/catalog" className="underline hover:text-[var(--color-foreground)]">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </Section>
      </Container>
    </>
  );
}

function normalizeStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        typeof v === 'string'
          ? v
          : v && typeof v === 'object' && 'name' in v
            ? String((v as { name?: string }).name ?? '')
            : '',
      )
      .filter((s): s is string => s.length > 0);
  }
  return [];
}

function extractTermNames(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  return arr
    .map((v) => {
      if (v && typeof v === 'object') {
        const obj = v as { name?: unknown; termCode?: unknown };
        if (typeof obj.name === 'string') return obj.name;
        if (typeof obj.termCode === 'string') return obj.termCode;
      }
      return '';
    })
    .filter((s): s is string => s.length > 0);
}

function stringifyLicense(license: unknown): string {
  if (typeof license === 'string') return license;
  if (Array.isArray(license)) return license.map(stringifyLicense).join(', ');
  if (license && typeof license === 'object' && 'name' in license) {
    return String((license as { name?: string }).name ?? '');
  }
  return JSON.stringify(license);
}

/**
 * Whether the caller has the right to launch an annotation campaign
 * from this dataset detail page (user feedback 2026-05-16):
 *
 *   - admin: always
 *   - host of this dataset: always (their data, their call)
 *   - PUBLIC dataset + authenticated viewer: always
 *   - RESTRICTED or PRIVATE dataset: the caller must hold an
 *     APPROVED access-request row.
 *
 * The role check ("is the caller a campaign-manager?") lives on the
 * component itself; this helper only decides the data-side gate.
 */
function canLaunchCampaignFromHere(
  detail: DatasetDetail,
  ownRequests: AccessRequestSummary[],
  session: import('next-auth').Session | null,
): boolean {
  if (!session) return false;
  if (isAdmin(session) || isHostOfDataset(session, detail.hostId)) return true;
  if (detail.visibility === 'PUBLIC') return true;
  // For RESTRICTED / PRIVATE: must have an APPROVED row.
  return ownRequests.some((r) => r.status === 'APPROVED');
}

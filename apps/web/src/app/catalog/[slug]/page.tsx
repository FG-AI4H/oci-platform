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
  ExternalLinkIcon,
  Section,
  Separator,
  ShieldIcon,
} from '@oci/ui';
import type { AccessRequestSummary, DatasetDetail, DatasetVisibility } from '@oci/shared-types';
import { lookupDuoTerm } from '@oci/croissant';
import { auth } from '../../../auth';
import { apiFetch } from '../../../lib/api';
import { datasetJsonLd } from '../../../lib/dataset-jsonld';
import { siteUrl } from '../../../lib/site-url';
import { isAdmin } from '../../../lib/groups';
import { isHostOfDataset } from '../../../lib/identity';
import { AccessCta } from './access-cta';
import { JsonTree } from './json-tree';
import { ManifestFullView } from './manifest-full-view';
import { ManifestTabs } from './manifest-tabs';

const visibilityTone: Record<DatasetVisibility, 'success' | 'info' | 'warning'> = {
  PUBLIC: 'success',
  RESTRICTED: 'warning',
  PRIVATE: 'info',
};

const visibilityCopy: Record<DatasetVisibility, string> = {
  PUBLIC: 'Listed and crawlable',
  RESTRICTED: 'Access on request',
  PRIVATE: 'Hosts and admins only',
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

const PUBLISH_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `${slug} — OCI Catalog` };
}

export default async function DatasetDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();

  let detail: DatasetDetail | null = null;
  let error: string | null = null;
  let ownRequests: AccessRequestSummary[] = [];
  try {
    detail = await apiFetch<DatasetDetail>(`/v2/catalog/datasets/${encodeURIComponent(slug)}`, {
      session,
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
    error = err instanceof Error ? err.message : 'Unable to reach catalog API';
  }

  if (error) {
    return (
      <Container size="md">
        <Section spacing="md">
          <Alert tone="danger">
            <AlertTitle>Catalog unavailable</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        </Section>
      </Container>
    );
  }

  if (!detail) notFound();

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
            <span>Catalog</span>
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
              <Badge tone={visibilityTone[detail.visibility]}>
                {detail.visibility.toLowerCase()}
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
              <span>{visibilityCopy[detail.visibility]}</span>
            </p>
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
            />
          </div>
        </Container>
      </Section>

      <Container size="xl">
        <Section spacing="md" className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Manifest</CardTitle>
              <CardDescription>
                Croissant {detail.conformanceVersion ?? ''} manifest. <strong>Summary</strong> shows
                the curated highlights; <strong>Full manifest</strong> renders every populated field
                grouped by namespace; <strong>Raw JSON</strong> is the collapsible tree. Standalone
                JSON-LD:{' '}
                <Link
                  className="font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)]"
                  href={`/catalog/${detail.slug}/croissant`}
                >
                  download
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ManifestTabs
                summary={
                  <DefinitionList>
                    {conformsTo ? (
                      <DefinitionItem term="Conforms to" mono>
                        {conformsTo}
                      </DefinitionItem>
                    ) : null}
                    {license ? (
                      <DefinitionItem term="License">
                        <span className="font-mono">{stringifyLicense(license)}</span>
                      </DefinitionItem>
                    ) : null}
                    {homepage ? (
                      <DefinitionItem term="Homepage">
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
                      <DefinitionItem term="Keywords">
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
                      <DefinitionItem term="Modality">
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
                      <DefinitionItem term="Body region">
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
                      <DefinitionItem term="Conditions">
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
                      <DefinitionItem term="Anonymization">
                        <Badge tone={anonymization === 'IDENTIFIED' ? 'danger' : 'success'}>
                          {anonymization}
                        </Badge>
                      </DefinitionItem>
                    ) : null}
                    {detail.duoTerms.length > 0 ? (
                      <DefinitionItem term="Permitted use (DUO)">
                        <ul className="space-y-1.5 text-sm">
                          {detail.duoTerms.map((id) => {
                            const t = lookupDuoTerm(id);
                            if (!t) {
                              return (
                                <li key={id} className="font-mono text-xs">
                                  {id}
                                </li>
                              );
                            }
                            return (
                              <li key={id} className="flex items-start gap-2">
                                <Badge tone="info" className="font-mono">
                                  {t.code}
                                </Badge>
                                <span>
                                  <span className="font-medium">{t.label}.</span>{' '}
                                  <span className="text-[var(--color-muted-foreground)]">
                                    {t.summary}
                                  </span>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </DefinitionItem>
                    ) : null}
                    {citeAs ? (
                      <DefinitionItem term="Cite as">
                        <pre className="whitespace-pre-wrap break-words text-xs font-mono leading-relaxed text-[var(--color-foreground)]/85">
                          {String(citeAs)}
                        </pre>
                      </DefinitionItem>
                    ) : null}
                  </DefinitionList>
                }
                full={<ManifestFullView manifest={detail.croissant} />}
                raw={<JsonTree value={detail.croissant} />}
              />
            </CardContent>
          </Card>

          {detail.distributions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Distributions</CardTitle>
                <CardDescription>
                  Files in the latest version. <em>Platform-hosted</em> entries stream from our S3
                  via short-lived presigned URLs — the link below goes through the access gate.{' '}
                  <em>Upstream</em> entries point at the original host (e.g. Grand Challenge) and
                  the platform references rather than mirrors them.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {detail.distributions.map((d, i) => {
                  const platformHosted = isPlatformHosted(d.contentUrl);
                  return (
                    <div
                      key={d.id}
                      className={
                        'flex flex-col gap-3 rounded-md p-3 sm:flex-row sm:items-center sm:justify-between' +
                        (i % 2 === 0 ? ' bg-[var(--color-subtle)]' : '')
                      }
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium font-mono text-sm break-words">{d.croissantId}</p>
                        <p className="text-xs text-[var(--color-muted-foreground)]">
                          {d.contentType}
                          {d.contentSizeBytes !== null
                            ? ` · ${formatBytes(d.contentSizeBytes)}`
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
                          <Badge tone="warning">requires access</Badge>
                        ) : platformHosted ? (
                          <>
                            <Badge tone="success">hosted</Badge>
                            <a
                              href={`/catalog/${detail.slug}/distributions/${d.id}/download`}
                              aria-label={`Download ${d.croissantId} from platform storage`}
                              className="inline-flex items-center gap-1 rounded text-sm font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
                            >
                              <span>download</span>
                            </a>
                          </>
                        ) : d.contentUrl ? (
                          <>
                            <Badge tone="neutral">upstream</Badge>
                            <a
                              href={d.contentUrl}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open ${d.croissantId} on upstream host (opens in new tab)`}
                              className="inline-flex items-center gap-1 rounded text-sm font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
                            >
                              <span>open</span>
                              <ExternalLinkIcon size={14} />
                            </a>
                          </>
                        ) : (
                          <Badge tone="neutral">no url</Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          {detail.versions.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>Version history</CardTitle>
                <CardDescription>
                  Each published version is immutable — manifest hashes anchor downstream evaluation
                  reports.
                </CardDescription>
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
                        {PUBLISH_DATE_FORMATTER.format(new Date(v.publishedAt))}
                      </time>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}

          <Separator />

          <p className="text-center text-xs text-[var(--color-muted-foreground)]">
            Manifest mirrored from upstream host.{' '}
            <Link href="/catalog" className="underline hover:text-[var(--color-foreground)]">
              Back to catalog
            </Link>
            .
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * Platform-hosted distributions get a relative `contentUrl` of
 * `/v2/catalog/datasets/<slug>/distributions/<id>/download` (set by
 * StorageService.completeUpload). Upstream URLs are absolute. The gate
 * is the relative-path discriminator, not a parse — keeps the contract
 * cheap on both halves.
 */
function isPlatformHosted(contentUrl: string | null): boolean {
  if (!contentUrl) return false;
  return contentUrl.startsWith('/v2/catalog/');
}

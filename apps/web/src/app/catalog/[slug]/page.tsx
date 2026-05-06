import Link from 'next/link';
import { notFound } from 'next/navigation';
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
  DefinitionItem,
  DefinitionList,
} from '@oci/ui';
import type { DatasetDetail, DatasetVisibility } from '@oci/shared-types';
import { auth } from '../../../auth';
import { apiFetch } from '../../../lib/api';
import { datasetJsonLd } from '../../../lib/dataset-jsonld';
import { siteUrl } from '../../../lib/site-url';

const visibilityTone: Record<DatasetVisibility, 'success' | 'info' | 'warning'> = {
  PUBLIC: 'success',
  RESTRICTED: 'warning',
  PRIVATE: 'info',
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

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `${slug} — OCI Catalog` };
}

export default async function DatasetDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();

  let detail: DatasetDetail | null = null;
  let error: string | null = null;
  try {
    detail = await apiFetch<DatasetDetail>(`/v2/catalog/datasets/${encodeURIComponent(slug)}`, {
      session,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach catalog API';
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Alert tone="danger">
          <AlertTitle>Catalog unavailable</AlertTitle>
          <AlertDescription>
            <pre className="mt-1 whitespace-pre-wrap text-xs font-mono">{error}</pre>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!detail) {
    notFound();
  }

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
  // that are actually crawlable: PUBLIC + PUBLISHED. RESTRICTED and
  // PRIVATE rows are 404 to anonymous callers anyway (catalog.service.ts
  // filters them out), but skipping the script tag is the belt-and-braces
  // version — it also dodges accidentally leaking RESTRICTED metadata
  // into the HTML body when a signed-in user shares the page URL.
  const indexable = detail.visibility === 'PUBLIC' && detail.status === 'PUBLISHED';
  const jsonLd = indexable ? datasetJsonLd(detail, siteUrl()) : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-12 space-y-8">
      {jsonLd ? (
        <script
          type="application/ld+json"
          // JSON.stringify is the safe way to embed JSON in HTML — it
          // escapes the only sequence that would break out of a script
          // element ("</") via Unicode escape.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
          }}
        />
      ) : null}
      <header className="space-y-3">
        <Link
          href="/catalog"
          className="text-sm text-[var(--color-muted-foreground)] hover:underline"
        >
          ← Catalog
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{detail.name}</h1>
            <p className="mt-1 text-sm font-mono text-[var(--color-muted-foreground)]">
              {detail.slug}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge tone={visibilityTone[detail.visibility]}>
              {detail.visibility.toLowerCase()}
            </Badge>
            {detail.latestVersion ? <Badge tone="primary">v{detail.latestVersion}</Badge> : null}
            {detail.conformanceVersion ? (
              <Badge tone="accent">Croissant {detail.conformanceVersion}</Badge>
            ) : null}
          </div>
        </div>
        {detail.description ? (
          <p className="text-[var(--color-foreground)]">{detail.description}</p>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Manifest</CardTitle>
          <CardDescription>
            Selected fields from the Croissant {detail.conformanceVersion ?? ''} manifest. Full
            JSON-LD:{' '}
            <Link className="underline" href={`/catalog/${detail.slug}/croissant`}>
              download
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                <a className="underline" href={String(homepage)} target="_blank" rel="noreferrer">
                  {String(homepage)}
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
            {citeAs ? (
              <DefinitionItem term="Cite as">
                <pre className="whitespace-pre-wrap text-xs font-mono">{String(citeAs)}</pre>
              </DefinitionItem>
            ) : null}
          </DefinitionList>
        </CardContent>
      </Card>

      {detail.distributions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Distributions</CardTitle>
            <CardDescription>
              Files in the latest version. Links labelled <em>upstream</em> point at the original
              host (e.g. Grand Challenge) — the platform references rather than mirrors them.
              S3-mirrored bytes with pre-signed URLs land in PR C; restricted entries will go
              through an access request flow at the same time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {detail.distributions.map((d) => (
              <div
                key={d.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border border-[var(--color-border)] p-3"
              >
                <div className="space-y-1">
                  <p className="font-medium font-mono text-sm">{d.croissantId}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {d.contentType}
                    {d.contentSizeBytes !== null ? ` · ${formatBytes(d.contentSizeBytes)}` : null}
                    {d.contentHash ? (
                      <>
                        {' · '}
                        <span className="font-mono">sha256:{d.contentHash.slice(0, 12)}…</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {d.requiresAccess ? (
                    <Badge tone="warning">requires access</Badge>
                  ) : d.contentUrl ? (
                    <>
                      <Badge tone="neutral">upstream</Badge>
                      <a
                        href={d.contentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                      >
                        open ↗
                      </a>
                    </>
                  ) : (
                    <Badge tone="neutral">no url</Badge>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {detail.versions.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Version history</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {detail.versions.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between border-t border-[var(--color-border)] py-2 first:border-t-0 first:pt-0"
                >
                  <span className="font-mono">v{v.version}</span>
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    {new Date(v.publishedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
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

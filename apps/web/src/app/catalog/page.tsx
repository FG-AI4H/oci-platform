import Link from 'next/link';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Container,
  DatabaseIcon,
  Input,
  SearchIcon,
  Section,
} from '@oci/ui';
import type {
  DatasetSource,
  DatasetSummary,
  DatasetVisibility,
  ListDatasetsResponse,
} from '@oci/shared-types';
import { auth } from '../../auth';
import { apiFetch } from '../../lib/api';

interface SearchParams {
  q?: string;
  cursor?: string;
  source?: string;
}

const SOURCE_OPTIONS: ReadonlyArray<{ value: DatasetSource; label: string; hint: string }> = [
  { value: 'local', label: 'Local', hint: 'Datasets published on this platform.' },
  {
    value: 'federated',
    label: 'Federated',
    hint: 'Mirrors of datasets harvested from peer catalogues.',
  },
  { value: 'all', label: 'All', hint: 'Everything — local first, federated to fill the page.' },
];

function normaliseSource(value: string | undefined): DatasetSource {
  return value === 'federated' || value === 'all' ? value : 'local';
}

const visibilityTone: Record<DatasetVisibility, 'success' | 'info' | 'warning'> = {
  PUBLIC: 'success',
  RESTRICTED: 'warning',
  PRIVATE: 'info',
};

const visibilityAccent: Record<DatasetVisibility, 'success' | 'warning' | 'info'> = {
  PUBLIC: 'success',
  RESTRICTED: 'warning',
  PRIVATE: 'info',
};

const visibilityLabel: Record<DatasetVisibility, string> = {
  PUBLIC: 'public',
  RESTRICTED: 'restricted',
  PRIVATE: 'private',
};

export const metadata = {
  title: 'Catalog — OCI Platform',
  description:
    'Discover datasets curated under the GI-AI4H Topic Groups, with provenance and consent tracked end-to-end.',
};

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await auth();
  const source = normaliseSource(params.source);

  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.cursor) qs.set('cursor', params.cursor);
  qs.set('source', source);
  qs.set('limit', '24');

  let response: ListDatasetsResponse | null = null;
  let error: string | null = null;
  try {
    response = await apiFetch<ListDatasetsResponse>(`/v2/catalog/datasets?${qs.toString()}`, {
      session,
      // Disable Next.js data-cache for the list. With the federated
      // path (PR E.2) a freshly-harvested row should appear on the
      // very next page render — a 30s revalidation window made the
      // E2E suite race against it. Cache hit-rate on this endpoint
      // is anyway low (each visitor's auth → visibility filter
      // diverges), so there's little value in caching.
      revalidate: 0,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach catalog API';
  }

  return (
    <Container>
      <Section spacing="md">
        <header className="mb-8 flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Catalog
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Datasets</h1>
            {response ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                <span className="text-[var(--color-foreground)] font-medium tabular-nums">
                  {response.totalEstimate.toLocaleString('en-GB')}
                </span>{' '}
                {response.totalEstimate === 1 ? 'dataset' : 'datasets'}
                {params.q ? (
                  <>
                    {' matching '}
                    <span className="text-[var(--color-foreground)]">&ldquo;{params.q}&rdquo;</span>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <p className="max-w-2xl text-[var(--color-muted-foreground)]">
            Browse the GI-AI4H curated catalogue. Each dataset ships a Croissant 1.1 manifest with
            RAI + BIOCroissant health metadata; restricted rows require approval before download.
          </p>
        </header>

        <form action="/catalog" method="get" role="search" className="mb-4 flex gap-2">
          <label htmlFor="catalog-search" className="sr-only">
            Search datasets
          </label>
          <Input
            id="catalog-search"
            type="search"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Search by name, slug, or description"
            leadingIcon={<SearchIcon size={16} />}
            className="flex-1"
          />
          {/* Preserve the source filter on free-text search submission. */}
          <input type="hidden" name="source" value={source} />
          <Button type="submit">Search</Button>
        </form>

        <SourceChips active={source} q={params.q} />

        {error ? (
          <Alert tone="danger">
            <AlertTitle>Catalog unavailable</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        ) : !response || response.items.length === 0 ? (
          <EmptyState query={params.q} />
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {response.items.map((d) => (
                <li key={d.id}>
                  <DatasetCard d={d} />
                </li>
              ))}
            </ul>

            {response.nextCursor ? (
              <div className="mt-10 flex justify-center">
                <Button asChild variant="outline">
                  <Link
                    href={`/catalog?${new URLSearchParams({
                      ...(params.q ? { q: params.q } : {}),
                      ...(source !== 'local' ? { source } : {}),
                      cursor: response.nextCursor,
                    }).toString()}`}
                  >
                    Load more datasets
                  </Link>
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Section>
    </Container>
  );
}

function DatasetCard({ d }: { d: DatasetSummary }) {
  // Federated rows aren't addressable as `/catalog/<slug>` (slugs may
  // collide across peers); deep-link directly to the upstream `@id`.
  // Open in a new tab so the user keeps their place in our catalog.
  const isFederated = d.sourceCatalog !== null;
  const href = isFederated ? (d.originUrl ?? '#') : `/catalog/${d.slug}`;
  const linkProps = isFederated
    ? ({ target: '_blank', rel: 'noreferrer noopener' } as const)
    : ({} as const);

  return (
    <Link
      href={href}
      {...linkProps}
      aria-label={
        isFederated
          ? `${d.name} — opens upstream on ${d.sourceCatalog?.name} in a new tab`
          : undefined
      }
      className="group block h-full rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
    >
      <Card accent={visibilityAccent[d.visibility]} interactive="hover" className="h-full">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="line-clamp-2 group-hover:text-[var(--color-primary)] transition-colors">
              {d.name}
            </CardTitle>
            {isFederated ? (
              <Badge tone="accent">federated</Badge>
            ) : (
              <Badge tone={visibilityTone[d.visibility]}>{visibilityLabel[d.visibility]}</Badge>
            )}
          </div>
          <CardDescription className="line-clamp-3 min-h-[3.5rem]">
            {d.description ?? <em>No description provided.</em>}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-muted-foreground)]">
          <span className="font-mono truncate">{d.slug}</span>
          {isFederated ? (
            <Badge tone="neutral">from {d.sourceCatalog?.name}</Badge>
          ) : d.latestVersion ? (
            <Badge tone="primary">v{d.latestVersion}</Badge>
          ) : (
            <Badge tone="neutral">no version</Badge>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * Source-filter chips for the catalog list. Server component — each
 * chip is just a styled `Link` that re-issues the GET with a
 * different `?source=`. We preserve the active free-text search but
 * intentionally drop the cursor (paginating into a different scope
 * with the wrong cursor would be undefined).
 */
function SourceChips({ active, q }: { active: DatasetSource; q?: string }) {
  return (
    <nav aria-label="Source filter" className="mb-8 flex flex-wrap gap-2">
      {SOURCE_OPTIONS.map((opt) => {
        const isActive = opt.value === active;
        const qs = new URLSearchParams();
        if (q) qs.set('q', q);
        if (opt.value !== 'local') qs.set('source', opt.value);
        const href = qs.toString().length > 0 ? `/catalog?${qs.toString()}` : '/catalog';
        return (
          <Link
            key={opt.value}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            title={opt.hint}
            className={
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
              (isActive
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]/40 text-[var(--color-foreground)]'
                : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]')
            }
          >
            {opt.label}
          </Link>
        );
      })}
    </nav>
  );
}

function EmptyState({ query }: { query?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-12 text-center">
      <span
        className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-[var(--shadow-xs)]"
        aria-hidden="true"
      >
        <DatabaseIcon size={20} />
      </span>
      <h2 className="mt-4 text-lg font-semibold">{query ? 'No matches yet' : 'No datasets yet'}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-muted-foreground)]">
        {query ? (
          <>
            We couldn&apos;t find anything for{' '}
            <strong className="text-[var(--color-foreground)]">&ldquo;{query}&rdquo;</strong>. Try a
            broader search, or browse the full catalogue.
          </>
        ) : (
          <>
            The catalogue is empty on this environment. Once hosts publish the first Croissant 1.1
            manifests, they will appear here.
          </>
        )}
      </p>
      {query ? (
        <div className="mt-5">
          <Button asChild variant="outline" size="sm">
            <Link href="/catalog">Clear search</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

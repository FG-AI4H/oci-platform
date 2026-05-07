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
import type { DatasetSummary, DatasetVisibility, ListDatasetsResponse } from '@oci/shared-types';
import { auth } from '../../auth';
import { apiFetch } from '../../lib/api';

interface SearchParams {
  q?: string;
  cursor?: string;
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

  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.cursor) qs.set('cursor', params.cursor);
  qs.set('limit', '24');

  let response: ListDatasetsResponse | null = null;
  let error: string | null = null;
  try {
    response = await apiFetch<ListDatasetsResponse>(`/v2/catalog/datasets?${qs.toString()}`, {
      session,
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

        <form action="/catalog" method="get" role="search" className="mb-8 flex gap-2">
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
          <Button type="submit">Search</Button>
        </form>

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
  return (
    <Link
      href={`/catalog/${d.slug}`}
      className="group block h-full rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
    >
      <Card accent={visibilityAccent[d.visibility]} interactive="hover" className="h-full">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="line-clamp-2 group-hover:text-[var(--color-primary)] transition-colors">
              {d.name}
            </CardTitle>
            <Badge tone={visibilityTone[d.visibility]}>{visibilityLabel[d.visibility]}</Badge>
          </div>
          <CardDescription className="line-clamp-3 min-h-[3.5rem]">
            {d.description ?? <em>No description provided.</em>}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-muted-foreground)]">
          <span className="font-mono truncate">{d.slug}</span>
          {d.latestVersion ? (
            <Badge tone="primary">v{d.latestVersion}</Badge>
          ) : (
            <Badge tone="neutral">no version</Badge>
          )}
        </CardContent>
      </Card>
    </Link>
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

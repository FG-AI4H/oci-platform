import Link from 'next/link';
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
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-12 space-y-8">
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Catalog
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Datasets</h1>
        <p className="text-[var(--color-muted-foreground)]">
          Browse the GI-AI4H curated catalogue. Each dataset ships a Croissant 1.1 manifest with RAI
          + BIOCroissant health metadata; restricted rows require approval before download.
        </p>
      </header>

      <form action="/catalog" method="get" className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Search by name, slug, or description"
          className="flex-1 h-10 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        />
        <button
          type="submit"
          className="h-10 px-4 rounded-md bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-sm font-medium shadow-[var(--shadow-sm)] hover:bg-[var(--color-primary-hover)]"
        >
          Search
        </button>
      </form>

      {error ? (
        <Alert tone="danger">
          <AlertTitle>Catalog unavailable</AlertTitle>
          <AlertDescription>
            <pre className="mt-1 whitespace-pre-wrap text-xs font-mono">{error}</pre>
          </AlertDescription>
        </Alert>
      ) : !response || response.items.length === 0 ? (
        <EmptyState query={params.q} />
      ) : (
        <>
          <div className="flex items-center justify-between text-sm text-[var(--color-muted-foreground)]">
            <span>
              {response.totalEstimate} dataset{response.totalEstimate === 1 ? '' : 's'}
              {params.q ? <> matching &ldquo;{params.q}&rdquo;</> : null}
            </span>
          </div>

          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {response.items.map((d) => (
              <li key={d.id}>
                <DatasetCard d={d} />
              </li>
            ))}
          </ul>

          {response.nextCursor ? (
            <div className="flex justify-center pt-2">
              <Link
                href={`/catalog?${new URLSearchParams({
                  ...(params.q ? { q: params.q } : {}),
                  cursor: response.nextCursor,
                }).toString()}`}
                className="text-sm font-medium text-[var(--color-primary)] hover:underline"
              >
                Next page →
              </Link>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function DatasetCard({ d }: { d: DatasetSummary }) {
  return (
    <Link href={`/catalog/${d.slug}`} className="block group">
      <Card className="h-full transition-shadow group-hover:shadow-[var(--shadow-md)]">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="line-clamp-2">{d.name}</CardTitle>
            <Badge tone={visibilityTone[d.visibility]}>{d.visibility.toLowerCase()}</Badge>
          </div>
          <CardDescription className="line-clamp-3">
            {d.description ?? <em>No description.</em>}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-2 text-xs text-[var(--color-muted-foreground)]">
          <span className="font-mono">{d.slug}</span>
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
    <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-subtle)] p-12 text-center">
      <h2 className="text-lg font-semibold">No datasets yet</h2>
      <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
        {query ? (
          <>
            No matches for <strong>&ldquo;{query}&rdquo;</strong>. Try a broader search, or browse
            the full catalogue.
          </>
        ) : (
          <>
            The catalogue is empty on this environment. Once hosts publish the first
            Croissant&nbsp;1.1 manifests, they will appear here.
          </>
        )}
      </p>
    </div>
  );
}

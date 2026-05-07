import Link from 'next/link';
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
  Section,
} from '@oci/ui';
import type { HarvestStatus, RemoteCatalogSummary } from '@oci/shared-types';
import { auth } from '../../../auth';
import { apiFetch } from '../../../lib/api';
import { requireAdmin } from '../../../lib/groups';

export const metadata = {
  title: 'Remote catalogues — OCI Platform',
  // Operational admin surface — never indexed.
  robots: { index: false, follow: false },
};

interface ListResponse {
  items: RemoteCatalogSummary[];
  totalEstimate: number;
}

const harvestTone: Record<HarvestStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  IDLE: 'neutral',
  RUNNING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'danger',
};

const PUBLISH_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

export default async function RemoteCatalogsPage() {
  const session = await auth();
  requireAdmin(session);

  let data: ListResponse | null = null;
  let error: string | null = null;
  try {
    data = await apiFetch<ListResponse>('/v2/catalog/remotes', { session, revalidate: 0 });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach catalog API';
  }

  return (
    <Container size="lg">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href="/catalog"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>Catalog</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Federation
          </p>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                Remote catalogues
              </h1>
              <p className="mt-2 max-w-prose text-[var(--color-muted-foreground)]">
                Peer Croissant catalogues we federate from. The harvest worker (Phase&nbsp;E,
                landing in&nbsp;PR&nbsp;E.3) reads this list, pulls each peer&apos;s{' '}
                <code className="font-mono text-xs">.well-known/croissant-catalog.json</code>, and
                mirrors the public datasets it finds.
              </p>
            </div>
            <Link href="/catalog/remotes/new">
              <Button>Register peer</Button>
            </Link>
          </div>
        </header>

        {error ? (
          <Alert tone="danger">
            <AlertTitle>Catalog unavailable</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        ) : !data || data.items.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-3">
            {data.items.map((remote) => (
              <li key={remote.id}>
                <RemoteCard remote={remote} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Container>
  );
}

function RemoteCard({ remote }: { remote: RemoteCatalogSummary }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle>
              <Link
                className="hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
                href={`/catalog/remotes/${remote.id}`}
              >
                {remote.name}
              </Link>
            </CardTitle>
            <CardDescription>
              <span className="font-mono text-xs">{remote.slug}</span>
              {' · '}
              <span className="break-all text-xs">{remote.endpointUrl}</span>
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge tone={harvestTone[remote.harvestStatus]}>
              {remote.harvestStatus.toLowerCase()}
            </Badge>
            <span className="text-xs text-[var(--color-muted-foreground)]">
              {remote.lastHarvestedAt ? (
                <>
                  Last harvest&nbsp;
                  <time dateTime={remote.lastHarvestedAt}>
                    {PUBLISH_DATE_FORMATTER.format(new Date(remote.lastHarvestedAt))}
                  </time>
                </>
              ) : (
                'Never harvested'
              )}
            </span>
          </div>
        </div>
      </CardHeader>
      {remote.lastError ? (
        <CardContent>
          <p className="text-xs text-[var(--color-danger)]">{remote.lastError}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

function EmptyState() {
  return (
    <Card tone="subtle">
      <CardHeader>
        <CardTitle>No peer catalogues yet</CardTitle>
        <CardDescription>
          Register the first peer to start federating. Until at least one peer is registered and PR
          E.3&apos;s worker is running, the catalog only shows local datasets.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/catalog/remotes/new">
          <Button>Register peer</Button>
        </Link>
      </CardContent>
    </Card>
  );
}

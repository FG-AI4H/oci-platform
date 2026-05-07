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
  Section,
} from '@oci/ui';
import type { HarvestStatus, RemoteCatalogDetail } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { apiFetch } from '../../../../lib/api';
import { requireAdmin } from '../../../../lib/groups';
import { DeleteRemoteButton } from './delete-button';

export const metadata = {
  title: 'Remote catalogue — OCI Platform',
  robots: { index: false, follow: false },
};

const harvestTone: Record<HarvestStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  IDLE: 'neutral',
  RUNNING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'danger',
};

const PUBLISH_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RemoteCatalogDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await auth();
  requireAdmin(session);

  let detail: RemoteCatalogDetail | null = null;
  let error: string | null = null;
  try {
    detail = await apiFetch<RemoteCatalogDetail>(`/v2/catalog/remotes/${encodeURIComponent(id)}`, {
      session,
      revalidate: 0,
    });
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

  return (
    <Container size="lg">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href="/catalog/remotes"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>Remote catalogues</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Federation
          </p>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs text-[var(--color-muted-foreground)]">
                {detail.slug}
              </p>
              <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight">
                {detail.name}
              </h1>
              {detail.description ? (
                <p className="mt-3 max-w-2xl text-[var(--color-muted-foreground)]">
                  {detail.description}
                </p>
              ) : null}
            </div>
            <Badge tone={harvestTone[detail.harvestStatus]}>
              {detail.harvestStatus.toLowerCase()}
            </Badge>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term="Endpoint">
                  <span className="break-all font-mono text-xs">{detail.endpointUrl}</span>
                </DefinitionItem>
                <DefinitionItem term="Last harvest">
                  {detail.lastHarvestedAt ? (
                    <time dateTime={detail.lastHarvestedAt}>
                      {PUBLISH_DATE_FORMATTER.format(new Date(detail.lastHarvestedAt))}
                    </time>
                  ) : (
                    <span className="text-[var(--color-muted-foreground)]">Never</span>
                  )}
                </DefinitionItem>
                <DefinitionItem term="Registered">
                  <time dateTime={detail.createdAt}>
                    {PUBLISH_DATE_FORMATTER.format(new Date(detail.createdAt))}
                  </time>
                </DefinitionItem>
                {detail.lastError ? (
                  <DefinitionItem term="Last error">
                    <pre className="whitespace-pre-wrap break-words text-xs font-mono text-[var(--color-danger)]">
                      {detail.lastError}
                    </pre>
                  </DefinitionItem>
                ) : null}
              </DefinitionList>
            </CardContent>
          </Card>

          <Card tone="subtle" className="h-fit">
            <CardHeader>
              <CardTitle>Danger zone</CardTitle>
              <CardDescription>
                Removing the peer stops future harvests. Already-harvested datasets stay in the
                catalog (PR&nbsp;E.2 introduces the source filter; PR&nbsp;E.3 the worker that
                writes those rows).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DeleteRemoteButton id={detail.id} />
            </CardContent>
          </Card>
        </div>
      </Section>
    </Container>
  );
}

import Link from 'next/link';
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
  Section,
  ShieldIcon,
} from '@oci/ui';
import type { EvaluationRouteResponse } from '@oci/shared-types';
import { apiFetch } from '../../../lib/api';
import { ReviewStatusBadge } from '../../../components/evaluation/review-status-badge';
import {
  attributionForVersion,
  describeMode,
  describeProvider,
  latestVersion,
} from '../../../components/evaluation/route-labels';

/**
 * Evaluation methods list (#487, WP5 / ADR-0018). Read-only, anonymous:
 * `GET /v2/evaluation/routes` is public and returns every route with its
 * versions and their three declarations, so there is no session to thread
 * through and nothing to role-gate.
 *
 * The specification calls an evaluation method a *route*. The page says
 * "evaluation method" everywhere a reader sees it and mentions the
 * specification's word once, in the lede, so the API paths and the task
 * page's `route@version` attribution still make sense.
 *
 * The list endpoint already carries the full versions array, so the latest
 * version and its review status are read straight off the list DTO rather
 * than fanning out one detail fetch per card.
 */

export const metadata = {
  title: 'Evaluation methods — OCI Platform',
  description:
    'The evaluation methods registered on the OCI Platform. Every result names the method and version that produced it; a method version is reviewed before its results are published.',
};

export default async function EvaluationRoutesPage() {
  let routes: EvaluationRouteResponse[] | null = null;
  let error: string | null = null;
  try {
    routes = await apiFetch<EvaluationRouteResponse[]>('/v2/evaluation/routes', {
      revalidate: 0,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach evaluation API';
  }

  const count = routes?.length ?? 0;

  return (
    <Container>
      <Section spacing="md">
        <header className="mb-6 flex flex-col gap-3">
          <Link
            href="/evaluation"
            className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <ArrowLeftIcon size={14} />
            <span>Evaluation</span>
          </Link>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              Evaluation methods
            </h1>
            {routes ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                <span className="text-[var(--color-foreground)] font-medium tabular-nums">
                  {count.toLocaleString('en-GB')}
                </span>{' '}
                {count === 1 ? 'method' : 'methods'}
              </p>
            ) : null}
          </div>
          <p className="max-w-2xl text-[var(--color-muted-foreground)]">
            Every result on the platform names the evaluation method and version that produced it,
            and a method version is reviewed before its results are published. Each method declares
            what it defends against, who gets to observe what, and the limits a submission must run
            within. The conformance specification calls these methods <em>routes</em>; the two words
            mean the same thing here.
          </p>
        </header>

        {error ? (
          <Alert tone="danger">
            <AlertTitle as="h2">Evaluation unavailable</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        ) : !routes || routes.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {routes.map((r) => (
              <li key={r.id}>
                <RouteCard route={r} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Container>
  );
}

function RouteCard({ route }: { route: EvaluationRouteResponse }) {
  const latest = latestVersion(route.versions);
  const versionCount = route.versions.length;

  return (
    <Card accent="phase-c" interactive="hover" className="h-full">
      <CardHeader>
        {/* `as="h2"`: the cards are the content of this page, so they sit
            directly under the h1 — an h3 here would skip a level. */}
        <CardTitle as="h2" className="line-clamp-2">
          <Link
            href={`/evaluation/routes/${encodeURIComponent(route.slug)}`}
            className="rounded hover:text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            {route.name}
          </Link>
        </CardTitle>
        <CardDescription>{describeMode(route.mode)}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Provider
            </dt>
            <dd className="mt-1 text-[var(--color-foreground)]">{describeProvider(route)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Latest version
            </dt>
            <dd className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--color-foreground)]">
              {latest ? (
                <>
                  <span className="font-mono tabular-nums">{latest.version}</span>
                  <ReviewStatusBadge attribution={attributionForVersion(route.slug, latest)} />
                </>
              ) : (
                <span className="text-[var(--color-muted-foreground)]">
                  No version declared yet
                </span>
              )}
            </dd>
          </div>
        </dl>
        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-muted-foreground)]">
          <span className="min-w-0 truncate font-mono">{route.slug}</span>
          <Badge tone={versionCount > 0 ? 'primary' : 'neutral'}>
            {versionCount.toLocaleString('en-GB')} {versionCount === 1 ? 'version' : 'versions'}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-12 text-center">
      <span
        className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-[var(--shadow-xs)]"
        aria-hidden="true"
      >
        <ShieldIcon size={20} />
      </span>
      <h2 className="mt-4 text-lg font-semibold">No evaluation methods registered yet.</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-muted-foreground)]">
        An evaluation method is registered with a threat model, a disclosure profile and an
        operational envelope, then reviewed. Once the first one is registered, it will appear here.
      </p>
    </div>
  );
}

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
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
import { auth } from '../../../auth';
import type { Formatters } from '../../../i18n/format';
import { getFormatters } from '../../../i18n/server';
import { apiFetch } from '../../../lib/api';
import { isEvaluationReviewer } from '../../../lib/groups';
import { ReviewStatusBadge } from '../../../components/evaluation/review-status-badge';
import {
  attributionForVersion,
  describeMode,
  describeProvider,
  latestVersion,
} from '../../../components/evaluation/route-labels';
import { awaitingReview } from './queue';

type MethodsT = Awaited<ReturnType<typeof getTranslations<'EvaluationMethods'>>>;

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
 *
 * An evaluation reviewer (or admin) also sees how many versions wait for a
 * decision and the way to the review queue (#649). Everyone else sees the
 * public page unchanged.
 *
 * Every word is in the interface language (#654); method and provider
 * names are shown as registered.
 */

export async function generateMetadata() {
  const t = await getTranslations('EvaluationMethods');
  return { title: t('list.metaTitle'), description: t('list.metaDescription') };
}

export default async function EvaluationRoutesPage() {
  const [t, tEvaluation, f] = await Promise.all([
    getTranslations('EvaluationMethods'),
    getTranslations('Evaluation'),
    getFormatters(),
  ]);
  let routes: EvaluationRouteResponse[] | null = null;
  let error: string | null = null;
  try {
    routes = await apiFetch<EvaluationRouteResponse[]>('/v2/evaluation/routes', {
      revalidate: 0,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : tEvaluation('unavailable.fallback');
  }

  const count = routes?.length ?? 0;
  const reviewer = isEvaluationReviewer(await auth());
  const queue = routes ? awaitingReview(routes) : null;
  const waiting = queue ? queue.underReview.length + queue.declared.length : 0;

  return (
    <Container>
      <Section spacing="md">
        <header className="mb-6 flex flex-col gap-3">
          <Link
            href="/evaluation"
            className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <ArrowLeftIcon size={14} />
            <span>{t('list.back')}</span>
          </Link>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t('list.title')}</h1>
            {routes ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                <span className="text-[var(--color-foreground)] font-medium tabular-nums">
                  {f.number(count)}
                </span>{' '}
                {t('list.methodWord', { count })}
              </p>
            ) : null}
          </div>
          <p className="max-w-2xl text-[var(--color-muted-foreground)]">
            {t.rich('list.lead', { em: (chunks) => <em>{chunks}</em> })}
          </p>
        </header>

        {reviewer && routes ? (
          <div className="mb-6">
            <Alert tone="info">
              <AlertTitle as="h2">{t('list.review.heading')}</AlertTitle>
              <AlertDescription>
                {t('list.review.body', { count: waiting, n: f.number(waiting) })}{' '}
                <Link
                  href="/evaluation/routes/reviews"
                  className="font-medium underline underline-offset-2"
                >
                  {t('list.review.link')}
                </Link>
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        {error ? (
          <Alert tone="danger">
            <AlertTitle as="h2">{tEvaluation('unavailable.title')}</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        ) : !routes || routes.length === 0 ? (
          <EmptyState t={t} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {routes.map((r) => (
              <li key={r.id}>
                <RouteCard route={r} t={t} f={f} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Container>
  );
}

function RouteCard({
  route,
  t,
  f,
}: {
  route: EvaluationRouteResponse;
  t: MethodsT;
  f: Formatters;
}) {
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
        <CardDescription>{describeMode(route.mode, t)}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              {t('list.provider')}
            </dt>
            <dd className="mt-1 text-[var(--color-foreground)]">{describeProvider(route, t)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              {t('list.latestVersion')}
            </dt>
            <dd className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--color-foreground)]">
              {latest ? (
                <>
                  <span className="font-mono tabular-nums">{latest.version}</span>
                  <ReviewStatusBadge attribution={attributionForVersion(route.slug, latest)} />
                </>
              ) : (
                <span className="text-[var(--color-muted-foreground)]">{t('list.noVersion')}</span>
              )}
            </dd>
          </div>
        </dl>
        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-muted-foreground)]">
          <span className="min-w-0 truncate font-mono">{route.slug}</span>
          <Badge tone={versionCount > 0 ? 'primary' : 'neutral'}>
            {t('list.versionCount', { count: versionCount, n: f.number(versionCount) })}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ t }: { t: MethodsT }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-12 text-center">
      <span
        className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-[var(--shadow-xs)]"
        aria-hidden="true"
      >
        <ShieldIcon size={20} />
      </span>
      <h2 className="mt-4 text-lg font-semibold">{t('list.emptyTitle')}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-muted-foreground)]">
        {t('list.emptyBody')}
      </p>
    </div>
  );
}

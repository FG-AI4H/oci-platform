import type { ReactNode } from 'react';
import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle, ArrowLeftIcon, Badge, Container, Section } from '@oci/ui';
import type { EvaluationRouteResponse, RoutePermissionsResponse } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { apiFetch } from '../../../../lib/api';
import { isEvaluationReviewer } from '../../../../lib/groups';
import { describeProvider, shortMode } from '../../../../components/evaluation/route-labels';
import { readRoutePermissions } from '../permissions';
import { awaitingReview, type AwaitingVersion } from '../queue';
import { QUEUE_TEXT } from './strings';

/**
 * Review queue (#649): evaluation-method versions waiting for a decision,
 * for `evaluation-reviewer` and `admin`. Read from the public list, so it
 * shows nothing a visitor could not already see; the role only decides who
 * is offered the queue. For each method with a waiting version the caller's
 * permissions are read, so a version they submitted is marked as one
 * another reviewer decides.
 */

export const metadata = {
  title: QUEUE_TEXT.metaTitle,
  description: QUEUE_TEXT.metaDescription,
  robots: { index: false },
};

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

export default async function ReviewQueuePage() {
  const session = await auth();

  let body: ReactNode;
  if (!session?.user) {
    body = (
      <Alert tone="info">
        <AlertTitle as="h2">{QUEUE_TEXT.signedOutTitle}</AlertTitle>
        <AlertDescription>
          {QUEUE_TEXT.signedOut}{' '}
          <Link
            href={`/signin?callbackUrl=${encodeURIComponent('/evaluation/routes/reviews')}`}
            className="underline underline-offset-2"
          >
            {QUEUE_TEXT.signIn}
          </Link>
        </AlertDescription>
      </Alert>
    );
  } else if (!isEvaluationReviewer(session)) {
    body = (
      <Alert tone="info">
        <AlertTitle as="h2">{QUEUE_TEXT.notReviewerTitle}</AlertTitle>
        <AlertDescription>{QUEUE_TEXT.notReviewer}</AlertDescription>
      </Alert>
    );
  } else {
    let routes: EvaluationRouteResponse[] | null = null;
    try {
      routes = await apiFetch<EvaluationRouteResponse[]>('/v2/evaluation/routes', {
        revalidate: 0,
      });
    } catch (err) {
      unstable_rethrow(err);
    }
    if (!routes) {
      body = (
        <Alert tone="warning">
          <AlertDescription>{QUEUE_TEXT.unavailable}</AlertDescription>
        </Alert>
      );
    } else {
      const { underReview, declared } = awaitingReview(routes);
      const slugs = [...new Set([...underReview, ...declared].map((v) => v.route.slug))];
      const reads = await Promise.all(slugs.map((slug) => readRoutePermissions(slug, session)));
      const permissions = new Map<string, RoutePermissionsResponse>();
      reads.forEach((read) => {
        if (read.status === 'ok') permissions.set(read.permissions.slug, read.permissions);
      });
      const total = underReview.length + declared.length;
      body =
        total === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
            {QUEUE_TEXT.allEmpty}
          </p>
        ) : (
          <div className="space-y-10">
            <p className="text-sm font-medium tabular-nums" role="status">
              {QUEUE_TEXT.count(total)}
            </p>
            <QueueGroup
              id="under-review"
              heading={QUEUE_TEXT.underReviewHeading}
              hint={QUEUE_TEXT.underReviewHint}
              items={underReview}
              permissions={permissions}
            />
            <QueueGroup
              id="declared"
              heading={QUEUE_TEXT.declaredHeading}
              hint={QUEUE_TEXT.declaredHint}
              items={declared}
              permissions={permissions}
            />
          </div>
        );
    }
  }

  return (
    <Container size="lg">
      <Section spacing="md" className="space-y-6">
        <Link
          href="/evaluation/routes"
          className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          <ArrowLeftIcon size={14} />
          <span>{QUEUE_TEXT.back}</span>
        </Link>
        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {QUEUE_TEXT.eyebrow}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{QUEUE_TEXT.title}</h1>
          <p className="max-w-2xl text-[var(--color-muted-foreground)]">{QUEUE_TEXT.lead}</p>
        </header>
        {body}
      </Section>
    </Container>
  );
}

function QueueGroup({
  id,
  heading,
  hint,
  items,
  permissions,
}: {
  id: string;
  heading: string;
  hint: string;
  items: AwaitingVersion[];
  permissions: Map<string, RoutePermissionsResponse>;
}) {
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-3">
      <div>
        <h2 id={`${id}-h`} className="text-xl font-semibold tracking-tight">
          {heading}
        </h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">{hint}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">{QUEUE_TEXT.empty}</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          {items.map(({ route, version }) => {
            const mine = permissions
              .get(route.slug)
              ?.versions.find((v) => v.version === version.version);
            const canAct = Boolean(mine && mine.allowedTransitions.some((t) => t !== 'WITHDRAWN'));
            const note =
              mine?.reviewBar === 'SUBMITTED_BY_YOU'
                ? QUEUE_TEXT.yoursSubmitted
                : mine?.reviewBar === 'DECLARED_BY_YOU'
                  ? QUEUE_TEXT.yoursDeclared
                  : mine
                    ? null
                    : QUEUE_TEXT.permissionsUnknown;
            const href = canAct
              ? `/evaluation/routes/${route.slug}#review-${version.id}`
              : `/evaluation/routes/${route.slug}#version-${version.id}`;
            return (
              <li
                key={version.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    {route.name}{' '}
                    <span className="font-mono text-sm tabular-nums text-[var(--color-muted-foreground)]">
                      {version.version}
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                    <Badge tone="info">{shortMode(route.mode)}</Badge>
                    <span>{describeProvider(route)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {QUEUE_TEXT.declaredOn}{' '}
                      <time dateTime={version.createdAt}>
                        {DATE_FORMATTER.format(new Date(version.createdAt))}
                      </time>
                    </span>
                  </div>
                  {note ? <p className="text-sm">{note}</p> : null}
                </div>
                <Link
                  href={href}
                  aria-label={
                    canAct
                      ? QUEUE_TEXT.openFor(version.version, route.name)
                      : QUEUE_TEXT.viewFor(version.version, route.name)
                  }
                  className={
                    canAct
                      ? 'inline-flex h-11 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] sm:h-10'
                      : 'inline-flex h-11 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] px-4 text-sm font-medium hover:bg-[var(--color-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] sm:h-10'
                  }
                >
                  {canAct ? QUEUE_TEXT.open(version.version) : QUEUE_TEXT.view(version.version)}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

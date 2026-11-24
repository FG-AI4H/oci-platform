import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  ArrowRightIcon,
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
  Separator,
} from '@oci/ui';
import {
  RouteReviewStatusSchema,
  type DisclosureProfile,
  type EvaluationRouteResponse,
  type OperationalEnvelope,
  type RoutePermissionsResponse,
  type RouteVersionResponse,
  type ThreatModel,
} from '@oci/shared-types';
import { auth } from '../../../../auth';
import type { Formatters } from '../../../../i18n/format';
import { getFormatters } from '../../../../i18n/server';
import { apiFetch } from '../../../../lib/api';
import {
  describeAttribution,
  ReviewStatusBadge,
} from '../../../../components/evaluation/review-status-badge';
import {
  attributionForVersion,
  describeMode,
  describeProvider,
  formatDelta,
  formatMemory,
  formatRuntime,
  partyGlossary,
  partyLabel,
  shortMode,
  sortVersionsLatestFirst,
  trustAnchorLabel,
} from '../../../../components/evaluation/route-labels';
import { readRoutePermissions } from '../permissions';
import { ReviewForm } from './review-form';
import { statusWord } from './review-outcome';

type MethodsT = Awaited<ReturnType<typeof getTranslations<'EvaluationMethods'>>>;
type ReviewT = Awaited<ReturnType<typeof getTranslations<'EvaluationReview'>>>;

/**
 * Evaluation method detail (#487, WP5 / ADR-0018). Anonymous —
 * `GET /v2/evaluation/routes/:slug` is public: the three declarations are
 * the published part of the conformance specification, not a secret.
 *
 * One block per version, latest first, each mirroring the three declarations
 * as the schema names them (threat model, disclosure profile, operational
 * envelope) with a one-line plain-language explanation under every heading.
 * The review outcome sits at the top of each version block because it is
 * what decides whether that version's results are published.
 *
 * Signed in, the page also offers what the caller may do (#649), as
 * `GET /v2/evaluation/routes/:slug/permissions` reports it: an evaluation
 * reviewer who did not submit the method reviews a version at the end of its
 * block, after reading its declarations; the method's submitter withdraws a
 * version there, and declares a new one on its own page. Signed out, or if
 * the permissions cannot be read, the page stays the public read-only view.
 *
 * Only the latest decision and its rationale are shown: the API keeps one
 * outcome per version and does not expose who recorded it, so the page
 * names no reviewer.
 *
 * Every word the page adds is in the interface language (#654); what the
 * method's provider declared (capabilities, assumptions, key governance…)
 * is shown as written.
 */

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTranslations('EvaluationMethods');
  return {
    title: t('detail.metaTitle', { slug }),
    description: t('detail.metaDescription', { slug }),
  };
}

export default async function EvaluationRouteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const [t, tReview, tEvaluation, f] = await Promise.all([
    getTranslations('EvaluationMethods'),
    getTranslations('EvaluationReview'),
    getTranslations('Evaluation'),
    getFormatters(),
  ]);

  let route: EvaluationRouteResponse | null = null;
  let error: string | null = null;
  try {
    route = await apiFetch<EvaluationRouteResponse>(
      `/v2/evaluation/routes/${encodeURIComponent(slug)}`,
      { revalidate: 0 },
    );
  } catch (err) {
    error = err instanceof Error ? err.message : tEvaluation('unavailable.fallback');
  }

  if (error) {
    return (
      <Container size="md">
        <Section spacing="md">
          <Alert tone="danger">
            <AlertTitle as="h1">{tEvaluation('unavailable.title')}</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        </Section>
      </Container>
    );
  }

  if (!route) notFound();

  const versions = sortVersionsLatestFirst(route.versions);
  const session = await auth();
  const access = await readRoutePermissions(route.slug, session);
  const permissions = access.status === 'ok' ? access.permissions : null;
  const banner = bannerFor(versions, query, tReview);

  return (
    <>
      <Section spacing="md" surface="hero">
        <Container size="xl">
          <Link
            href="/evaluation/routes"
            className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <ArrowLeftIcon size={14} />
            <span>{t('detail.back')}</span>
          </Link>
          <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs text-[var(--color-muted-foreground)]">{route.slug}</p>
              <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--color-foreground)]">
                {route.name}
              </h1>
              <p className="mt-4 max-w-2xl text-[var(--color-muted-foreground)]">
                {t('detail.lead', { mode: describeMode(route.mode, t) })}
              </p>
            </div>
            <div className="flex flex-row flex-wrap items-start gap-2 lg:flex-col lg:items-end">
              <Badge tone="info">{shortMode(route.mode, t)}</Badge>
              <Badge tone={route.isReference ? 'accent' : 'neutral'}>
                {describeProvider(route, t)}
              </Badge>
            </div>
          </div>
        </Container>
      </Section>

      <Container size="xl">
        <Section spacing="md" className="space-y-8">
          {banner ? (
            <div role="status">
              <Alert tone="success">
                <AlertDescription>{banner}</AlertDescription>
              </Alert>
            </div>
          ) : null}
          {access.status === 'unavailable' ? (
            <Alert tone="warning">
              <AlertDescription>{tReview('permissionsUnavailable')}</AlertDescription>
            </Alert>
          ) : null}
          {permissions?.canDeclareVersion ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">{t('declareLink.heading')}</CardTitle>
                <CardDescription>
                  {permissions.isSubmitter ? t('declareLink.body') : t('declareLink.bodyAdmin')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link
                  href={`/evaluation/routes/${route.slug}/versions/new`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] sm:h-10"
                >
                  {t('declareLink.link')}
                  <ArrowRightIcon size={14} />
                </Link>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle as="h2">{t('detail.about.title')}</CardTitle>
              <CardDescription>{t('detail.about.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term={t('detail.about.slug')} mono>
                  {route.slug}
                </DefinitionItem>
                <DefinitionItem term={t('detail.about.howItRuns')}>
                  {describeMode(route.mode, t)}
                </DefinitionItem>
                <DefinitionItem term={t('detail.about.provider')}>
                  {describeProvider(route, t)}
                </DefinitionItem>
                <DefinitionItem term={t('detail.about.versions')}>
                  <span className="tabular-nums">{f.number(versions.length)}</span>{' '}
                  <span className="text-[var(--color-muted-foreground)]">
                    {t('detail.about.versionsNote', { count: versions.length })}
                  </span>
                </DefinitionItem>
                <DefinitionItem term={t('detail.about.registered')}>
                  <time dateTime={route.createdAt}>{f.date(route.createdAt)}</time>
                </DefinitionItem>
                <DefinitionItem term={t('detail.about.parties')}>
                  <ul className="space-y-1">
                    {partyGlossary(t).map(({ party, label, description }) => (
                      <li key={party}>
                        <span className="font-medium">{label}</span>
                        <span className="text-[var(--color-muted-foreground)]">
                          {' '}
                          — {description}
                        </span>
                      </li>
                    ))}
                  </ul>
                </DefinitionItem>
              </DefinitionList>
            </CardContent>
          </Card>

          <Alert tone="info">
            <AlertTitle as="h2">{t('detail.frozen.title')}</AlertTitle>
            <AlertDescription>{t('detail.frozen.body')}</AlertDescription>
          </Alert>

          {versions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
              {t('detail.noVersions')}
            </p>
          ) : (
            versions.map((version) => (
              <VersionBlock
                key={version.id}
                routeSlug={route.slug}
                methodName={route.name}
                version={version}
                permissions={permissions}
                t={t}
                tReview={tReview}
                f={f}
              />
            ))
          )}

          <Separator />

          <p className="text-center text-xs text-[var(--color-muted-foreground)]">
            {t('detail.footerCount', { count: versions.length, n: f.number(versions.length) })}{' '}
            <Link
              href="/evaluation/routes"
              className="underline underline-offset-2 hover:text-[var(--color-foreground)]"
            >
              {t('detail.backToList')}
            </Link>
            .
          </p>
        </Section>
      </Container>
    </>
  );
}

/**
 * The confirmation after a decision or a declaration, from the query the
 * action redirected with. Shown only when it matches the version as it is
 * now, so a crafted link cannot make the page claim a decision.
 */
function bannerFor(
  versions: RouteVersionResponse[],
  query: Record<string, string | string[] | undefined>,
  t: ReviewT,
): string | null {
  const recorded = typeof query.recorded === 'string' ? query.recorded : null;
  const to = RouteReviewStatusSchema.safeParse(query.to);
  if (recorded && to.success) {
    const version = versions.find((v) => v.version === recorded);
    if (version && version.reviewStatus === to.data) {
      return t('recordedBanner', { version: version.version, status: statusWord(to.data, t) });
    }
  }
  const declared = typeof query.declared === 'string' ? query.declared : null;
  if (declared) {
    const version = versions.find((v) => v.version === declared);
    if (version && version.reviewStatus === 'DECLARED') {
      return t('declaredBanner', { version: version.version });
    }
  }
  return null;
}

async function VersionBlock({
  routeSlug,
  methodName,
  version,
  permissions,
  t,
  tReview,
  f,
}: {
  routeSlug: string;
  methodName: string;
  version: RouteVersionResponse;
  permissions: RoutePermissionsResponse | null;
  t: MethodsT;
  tReview: ReviewT;
  f: Formatters;
}) {
  const headingId = `version-${version.id}`;
  const attribution = attributionForVersion(routeSlug, version);
  const { description: reviewDescription } = describeAttribution(
    attribution,
    await getTranslations('Evaluation'),
  );
  const mine = permissions?.versions.find((v) => v.version === version.version) ?? null;
  const allowed = mine?.allowedTransitions ?? [];
  const mode = permissions?.isSubmitter ? 'withdraw' : 'review';
  const barred =
    mine?.reviewBar === 'SUBMITTED_BY_YOU'
      ? tReview('barredSubmitted')
      : mine?.reviewBar === 'DECLARED_BY_YOU'
        ? tReview('barredDeclared')
        : null;

  return (
    <section
      id={headingId}
      aria-labelledby={`${headingId}-title`}
      className="scroll-mt-24 space-y-6"
    >
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id={`${headingId}-title`} className="text-2xl font-semibold tracking-tight">
            {t.rich('detail.version.heading', {
              version: version.version,
              mono: (chunks) => <span className="font-mono tabular-nums">{chunks}</span>,
            })}
          </h2>
          {/* The sentence behind the badge is printed just below, so the
              badge does not repeat it for assistive technology. */}
          <ReviewStatusBadge attribution={attribution} describe={false} />
        </div>
        <p className="max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          {reviewDescription}{' '}
          <span>
            {version.reviewedAt
              ? t.rich('detail.version.declaredReviewed', {
                  declaredOn: f.date(version.createdAt),
                  reviewedOn: f.date(version.reviewedAt),
                  declared: (chunks) => <time dateTime={version.createdAt}>{chunks}</time>,
                  reviewed: (chunks) => <time dateTime={version.reviewedAt ?? ''}>{chunks}</time>,
                })
              : t.rich('detail.version.declaredNotReviewed', {
                  declaredOn: f.date(version.createdAt),
                  declared: (chunks) => <time dateTime={version.createdAt}>{chunks}</time>,
                })}
          </span>
        </p>
        {version.reviewNotes ? (
          <div className="max-w-2xl rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-4 text-sm">
            <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              {tReview('reviewRecord')}
            </h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-[var(--color-foreground)]">
              {version.reviewNotes}
            </p>
            <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
              {tReview('reviewRecordHint')}
            </p>
          </div>
        ) : null}
        {allowed.length > 0 ? (
          <a
            href={`#review-${version.id}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] sm:min-h-6"
          >
            {mode === 'withdraw' ? tReview('withdrawLink') : tReview('reviewLink')}
          </a>
        ) : null}
        {barred ? (
          <div className="max-w-2xl">
            <Alert tone="info">
              <AlertDescription>{barred}</AlertDescription>
            </Alert>
          </div>
        ) : null}
      </header>

      <ThreatModelCard model={version.threatModel} t={t} />
      <DisclosureProfileCard profile={version.disclosureProfile} t={t} />
      <OperationalEnvelopeCard envelope={version.operationalEnvelope} t={t} f={f} />

      {permissions ? (
        <ReviewForm
          slug={routeSlug}
          methodName={methodName}
          version={version.version}
          versionId={version.id}
          reviewStatus={version.reviewStatus}
          allowed={allowed}
          mode={mode}
          replacesRationale={Boolean(version.reviewNotes)}
        />
      ) : null}
    </section>
  );
}

/** Sub-heading inside a declaration card. */
function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
      {children}
    </h4>
  );
}

function ThreatModelCard({ model, t }: { model: ThreatModel; t: MethodsT }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">{t('detail.threat.title')}</CardTitle>
        <CardDescription>{t('detail.threat.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <SubHeading>{t('detail.threat.adversaries')}</SubHeading>
          {/*
           * Three wrapping columns fit at 375px, so the verdict column stays
           * in view without a horizontal scroll. The wrapper still scrolls
           * inside itself should a capability contain an unbreakable token,
           * so it never widens the page; a scrollable region has to be
           * reachable by keyboard, hence `tabIndex={0}` and the label, with
           * the focus ring that comes with them.
           */}
          <div
            role="region"
            aria-label={t('detail.threat.adversariesRegion')}
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-subtle)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium sm:px-4">
                    {t('detail.threat.party')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium sm:px-4">
                    {t('detail.threat.capability')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium sm:px-4">
                    {t('detail.threat.defended')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {model.adversaries.map((adversary, i) => (
                  <tr
                    key={`${adversary.party}-${i}`}
                    className="border-t border-[var(--color-border)] align-top"
                  >
                    <th
                      scope="row"
                      // `hyphens-auto`: the French party names (« opérateur de
                      // la plateforme ») are longer than the English ones and
                      // made the table scroll at 375 px; they break at a
                      // hyphen instead (#654).
                      className="px-3 py-3 text-start font-medium text-[var(--color-foreground)] hyphens-auto sm:px-4"
                    >
                      {partyLabel(adversary.party, t)}
                    </th>
                    <td className="px-3 py-3 text-[var(--color-foreground)] sm:px-4">
                      {adversary.capability}
                    </td>
                    <td className="w-px whitespace-nowrap px-3 py-3 sm:px-4">
                      <Badge tone={adversary.defended ? 'success' : 'warning'}>
                        {adversary.defended ? t('detail.threat.yes') : t('detail.threat.no')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {t.rich('detail.threat.noNote', { em: (chunks) => <em>{chunks}</em> })}
          </p>
        </div>

        <div className="space-y-2">
          <SubHeading>{t('detail.threat.assumptions')}</SubHeading>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-foreground)]">
            {model.assumptions.map((assumption, i) => (
              <li key={i}>{assumption}</li>
            ))}
          </ul>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {t('detail.threat.assumptionsHint')}
          </p>
        </div>

        <div className="space-y-2 rounded-lg border-l-4 border-[var(--color-primary)] bg-[var(--color-subtle)] p-4">
          <SubHeading>{t('detail.threat.outOfScope')}</SubHeading>
          <p className="text-sm text-[var(--color-foreground)]">
            {t('detail.threat.outOfScopeBody')}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-foreground)]">
            {model.outOfScope.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function DisclosureProfileCard({ profile, t }: { profile: DisclosureProfile; t: MethodsT }) {
  const trustAnchor = trustAnchorLabel(profile.trustAnchor, t);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">{t('detail.disclosure.title')}</CardTitle>
        <CardDescription>{t('detail.disclosure.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <DefinitionList>
          <DefinitionItem term={t('detail.disclosure.trustAnchor')}>
            {t.rich('detail.disclosure.restsOn', {
              anchor: trustAnchor,
              strong: (chunks) => <span className="font-medium">{chunks}</span>,
            })}
            <span className="text-[var(--color-muted-foreground)]">
              {' '}
              {t(`detail.disclosure.anchorNote.${profile.trustAnchor}`)}
            </span>
          </DefinitionItem>
          <DefinitionItem term={t('detail.disclosure.keyGovernance')}>
            {profile.keyGovernance}
          </DefinitionItem>
          <DefinitionItem term={t('detail.disclosure.reproducible')}>
            {profile.reproducible.value ? (
              <>
                <span className="font-medium">{t('detail.disclosure.yes')}</span>{' '}
                <span className="text-[var(--color-muted-foreground)]">
                  {profile.reproducible.method}
                </span>
              </>
            ) : (
              <>
                <span className="font-medium">{t('detail.disclosure.no')}</span>{' '}
                <span className="text-[var(--color-muted-foreground)]">
                  {profile.reproducible.method ?? t('detail.disclosure.notGuaranteed')}
                </span>
              </>
            )}
          </DefinitionItem>
        </DefinitionList>

        <div className="space-y-2">
          <SubHeading>{t('detail.disclosure.observes')}</SubHeading>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {t('detail.disclosure.observesHint')}
          </p>
          <DefinitionList className="rounded-lg border border-[var(--color-border)] p-4">
            {profile.observations.map((observation, i) => (
              <DefinitionItem
                key={`${observation.party}-${i}`}
                term={partyLabel(observation.party, t)}
              >
                {observation.observes}
              </DefinitionItem>
            ))}
          </DefinitionList>
        </div>
      </CardContent>
    </Card>
  );
}

function OperationalEnvelopeCard({
  envelope,
  t,
  f,
}: {
  envelope: OperationalEnvelope;
  t: MethodsT;
  f: Formatters;
}) {
  const gap = envelope.fidelityGap ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">{t('detail.envelope.title')}</CardTitle>
        <CardDescription>{t('detail.envelope.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <DefinitionList>
          <DefinitionItem term={t('detail.envelope.permittedOperations')}>
            <ul className="list-disc space-y-1 pl-5">
              {envelope.permittedOperations.map((operation, i) => (
                <li key={i}>{operation}</li>
              ))}
            </ul>
          </DefinitionItem>
          <DefinitionItem term={t('detail.envelope.arithmeticPrecision')}>
            {envelope.arithmeticPrecision}
          </DefinitionItem>
          <DefinitionItem term={t('detail.envelope.maxRuntime')}>
            <span className="tabular-nums">{formatRuntime(envelope.maxRuntimeSec)}</span>{' '}
            <span className="text-[var(--color-muted-foreground)] tabular-nums">
              {t('detail.envelope.seconds', { n: f.number(envelope.maxRuntimeSec) })}
            </span>
          </DefinitionItem>
          <DefinitionItem term={t('detail.envelope.maxMemory')}>
            <span className="tabular-nums">{formatMemory(envelope.maxMemoryMb, t, f)}</span>
            {envelope.maxMemoryMb >= 1024 ? (
              <span className="text-[var(--color-muted-foreground)] tabular-nums">
                {' '}
                {t('detail.envelope.mib', { n: f.number(envelope.maxMemoryMb) })}
              </span>
            ) : null}
          </DefinitionItem>
          <DefinitionItem term={t('detail.envelope.modelConstraints')}>
            {envelope.modelConstraints ? (
              envelope.modelConstraints
            ) : (
              <span className="text-[var(--color-muted-foreground)]">
                {t('detail.envelope.noneDeclared')}
              </span>
            )}
          </DefinitionItem>
          <DefinitionItem term={t('detail.envelope.fidelityGap')}>
            {gap ? (
              <>
                <span className="font-medium">
                  {t('detail.envelope.gapMetric', { metric: gap.metric })}{' '}
                  <span className="tabular-nums">{formatDelta(gap.delta, f)}</span>
                </span>{' '}
                <span className="text-[var(--color-muted-foreground)]">
                  {t('detail.envelope.measuredOn', { on: gap.measuredOn })}
                </span>
              </>
            ) : (
              <>
                <span className="font-medium">{t('detail.envelope.notMeasured')}</span>{' '}
                <span className="text-[var(--color-muted-foreground)]">
                  {t('detail.envelope.notMeasuredBody')}
                </span>
              </>
            )}
          </DefinitionItem>
        </DefinitionList>
      </CardContent>
    </Card>
  );
}

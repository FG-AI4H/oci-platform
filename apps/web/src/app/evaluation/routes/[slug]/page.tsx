import type { ReactNode } from 'react';
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
  Separator,
} from '@oci/ui';
import type {
  DisclosureProfile,
  EvaluationRouteResponse,
  OperationalEnvelope,
  RouteVersionResponse,
  ThreatModel,
} from '@oci/shared-types';
import { apiFetch } from '../../../../lib/api';
import {
  describeAttribution,
  ReviewStatusBadge,
} from '../../../../components/evaluation/review-status-badge';
import {
  attributionForVersion,
  DELTA_FORMATTER,
  describeMode,
  describeProvider,
  formatMemory,
  formatRuntime,
  PARTY_GLOSSARY,
  PARTY_LABEL,
  shortMode,
  sortVersionsLatestFirst,
  TRUST_ANCHOR_LABEL,
} from '../../../../components/evaluation/route-labels';

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
 * Read-only. Declaring a version and reviewing it are staff actions that
 * stay on the API until a later issue gives them a form.
 */

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return {
    title: `${slug} — OCI Evaluation methods`,
    description: `Threat model, disclosure profile and operational envelope declared by the ${slug} evaluation method, with the review status of each version.`,
  };
}

export default async function EvaluationRouteDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let route: EvaluationRouteResponse | null = null;
  let error: string | null = null;
  try {
    route = await apiFetch<EvaluationRouteResponse>(
      `/v2/evaluation/routes/${encodeURIComponent(slug)}`,
      { revalidate: 0 },
    );
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach evaluation API';
  }

  if (error) {
    return (
      <Container size="md">
        <Section spacing="md">
          <Alert tone="danger">
            <AlertTitle as="h1">Evaluation unavailable</AlertTitle>
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

  return (
    <>
      <Section spacing="md" surface="hero">
        <Container size="xl">
          <Link
            href="/evaluation/routes"
            className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <ArrowLeftIcon size={14} />
            <span>Evaluation methods</span>
          </Link>
          <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs text-[var(--color-muted-foreground)]">{route.slug}</p>
              <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--color-foreground)]">
                {route.name}
              </h1>
              <p className="mt-4 max-w-2xl text-[var(--color-muted-foreground)]">
                {describeMode(route.mode)}. Every result on the Open Code Infrastructure (OCI) names
                the evaluation method and version that produced it, and a method version is reviewed
                before its results are published. The declarations below are what that review
                examines.
              </p>
            </div>
            <div className="flex flex-row flex-wrap items-start gap-2 lg:flex-col lg:items-end">
              <Badge tone="info">{shortMode(route.mode)}</Badge>
              <Badge tone={route.isReference ? 'accent' : 'neutral'}>
                {describeProvider(route)}
              </Badge>
            </div>
          </div>
        </Container>
      </Section>

      <Container size="xl">
        <Section spacing="md" className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle as="h2">About this method</CardTitle>
              <CardDescription>
                Who provides it, how a submission runs, and who the four parties named in the
                declarations are.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term="Slug" mono>
                  {route.slug}
                </DefinitionItem>
                <DefinitionItem term="How it runs">{describeMode(route.mode)}</DefinitionItem>
                <DefinitionItem term="Provider">{describeProvider(route)}</DefinitionItem>
                <DefinitionItem term="Versions">
                  <span className="tabular-nums">{versions.length.toLocaleString('en-GB')}</span>{' '}
                  <span className="text-[var(--color-muted-foreground)]">
                    {versions.length === 1 ? '— shown below.' : '— latest first below.'}
                  </span>
                </DefinitionItem>
                <DefinitionItem term="Registered">
                  <time dateTime={route.createdAt}>
                    {DATE_FORMATTER.format(new Date(route.createdAt))}
                  </time>
                </DefinitionItem>
                <DefinitionItem term="Parties">
                  <ul className="space-y-1">
                    {PARTY_GLOSSARY.map(({ party, label, description }) => (
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
            <AlertTitle as="h2">Declarations are frozen once review begins</AlertTitle>
            <AlertDescription>
              A version&rsquo;s threat model, disclosure profile and operational envelope cannot
              change after it enters review, so the outcome applies to exactly what was reviewed. A
              change means a new version. Only an approved version produces published results;
              results from a version still under review are provisional, and results from a rejected
              or withdrawn version are withdrawn with it.
            </AlertDescription>
          </Alert>

          {versions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
              This method has no version declared yet, so it has produced no results.
            </p>
          ) : (
            versions.map((version) => (
              <VersionBlock key={version.id} routeSlug={route.slug} version={version} />
            ))
          )}

          <Separator />

          <p className="text-center text-xs text-[var(--color-muted-foreground)]">
            {versions.length.toLocaleString('en-GB')}{' '}
            {versions.length === 1 ? 'version' : 'versions'} declared.{' '}
            <Link
              href="/evaluation/routes"
              className="underline underline-offset-2 hover:text-[var(--color-foreground)]"
            >
              Back to evaluation methods
            </Link>
            .
          </p>
        </Section>
      </Container>
    </>
  );
}

function VersionBlock({
  routeSlug,
  version,
}: {
  routeSlug: string;
  version: RouteVersionResponse;
}) {
  const headingId = `version-${version.id}`;
  const attribution = attributionForVersion(routeSlug, version);
  const { description: reviewDescription } = describeAttribution(attribution);

  return (
    <section aria-labelledby={headingId} className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id={headingId} className="text-2xl font-semibold tracking-tight">
            Version <span className="font-mono tabular-nums">{version.version}</span>
          </h2>
          {/* The sentence behind the badge is printed just below, so the
              badge does not repeat it for assistive technology. */}
          <ReviewStatusBadge attribution={attribution} describe={false} />
        </div>
        <p className="max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          {reviewDescription}{' '}
          <span>
            Declared{' '}
            <time dateTime={version.createdAt}>
              {DATE_FORMATTER.format(new Date(version.createdAt))}
            </time>
            {version.reviewedAt ? (
              <>
                ; reviewed{' '}
                <time dateTime={version.reviewedAt}>
                  {DATE_FORMATTER.format(new Date(version.reviewedAt))}
                </time>
              </>
            ) : (
              '; not yet reviewed'
            )}
            .
          </span>
        </p>
        {version.reviewNotes ? (
          <div className="max-w-2xl rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-4 text-sm">
            <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Review notes
            </h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-[var(--color-foreground)]">
              {version.reviewNotes}
            </p>
          </div>
        ) : null}
      </header>

      <ThreatModelCard model={version.threatModel} />
      <DisclosureProfileCard profile={version.disclosureProfile} />
      <OperationalEnvelopeCard envelope={version.operationalEnvelope} />
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

function ThreatModelCard({ model }: { model: ThreatModel }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Threat model</CardTitle>
        <CardDescription>
          Who might try to learn something they should not, what this method does about each of
          them, what it takes for granted, and what it makes no promise about.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <SubHeading>Adversaries</SubHeading>
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
            aria-label="Adversaries this version considers"
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-[var(--color-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-subtle)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium sm:px-4">
                    Party
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium sm:px-4">
                    Capability
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium sm:px-4">
                    Defended
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
                      className="px-3 py-3 text-left font-medium text-[var(--color-foreground)] sm:px-4"
                    >
                      {PARTY_LABEL[adversary.party]}
                    </th>
                    <td className="px-3 py-3 text-[var(--color-foreground)] sm:px-4">
                      {adversary.capability}
                    </td>
                    <td className="w-px whitespace-nowrap px-3 py-3 sm:px-4">
                      <Badge tone={adversary.defended ? 'success' : 'warning'}>
                        {adversary.defended ? 'yes' : 'no'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            A party marked <em>no</em> is named so nobody mistakes it for a guarantee: this method
            does not defend against it.
          </p>
        </div>

        <div className="space-y-2">
          <SubHeading>Assumptions</SubHeading>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-foreground)]">
            {model.assumptions.map((assumption, i) => (
              <li key={i}>{assumption}</li>
            ))}
          </ul>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            What has to hold for the defences above to work. If an assumption fails, so does the
            guarantee that rests on it.
          </p>
        </div>

        <div className="space-y-2 rounded-lg border-l-4 border-[var(--color-primary)] bg-[var(--color-subtle)] p-4">
          <SubHeading>Out of scope</SubHeading>
          <p className="text-sm text-[var(--color-foreground)]">
            A threat model with nothing out of scope is rejected on entry; naming the boundaries is
            the point.
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

function DisclosureProfileCard({ profile }: { profile: DisclosureProfile }) {
  const trustAnchor = TRUST_ANCHOR_LABEL[profile.trustAnchor];

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Disclosure profile</CardTitle>
        <CardDescription>
          Who gets to see what while an evaluation runs, what that guarantee ultimately rests on,
          and whether a result can be reproduced.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <DefinitionList>
          <DefinitionItem term="Trust anchor">
            The guarantees rest on <span className="font-medium">{trustAnchor}</span>
            {profile.trustAnchor === 'CONTRACTUAL' ? (
              <span className="text-[var(--color-muted-foreground)]">
                {' '}
                — an operating agreement between the parties, not a technical mechanism.
              </span>
            ) : profile.trustAnchor === 'HARDWARE_ATTESTATION' ? (
              <span className="text-[var(--color-muted-foreground)]">
                {' '}
                — the processor proves what code it is running before any data is released to it.
              </span>
            ) : (
              <span className="text-[var(--color-muted-foreground)]">
                {' '}
                — breaking the guarantee would mean solving a problem believed to be computationally
                infeasible.
              </span>
            )}
          </DefinitionItem>
          <DefinitionItem term="Key governance">{profile.keyGovernance}</DefinitionItem>
          <DefinitionItem term="Reproducible">
            {profile.reproducible.value ? (
              <>
                <span className="font-medium">Yes.</span>{' '}
                <span className="text-[var(--color-muted-foreground)]">
                  {profile.reproducible.method}
                </span>
              </>
            ) : (
              <>
                <span className="font-medium">No.</span>{' '}
                <span className="text-[var(--color-muted-foreground)]">
                  {profile.reproducible.method ??
                    'Running the same submission again is not guaranteed to give the same result.'}
                </span>
              </>
            )}
          </DefinitionItem>
        </DefinitionList>

        <div className="space-y-2">
          <SubHeading>Who observes what</SubHeading>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Everything each party can see during an evaluation, including what it already holds.
          </p>
          <DefinitionList className="rounded-lg border border-[var(--color-border)] p-4">
            {profile.observations.map((observation, i) => (
              <DefinitionItem
                key={`${observation.party}-${i}`}
                term={PARTY_LABEL[observation.party]}
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

function OperationalEnvelopeCard({ envelope }: { envelope: OperationalEnvelope }) {
  const gap = envelope.fidelityGap ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Operational envelope</CardTitle>
        <CardDescription>
          The limits a submission must be designed to run within. The runtime and memory caps are
          enforced by the sandbox, not merely documented. Memory is given in mebibytes (MiB) and
          gibibytes (GiB).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DefinitionList>
          <DefinitionItem term="Permitted operations">
            <ul className="list-disc space-y-1 pl-5">
              {envelope.permittedOperations.map((operation, i) => (
                <li key={i}>{operation}</li>
              ))}
            </ul>
          </DefinitionItem>
          <DefinitionItem term="Arithmetic precision">
            {envelope.arithmeticPrecision}
          </DefinitionItem>
          <DefinitionItem term="Maximum runtime">
            <span className="tabular-nums">{formatRuntime(envelope.maxRuntimeSec)}</span>{' '}
            <span className="text-[var(--color-muted-foreground)] tabular-nums">
              ({envelope.maxRuntimeSec.toLocaleString('en-GB')} seconds)
            </span>
          </DefinitionItem>
          <DefinitionItem term="Maximum memory">
            <span className="tabular-nums">{formatMemory(envelope.maxMemoryMb)}</span>
            {envelope.maxMemoryMb >= 1024 ? (
              <span className="text-[var(--color-muted-foreground)] tabular-nums">
                {' '}
                ({envelope.maxMemoryMb.toLocaleString('en-GB')} MiB)
              </span>
            ) : null}
          </DefinitionItem>
          <DefinitionItem term="Model constraints">
            {envelope.modelConstraints ? (
              envelope.modelConstraints
            ) : (
              <span className="text-[var(--color-muted-foreground)]">None declared.</span>
            )}
          </DefinitionItem>
          <DefinitionItem term="Fidelity gap">
            {gap ? (
              <>
                <span className="font-medium">
                  {gap.metric}:{' '}
                  <span className="tabular-nums">{DELTA_FORMATTER.format(gap.delta)}</span>
                </span>{' '}
                <span className="text-[var(--color-muted-foreground)]">
                  measured on {gap.measuredOn}. The difference between a score produced through this
                  method and the same model scored in the clear.
                </span>
              </>
            ) : (
              <>
                <span className="font-medium">Not yet measured.</span>{' '}
                <span className="text-[var(--color-muted-foreground)]">
                  The fidelity gap is the difference between a score produced through this method
                  and the same model scored in the clear; it is reported once measured.
                </span>
              </>
            )}
          </DefinitionItem>
        </DefinitionList>
      </CardContent>
    </Card>
  );
}

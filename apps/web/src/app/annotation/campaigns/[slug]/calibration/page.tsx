import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Session } from 'next-auth';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Container,
  DefinitionItem,
  DefinitionList,
  Section,
} from '@oci/ui';
import type {
  AnnotatorQualitySummary,
  CalibrationFlag,
  CalibrationFlagType,
  CalibrationMetricKind,
  CampaignDetail,
  ListCalibrationFlagsResponse,
} from '@oci/shared-types';
import { auth } from '../../../../../auth';
import { ApiError, apiFetch } from '../../../../../lib/api';

const FLAG_TYPE_LABEL: Record<CalibrationFlagType, string> = {
  SKILL: 'Skill',
  DRIFT: 'Drift',
};

const FLAG_TYPE_HINT: Record<CalibrationFlagType, string> = {
  SKILL: 'Below peers or gold standard',
  DRIFT: 'Below own baseline',
};

const METRIC_LABEL: Record<CalibrationMetricKind, string> = {
  'vs-gold': 'vs gold',
  'vs-peers': 'vs peers',
  'vs-self': 'vs self',
};

const dateFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const scoreFmt = (n: number) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Annotators are shown pseudonymously (#554): identity rules are still
 * open in #312, so names are never resolved here.
 */
function pseudonym(userId: string): string {
  return userId.slice(0, 8);
}

interface PageProps {
  params: Promise<{ slug: string }>;
  /**
   * `?flag=<flagId>` selects a row. The flag id, not the annotator's
   * user id, goes in the URL so it never lands in history or access
   * logs; the annotator is resolved server-side from the loaded flags.
   */
  searchParams: Promise<{ flag?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  return {
    title: `Calibration — ${slug} — Annotation campaigns`,
    robots: { index: false, follow: false },
  };
}

// Raw API errors (internal path + response body) are never rendered;
// the API logs the detail with a correlation id.
type FlagsResult =
  | { kind: 'ok'; items: CalibrationFlag[] }
  | { kind: 'forbidden' }
  | { kind: 'error' };

async function loadFlags(slug: string, session: Session): Promise<FlagsResult | null> {
  try {
    const res = await apiFetch<ListCalibrationFlagsResponse>(
      `/v2/annotation/campaigns/${encodeURIComponent(slug)}/calibration/flags`,
      { session, revalidate: 0 },
    );
    if (!res) return null;
    return { kind: 'ok', items: res.items };
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return { kind: 'forbidden' };
    return { kind: 'error' };
  }
}

/**
 * Supervisor inbox for calibration flags (#554, ADR-0009 Decision 4).
 * Lists ACTIVE flags newest-first; selecting a flag loads that
 * annotator's quality summary server-side via `?flag=`.
 */
export default async function CalibrationFlagsPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { flag } = await searchParams;
  const session = await auth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/annotation/campaigns/${slug}/calibration`)}`,
    );
  }

  const detail = await apiFetch<CampaignDetail>(
    `/v2/annotation/campaigns/${encodeURIComponent(slug)}`,
    { session, revalidate: 0 },
  );
  if (!detail) notFound();

  const flags = await loadFlags(detail.slug, session);
  if (!flags) notFound();

  return (
    <Container size="md">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href={`/annotation/campaigns/${detail.slug}`}
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>{detail.name}</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Annotation campaign
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Calibration flags</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            Annotators whose agreement has dropped below this campaign&apos;s threshold. Annotators
            are shown by a short pseudonymous id.
          </p>
        </header>

        {flags.kind === 'forbidden' ? (
          <Alert tone="warning">
            <AlertTitle as="h2">You don&apos;t have access to calibration flags</AlertTitle>
            <AlertDescription>
              Only task supervisors and campaign managers can review calibration flags for this
              campaign.
            </AlertDescription>
          </Alert>
        ) : flags.kind === 'error' ? (
          <Alert tone="danger">
            <AlertTitle as="h2">Could not load calibration flags</AlertTitle>
            <AlertDescription>
              Something went wrong on our side. Please try again in a moment.
            </AlertDescription>
          </Alert>
        ) : (
          <FlagsInbox
            slug={detail.slug}
            flags={flags.items}
            selected={typeof flag === 'string' ? flag : undefined}
            session={session}
          />
        )}
      </Section>
    </Container>
  );
}

async function FlagsInbox({
  slug,
  flags,
  selected,
  session,
}: {
  slug: string;
  flags: CalibrationFlag[];
  selected: string | undefined;
  session: Session;
}) {
  if (flags.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-[var(--color-muted-foreground)]">
          No active calibration flags for this campaign.
        </CardContent>
      </Card>
    );
  }

  // The API already orders newest-first; sort again so the page doesn't
  // depend on it.
  const rows = [...flags].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Selection is by flag id and must match a loaded ACTIVE flag, so the
  // inbox never becomes a lookup for arbitrary users.
  const selectedFlag =
    selected && UUID_RE.test(selected) ? rows.find((f) => f.id === selected) : undefined;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Active flags</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            // Scrollable on narrow screens; focusable so keyboard users
            // can scroll it (axe `scrollable-region-focusable`).
            tabIndex={0}
            role="region"
            aria-label="Active calibration flags"
            className="overflow-x-auto rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">
                Active calibration flags, newest first. Select an annotator to see their quality
                summary.
              </caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-start text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  <th scope="col" className="py-2 pe-4 text-start font-medium">
                    Annotator
                  </th>
                  <th scope="col" className="py-2 pe-4 text-start font-medium">
                    Flag
                  </th>
                  <th scope="col" className="py-2 pe-4 text-start font-medium">
                    Metric
                  </th>
                  <th scope="col" className="py-2 pe-4 text-end font-medium">
                    Score / threshold
                  </th>
                  <th scope="col" className="py-2 pe-4 text-end font-medium">
                    Samples
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    Raised
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => {
                  const isSelected = f.id === selectedFlag?.id;
                  return (
                    <tr
                      key={f.id}
                      className={
                        'border-b border-[var(--color-border)] last:border-b-0 ' +
                        (isSelected ? 'bg-[var(--color-primary-soft)]/40' : '')
                      }
                    >
                      <td className="py-2 pe-4">
                        <Link
                          href={`/annotation/campaigns/${slug}/calibration?flag=${f.id}`}
                          aria-current={isSelected ? 'true' : undefined}
                          aria-label={`Annotator ${pseudonym(f.annotatorUserId)}: show quality summary`}
                          className="font-mono text-xs text-[var(--color-primary)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
                        >
                          {pseudonym(f.annotatorUserId)}
                        </Link>
                      </td>
                      <td className="py-2 pe-4">
                        <Badge tone={f.flagType === 'SKILL' ? 'danger' : 'warning'}>
                          {FLAG_TYPE_LABEL[f.flagType]}
                        </Badge>
                        <span className="sr-only">: {FLAG_TYPE_HINT[f.flagType]}</span>
                      </td>
                      <td className="py-2 pe-4 whitespace-nowrap">{METRIC_LABEL[f.metric]}</td>
                      <td className="py-2 pe-4 text-end tabular-nums whitespace-nowrap">
                        {scoreFmt(f.score)} &lt; {scoreFmt(f.threshold)}
                      </td>
                      <td className="py-2 pe-4 text-end tabular-nums">
                        {f.sampleSize.toLocaleString('en-GB')}
                      </td>
                      <td className="py-2 whitespace-nowrap text-xs text-[var(--color-muted-foreground)]">
                        <time dateTime={f.createdAt}>{dateFmt.format(new Date(f.createdAt))}</time>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
            Skill: below peers or the gold standard. Drift: below the annotator&apos;s own baseline.
          </p>
        </CardContent>
      </Card>

      {selectedFlag ? <QualityPanel slug={slug} flag={selectedFlag} session={session} /> : null}
    </div>
  );
}

async function QualityPanel({
  slug,
  flag,
  session,
}: {
  slug: string;
  flag: CalibrationFlag;
  session: Session;
}) {
  const userId = flag.annotatorUserId;
  let summary: AnnotatorQualitySummary | null = null;
  let failed = false;
  try {
    summary = await apiFetch<AnnotatorQualitySummary>(
      `/v2/annotation/campaigns/${encodeURIComponent(slug)}/annotators/${userId}/quality`,
      { session, revalidate: 0 },
    );
  } catch {
    // Raw API error detail is not rendered (see FlagsResult).
    failed = true;
  }

  return (
    <Card id="annotator-quality">
      <CardHeader>
        <CardTitle as="h2">
          Quality summary — <span className="font-mono">{pseudonym(userId)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/*
          The summary endpoint only scores against gold, whatever the
          flag's metric. Restating the selected flag keeps a DRIFT or
          vs-peers flag from reading as contradicted by a passing gold score.
        */}
        <DefinitionList>
          <DefinitionItem term="Selected flag">
            <span className="tabular-nums">
              {FLAG_TYPE_LABEL[flag.flagType]} · {METRIC_LABEL[flag.metric]} ·{' '}
              {scoreFmt(flag.score)} &lt; {scoreFmt(flag.threshold)}
            </span>
          </DefinitionItem>
          {summary ? (
            <>
              <DefinitionItem term="Agreement with gold standard">
                <span className="tabular-nums">
                  {summary.irrAgainstGold === null
                    ? 'Not scored yet'
                    : `${scoreFmt(summary.irrAgainstGold)} (threshold ${scoreFmt(summary.threshold)})`}
                </span>
              </DefinitionItem>
              <DefinitionItem term="Gold samples scored">
                <span className="tabular-nums">
                  {summary.goldSamplesScored.toLocaleString('en-GB')} of{' '}
                  {summary.goldSamplesTotal.toLocaleString('en-GB')}
                </span>
              </DefinitionItem>
              <DefinitionItem term="Metric" mono>
                {summary.metric}
              </DefinitionItem>
            </>
          ) : null}
        </DefinitionList>
        {failed ? (
          <Alert tone="danger">
            <AlertTitle as="h3">Could not load the quality summary</AlertTitle>
            <AlertDescription>
              Something went wrong on our side. Please try again in a moment.
            </AlertDescription>
          </Alert>
        ) : !summary ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No quality summary is available for this annotator.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

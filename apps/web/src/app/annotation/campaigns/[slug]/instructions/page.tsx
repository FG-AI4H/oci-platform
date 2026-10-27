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
  Section,
} from '@oci/ui';
import type {
  CampaignDetail,
  CampaignInstructions,
  FetchInstructionsResponse,
} from '@oci/shared-types';
import { auth } from '../../../../../auth';
import { apiFetch } from '../../../../../lib/api';
import { isCampaignManager } from '../../../../../lib/groups';
import { InstructionsContent } from './instructions-content';
import { InstructionsEditor } from './instructions-editor';

const dateFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** Versions are a hex slice of the body's sha256. */
const VERSION_RE = /^[0-9a-f]{1,64}$/i;

const focusRing =
  'rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

interface PageProps {
  params: Promise<{ slug: string }>;
  /** `?version=<version>` shows an older version from the history. */
  searchParams: Promise<{ version?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  return {
    title: `Instructions — ${slug} — Annotation campaigns`,
    robots: { index: false, follow: false },
  };
}

async function loadInstructions(
  slug: string,
  session: Session,
): Promise<FetchInstructionsResponse | null | 'error'> {
  try {
    return await apiFetch<FetchInstructionsResponse>(
      `/v2/annotation/campaigns/${encodeURIComponent(slug)}/instructions`,
      { session, revalidate: 0 },
    );
  } catch {
    // The API logs the detail with a correlation id; don't render it.
    return 'error';
  }
}

/**
 * Campaign instructions (#555). Everyone signed in reads the current
 * version and the history; campaign managers also get the editor,
 * which publishes a new version through a server action.
 */
export default async function CampaignInstructionsPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { version } = await searchParams;
  const session = await auth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/annotation/campaigns/${slug}/instructions`)}`,
    );
  }

  const detail = await apiFetch<CampaignDetail>(
    `/v2/annotation/campaigns/${encodeURIComponent(slug)}`,
    { session, revalidate: 0 },
  );
  if (!detail) notFound();

  const data = await loadInstructions(detail.slug, session);
  if (data === null) notFound();
  const canEdit = isCampaignManager(session);
  const base = `/annotation/campaigns/${detail.slug}/instructions`;

  const requested =
    data !== 'error' && typeof version === 'string' && VERSION_RE.test(version)
      ? data.history.find((h) => h.version === version)
      : undefined;
  const shown = data === 'error' ? null : (requested ?? data.current);

  return (
    <Container size="md">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href={`/annotation/campaigns/${detail.slug}`}
            className={`inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] ${focusRing}`}
          >
            <ArrowLeftIcon size={14} />
            <span>{detail.name}</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Annotation campaign
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Instructions</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            What annotators should do on this campaign. Each publish creates a new version; earlier
            versions stay in the history.
          </p>
        </header>

        {data === 'error' ? (
          <Alert tone="danger">
            <AlertTitle as="h2">Could not load the instructions</AlertTitle>
            <AlertDescription>
              Something went wrong on our side. Please try again in a moment.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <VersionCard shown={shown} currentHref={base} canEdit={canEdit} />

            {data.history.length > 0 ? (
              <HistoryCard history={data.history} shownVersion={shown?.version} base={base} />
            ) : null}

            {canEdit ? (
              <Card>
                <CardHeader>
                  <CardTitle as="h2">Publish instructions</CardTitle>
                </CardHeader>
                <CardContent>
                  <InstructionsEditor
                    slug={detail.slug}
                    // The campaign's pointer, not `data.current`: the
                    // pointer is what the API compares `baseVersion` to.
                    currentVersion={detail.currentInstructionsVersion}
                    initialValues={{
                      markdownBody: data.current?.markdownBody ?? '',
                      media: (data.current?.mediaUrls ?? []).map((m) => ({
                        url: m.url,
                        kind: m.kind,
                        caption: m.caption ?? '',
                      })),
                    }}
                  />
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </Section>
    </Container>
  );
}

function VersionCard({
  shown,
  currentHref,
  canEdit,
}: {
  shown: CampaignInstructions | null;
  currentHref: string;
  canEdit: boolean;
}) {
  if (!shown) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-[var(--color-muted-foreground)]">
          No instructions have been published for this campaign yet.
          {canEdit ? ' Use the editor below to publish the first version.' : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle as="h2">
            {shown.isCurrent ? 'Current version' : 'Superseded version'}{' '}
            <span className="font-mono text-base font-normal">{shown.version}</span>
          </CardTitle>
          <Badge tone={shown.isCurrent ? 'success' : 'warning'}>
            {shown.isCurrent ? 'Current' : 'Superseded'}
          </Badge>
        </div>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Published{' '}
          <time dateTime={shown.createdAt}>{dateFmt.format(new Date(shown.createdAt))}</time>
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {shown.isCurrent ? null : (
          <Alert tone="warning">
            <AlertTitle as="h3">Superseded</AlertTitle>
            <AlertDescription>
              This version is no longer in effect.{' '}
              <Link href={currentHref} className={`underline underline-offset-2 ${focusRing}`}>
                View the current version
              </Link>
            </AlertDescription>
          </Alert>
        )}
        <InstructionsContent markdownBody={shown.markdownBody} mediaUrls={shown.mediaUrls} />
      </CardContent>
    </Card>
  );
}

function HistoryCard({
  history,
  shownVersion,
  base,
}: {
  history: CampaignInstructions[];
  shownVersion: string | undefined;
  base: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Version history</CardTitle>
      </CardHeader>
      <CardContent>
        <ol
          className="divide-y divide-[var(--color-border)]"
          aria-label="Published versions, newest first"
        >
          {history.map((h) => {
            const isShown = h.version === shownVersion;
            return (
              <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Link
                  href={h.isCurrent ? base : `${base}?version=${h.version}`}
                  aria-current={isShown ? 'page' : undefined}
                  className={`font-mono text-sm text-[var(--color-primary)] underline-offset-2 hover:underline ${focusRing}`}
                >
                  {h.version}
                </Link>
                <Badge tone={h.isCurrent ? 'success' : 'neutral'}>
                  {h.isCurrent ? 'Current' : 'Superseded'}
                </Badge>
                {isShown ? (
                  <span className="text-xs text-[var(--color-muted-foreground)]">Shown above</span>
                ) : null}
                <time
                  dateTime={h.createdAt}
                  className="ms-auto text-xs text-[var(--color-muted-foreground)]"
                >
                  {dateFmt.format(new Date(h.createdAt))}
                </time>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

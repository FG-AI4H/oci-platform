import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
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
import {
  type AnnotationGateState,
  type AssignmentSummary,
  type CampaignDetail,
  type PullNextResponse,
} from '@oci/shared-types';
import { auth } from '../../../../../auth';
import { apiFetch } from '../../../../../lib/api';
import { annotationGateForCaller } from '../../../../../lib/groups';
import { AnnotateForm } from './annotate-form';

const GATE_LABEL: Record<AnnotationGateState, string> = {
  INDEPENDENT: 'Independent annotation',
  AWAITING_ARBITRATION: 'Arbitration',
  AWAITING_EXPERT: 'Expert review',
  COMPLETED: 'Completed',
  SKIPPED: 'Skipped',
};

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  return {
    title: `Annotate · ${slug}`,
    robots: { index: false, follow: false },
  };
}

export default async function AnnotatePage({ params }: PageProps) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user) redirect('/');

  const gate = annotationGateForCaller(session);
  if (!gate) {
    // No annotation role — bounce to the campaign detail page where
    // the caller can see what the campaign is and request a role
    // through their manager.
    redirect(`/annotation/campaigns/${slug}`);
  }

  const detail = await apiFetch<CampaignDetail>(
    `/v2/annotation/campaigns/${encodeURIComponent(slug)}`,
    { session, revalidate: 0 },
  );
  if (!detail) notFound();

  // Probe for an in-flight assignment via the idempotent pull-next
  // endpoint. The API returns either the caller's existing in-flight
  // assignment or creates a new one — both routes land here. When
  // there's nothing to do, `assignment: null` and we render the
  // empty state.
  let assignment: AssignmentSummary | null = null;
  let pullError: string | null = null;
  if (detail.status === 'RUNNING') {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (!base) {
      pullError = 'NEXT_PUBLIC_API_BASE_URL not set in web env.';
    } else {
      const res = await fetch(
        `${base}/v2/annotation/campaigns/${encodeURIComponent(slug)}/tasks/next`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.accessToken ?? ''}` },
          cache: 'no-store',
        },
      );
      if (res.ok) {
        const body = (await res.json()) as PullNextResponse;
        assignment = body.assignment;
      } else {
        pullError = `API ${res.status} ${res.statusText}`;
      }
    }
  }

  return (
    <Container size="md">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href={`/annotation/campaigns/${detail.slug}`}
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>Back to campaign</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Annotator queue
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{detail.name}</h1>
            {/* eslint-disable-next-line security/detect-object-injection -- typed enum key */}
            <Badge tone="info">{GATE_LABEL[gate]}</Badge>
          </div>
          <p className="font-mono text-sm text-[var(--color-muted-foreground)]">{detail.slug}</p>
        </header>

        {detail.status !== 'RUNNING' ? (
          <Card>
            <CardHeader>
              <CardTitle>Queue paused</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                This campaign is <code className="text-xs">{detail.status}</code>. Annotators only
                pick up work while the campaign is RUNNING. Ask the campaign manager when it&apos;s
                expected to resume.
              </p>
            </CardContent>
          </Card>
        ) : pullError ? (
          <Card>
            <CardHeader>
              <CardTitle>Couldn&apos;t reach the queue</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{pullError}</p>
            </CardContent>
          </Card>
        ) : assignment ? (
          <Card>
            <CardHeader>
              <CardTitle>Your current task</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <DefinitionList>
                <DefinitionItem term="Sample" mono>
                  {assignment.sampleRef}
                </DefinitionItem>
                <DefinitionItem term="Gate">
                  {GATE_LABEL[assignment.gateAtAssignment]}
                </DefinitionItem>
                <DefinitionItem term="Role">{assignment.assigneeRole}</DefinitionItem>
                <DefinitionItem term="Assigned">
                  <time dateTime={assignment.assignedAt}>
                    {new Intl.DateTimeFormat('en-GB', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(assignment.assignedAt))}
                  </time>
                </DefinitionItem>
              </DefinitionList>
              <AnnotateForm slug={detail.slug} assignment={assignment} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>All caught up</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                No tasks are eligible for you at the{' '}
                {/* eslint-disable-next-line security/detect-object-injection -- typed enum key */}
                {GATE_LABEL[gate].toLowerCase()} gate right now. Check back later — new tasks land
                here when the campaign manager seeds them or when a previous gate completes.
              </p>
            </CardContent>
          </Card>
        )}
      </Section>
    </Container>
  );
}

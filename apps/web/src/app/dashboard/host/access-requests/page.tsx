import Link from 'next/link';
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import type { AccessRequestStatus, AccessRequestSummary } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { apiFetch } from '../../../../lib/api';
import { requireHost } from '../../../../lib/groups';
import { DecisionForm } from './decision-form';

export const metadata = {
  title: 'Access requests inbox — OCI Platform',
  robots: { index: false, follow: false },
};

const statusTone: Record<AccessRequestStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  PENDING: 'info',
  APPROVED: 'success',
  DENIED: 'danger',
  REVOKED: 'neutral',
};

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export default async function HostAccessRequestsInbox() {
  const session = await auth();
  requireHost(session);

  let items: AccessRequestSummary[] | null = null;
  let error: string | null = null;
  try {
    items = await apiFetch<AccessRequestSummary[]>('/v2/me/host/access-requests', {
      session,
      revalidate: 0,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach catalog API';
  }

  // The API sorts PENDING first; preserve that for the visual stack
  // even when we group below — host scans top-down.
  const pending = items?.filter((r) => r.status === 'PENDING') ?? [];
  const decided = items?.filter((r) => r.status !== 'PENDING') ?? [];

  return (
    <Container size="lg">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Host workflow
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Access requests inbox
          </h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            Decide who gets access to your RESTRICTED datasets. Decisions are recorded with a
            timestamp + your note for the audit trail.
          </p>
        </header>

        {error ? (
          <Alert tone="danger">
            <AlertTitle>Could not load inbox</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        ) : (items?.length ?? 0) === 0 ? (
          <Card tone="subtle">
            <CardHeader>
              <CardTitle>Inbox empty</CardTitle>
              <CardDescription>
                No requests for datasets you host. They&apos;ll show up here when participants
                submit them.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-8">
            {pending.length > 0 ? (
              <section>
                <h2 className="mb-3 text-lg font-semibold tracking-tight">
                  Pending ({pending.length})
                </h2>
                <ul className="space-y-3">
                  {pending.map((req) => (
                    <li key={req.id}>
                      <RequestRow req={req} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {decided.length > 0 ? (
              <section>
                <h2 className="mb-3 text-lg font-semibold tracking-tight">
                  Decided ({decided.length})
                </h2>
                <ul className="space-y-3">
                  {decided.map((req) => (
                    <li key={req.id}>
                      <RequestRow req={req} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </Section>
    </Container>
  );
}

function RequestRow({ req }: { req: AccessRequestSummary }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle>
              <Link
                className="hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
                href={`/catalog/${req.dataset.slug}`}
              >
                {req.dataset.name}
              </Link>
            </CardTitle>
            <CardDescription>
              <span className="font-mono text-xs">{req.dataset.slug}</span>
              {' · requester '}
              <span className="font-mono text-xs">{req.requesterId}</span>
              {' · submitted '}
              <time dateTime={req.createdAt}>{DATE_FORMATTER.format(new Date(req.createdAt))}</time>
            </CardDescription>
          </div>
          <Badge tone={statusTone[req.status]}>{req.status.toLowerCase()}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <DefinitionList>
          <DefinitionItem term="Justification">
            <p className="whitespace-pre-wrap">{req.justification}</p>
          </DefinitionItem>
          <DefinitionItem term="IRB">
            {req.attestations.irbApproved ? (
              <Badge tone="success">approved</Badge>
            ) : (
              <Badge tone="warning">not declared</Badge>
            )}
            {req.attestations.irbApprovalRef ? (
              <span className="ms-2 font-mono text-xs">{req.attestations.irbApprovalRef}</span>
            ) : null}
          </DefinitionItem>
          {req.attestations.dpiaRef ? (
            <DefinitionItem term="DPIA">
              <span className="font-mono text-xs">{req.attestations.dpiaRef}</span>
            </DefinitionItem>
          ) : null}
          {req.attestations.dataRetentionDays ? (
            <DefinitionItem term="Retention">
              {req.attestations.dataRetentionDays} days
            </DefinitionItem>
          ) : null}
          {req.attestations.duoConsent && req.attestations.duoConsent.length > 0 ? (
            <DefinitionItem term="DUO consent">
              <ul className="space-y-0.5 font-mono text-xs">
                {req.attestations.duoConsent.map((iri, i) => (
                  <li key={i}>{iri}</li>
                ))}
              </ul>
            </DefinitionItem>
          ) : null}
          {req.decisionNote ? (
            <DefinitionItem term="Decision note">
              <p className="whitespace-pre-wrap">{req.decisionNote}</p>
            </DefinitionItem>
          ) : null}
        </DefinitionList>

        <DecisionForm id={req.id} currentStatus={req.status} />
      </CardContent>
    </Card>
  );
}

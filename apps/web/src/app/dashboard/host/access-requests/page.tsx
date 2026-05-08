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
import type {
  AccessRequestMatchStatus,
  AccessRequestStatus,
  AccessRequestSummary,
} from '@oci/shared-types';
import { lookupDuoTerm } from '@oci/croissant';
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

const matchTone: Record<AccessRequestMatchStatus, 'success' | 'danger' | 'warning'> = {
  MATCHED: 'success',
  CONFLICT: 'danger',
  UNCLEAR: 'warning',
};

const matchLabel: Record<AccessRequestMatchStatus, string> = {
  MATCHED: 'auto-match: matched',
  CONFLICT: 'auto-match: conflict',
  UNCLEAR: 'auto-match: needs review',
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
  const a = req.attestations;
  // Old (v0) rows persisted before PR J.1 don't have v=1 fields. Render
  // gracefully — `projectTitle` falls back to the legacy `justification`,
  // structured fields just don't appear.
  const isV1 = a && (a as { v?: unknown }).v === 1;
  const title = isV1 ? a.projectTitle : req.dataset.name;
  const description = isV1 ? a.projectDescription : req.justification;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>
              <Link
                className="font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
                href={`/catalog/${req.dataset.slug}`}
              >
                {req.dataset.name}
              </Link>
              <span className="ms-2 font-mono text-xs">{req.dataset.slug}</span>
              <span className="ms-2"> · requester </span>
              <span className="font-mono text-xs">{req.requesterId}</span>
              <span className="ms-2"> · submitted </span>
              <time dateTime={req.createdAt}>{DATE_FORMATTER.format(new Date(req.createdAt))}</time>
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge tone={statusTone[req.status]}>{req.status.toLowerCase()}</Badge>
            {req.matchStatus ? (
              <Badge tone={matchTone[req.matchStatus]}>{matchLabel[req.matchStatus]}</Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Matcher findings — surfaced verbatim so a host who isn't fluent
            in DUO can act on the request without clicking through. */}
        {req.matchExplanations && req.matchExplanations.length > 0 ? (
          <Alert tone={req.matchStatus === 'CONFLICT' ? 'danger' : 'info'}>
            <AlertTitle as="h3">Why the matcher flagged this</AlertTitle>
            <AlertDescription>
              <ul className="ms-4 list-disc space-y-1 text-sm">
                {req.matchExplanations.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <DefinitionList>
          <DefinitionItem term="Description">
            <p className="whitespace-pre-wrap">{description}</p>
          </DefinitionItem>

          {isV1 ? (
            <>
              <DefinitionItem term="Institution">{a.institution}</DefinitionItem>
              <DefinitionItem term="Intended use">
                <Badge tone="info">{humanIntent(a.intendedUseCategory)}</Badge>
              </DefinitionItem>
              {a.intendedUseDuoTerms.length > 0 ? (
                <DefinitionItem term="Requester's DUO terms">
                  <ul className="space-y-1">
                    {a.intendedUseDuoTerms.map((id) => {
                      const t = lookupDuoTerm(id);
                      return (
                        <li key={id} className="flex items-start gap-2 text-sm">
                          <Badge tone="neutral" className="font-mono">
                            {t?.code ?? id}
                          </Badge>
                          <span>{t?.label ?? '(unknown term)'}</span>
                        </li>
                      );
                    })}
                  </ul>
                </DefinitionItem>
              ) : null}
              {req.dataset.duoTerms && req.dataset.duoTerms.length > 0 ? (
                <DefinitionItem term="Dataset's DUO terms">
                  <ul className="space-y-1">
                    {req.dataset.duoTerms.map((id) => {
                      const t = lookupDuoTerm(id);
                      return (
                        <li key={id} className="flex items-start gap-2 text-sm">
                          <Badge tone="info" className="font-mono">
                            {t?.code ?? id}
                          </Badge>
                          <span>{t?.label ?? '(unknown term)'}</span>
                        </li>
                      );
                    })}
                  </ul>
                </DefinitionItem>
              ) : null}
              <DefinitionItem term="IRB">
                {a.irbApproved ? (
                  <Badge tone="success">approved</Badge>
                ) : (
                  <Badge tone="warning">not declared</Badge>
                )}
                {a.irbApprovalRef ? (
                  <span className="ms-2 font-mono text-xs">{a.irbApprovalRef}</span>
                ) : null}
              </DefinitionItem>
              {a.dpiaRef ? (
                <DefinitionItem term="DPIA">
                  <span className="font-mono text-xs">{a.dpiaRef}</span>
                </DefinitionItem>
              ) : null}
              <DefinitionItem term="Retention">{a.dataRetentionDays} days</DefinitionItem>
              <DefinitionItem term="Redistribution">
                {humanRedist(a.redistributionIntent)}
              </DefinitionItem>
              <DefinitionItem term="Output type">{humanOutput(a.outputType)}</DefinitionItem>
            </>
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

function humanIntent(c: string): string {
  switch (c) {
    case 'NON_COMMERCIAL_RESEARCH':
      return 'Non-commercial research';
    case 'COMMERCIAL_RESEARCH':
      return 'Commercial research';
    case 'CLINICAL_CARE':
      return 'Clinical care';
    case 'EDUCATION':
      return 'Education';
    default:
      return c;
  }
}

function humanRedist(c: string): string {
  switch (c) {
    case 'NONE':
      return 'No redistribution';
    case 'DERIVATIVES_ONLY':
      return 'Derivatives only';
    case 'WITH_PERMISSION':
      return 'With explicit permission per request';
    default:
      return c;
  }
}

function humanOutput(c: string): string {
  switch (c) {
    case 'PUBLICATION':
      return 'Peer-reviewed publication';
    case 'MODEL_WEIGHTS':
      return 'Model weights';
    case 'DERIVATIVE_DATASET':
      return 'Derivative dataset';
    case 'INTERNAL_USE':
      return 'Internal report / no external output';
    default:
      return c;
  }
}

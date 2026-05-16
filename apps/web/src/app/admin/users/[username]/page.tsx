import Link from 'next/link';
import { notFound } from 'next/navigation';
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
import { type AdminUserDetail, type PlatformGroup, PlatformGroupSchema } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { apiFetch } from '../../../../lib/api';
import { requireAdmin, userSub } from '../../../../lib/groups';
import { GroupToggleForm } from './group-toggle-form';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'User detail — OCI Admin',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ username: string }>;
}

const ALL_GROUPS: ReadonlyArray<PlatformGroup> = PlatformGroupSchema.options;

const GROUP_HINT: Record<PlatformGroup, string> = {
  admin: 'Operator override — full access; assign sparingly.',
  host: 'Can publish datasets and approve access requests.',
  'campaign-manager': 'Can create + manage annotation campaigns (ADR-0006).',
  'task-supervisor': 'Reviews annotation rejections (ADR-0011).',
  reviewer: 'Performs gate-2 review during annotation.',
  'arbitration-annotator': 'Resolves disagreements during arbitration (ADR-0009).',
  'expert-reviewer': 'Gate-3 expert review (ADR-0006).',
  annotator: 'Performs gate-1 annotation work.',
  supervisor: 'Regulatory supervisor — read-only audit access.',
  regulator: 'Regulator portal access (Phase D).',
  participant: 'Default authenticated viewer; no special permissions.',
};

export default async function AdminUserDetailPage({ params }: PageProps) {
  const { username } = await params;
  const session = await auth();
  requireAdmin(session);

  const detail = await apiFetch<AdminUserDetail>(
    `/v2/admin/users/${encodeURIComponent(username)}`,
    { session, revalidate: 0 },
  );
  if (!detail) notFound();

  const dateFmt = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const currentGroups = new Set<PlatformGroup>(detail.groups);
  // `userSub()` returns the JWT `sub` in prod and the dev sentinel's
  // user segment locally — both of which match the API's
  // `AdminUserSummary.sub` / `.username`.
  const mySub = userSub(session);
  const isSelf = mySub !== null && (mySub === detail.sub || mySub === detail.username);

  return (
    <Container size="md">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href="/admin/users"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>Users</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            User detail
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{detail.username}</h1>
            <Badge tone={detail.status === 'CONFIRMED' ? 'success' : 'warning'}>
              {detail.status.toLowerCase()}
            </Badge>
          </div>
          {detail.email ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">{detail.email}</p>
          ) : null}
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Principal</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term="Subject" mono>
                  {detail.sub}
                </DefinitionItem>
                <DefinitionItem term="Email verified">
                  {detail.emailVerified ? 'yes' : 'no'}
                </DefinitionItem>
                <DefinitionItem term="Created">
                  <time dateTime={detail.createdAt}>
                    {dateFmt.format(new Date(detail.createdAt))}
                  </time>
                </DefinitionItem>
                <DefinitionItem term="Last seen">
                  {detail.lastSeen ? (
                    <time dateTime={detail.lastSeen}>
                      {dateFmt.format(new Date(detail.lastSeen))}
                    </time>
                  ) : (
                    <span className="italic text-[var(--color-muted-foreground)]">—</span>
                  )}
                </DefinitionItem>
              </DefinitionList>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Current groups</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.groups.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">No groups assigned.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {detail.groups.map((g) => (
                    <li key={g}>
                      <Badge tone="primary">{g}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Group membership</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-[var(--color-muted-foreground)]">
              Toggle to grant or revoke. Each change writes an audit row.
            </p>
            <ul className="divide-y divide-[var(--color-border)]">
              {ALL_GROUPS.map((g) => {
                const selfDemotingAdmin = isSelf && g === 'admin' && currentGroups.has(g);
                return (
                  <li key={g}>
                    <div className="flex flex-col gap-1">
                      <GroupToggleForm
                        username={detail.username}
                        group={g}
                        initiallyChecked={currentGroups.has(g)}
                        disabled={selfDemotingAdmin}
                        disabledReason={
                          selfDemotingAdmin
                            ? 'You cannot revoke your own admin group; have another admin do it.'
                            : undefined
                        }
                      />
                      <p className="text-xs text-[var(--color-muted-foreground)] pl-7">
                        {/* eslint-disable-next-line security/detect-object-injection -- typed enum keys */}
                        {GROUP_HINT[g]}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Recent group changes</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.recentAuditEvents.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                No group-change history for this user yet.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)] text-sm">
                {detail.recentAuditEvents.map((e) => (
                  <li key={e.id} className="flex items-baseline justify-between gap-3 py-2">
                    <span>
                      <Badge tone={e.action === 'grant' ? 'success' : 'warning'}>{e.action}</Badge>{' '}
                      <code className="text-xs">{e.group}</code>{' '}
                      <span className="text-[var(--color-muted-foreground)]">by</span>{' '}
                      <span className="font-medium">{e.actorUsername}</span>
                    </span>
                    <time
                      dateTime={e.timestamp}
                      className="text-xs text-[var(--color-muted-foreground)] tabular-nums"
                    >
                      {dateFmt.format(new Date(e.timestamp))}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}

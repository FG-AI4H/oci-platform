import Link from 'next/link';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Badge,
  Container,
  Input,
  SearchIcon,
  Section,
} from '@oci/ui';
import type { AdminUserSummary, ListAdminUsersResponse, PlatformGroup } from '@oci/shared-types';
import { auth } from '../../../auth';
import { apiFetch } from '../../../lib/api';
import { requireAdmin } from '../../../lib/groups';

export const metadata = {
  title: 'Users — OCI Admin',
  robots: { index: false, follow: false },
};

interface SearchParams {
  q?: string;
}

const GROUP_TONE: Partial<
  Record<PlatformGroup, 'danger' | 'warning' | 'primary' | 'info' | 'neutral'>
> = {
  admin: 'danger',
  regulator: 'warning',
  supervisor: 'warning',
  'task-supervisor': 'warning',
  'campaign-manager': 'primary',
  host: 'primary',
  reviewer: 'primary',
  'expert-reviewer': 'primary',
  'arbitration-annotator': 'info',
  annotator: 'info',
  participant: 'neutral',
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  requireAdmin(session);
  const params = await searchParams;

  const qs = new URLSearchParams();
  qs.set('limit', '50');
  if (params.q && params.q.length > 0) qs.set('search', params.q);

  let response: ListAdminUsersResponse | null = null;
  let error: string | null = null;
  try {
    response = await apiFetch<ListAdminUsersResponse>(`/v2/admin/users?${qs.toString()}`, {
      session,
      revalidate: 0,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach the admin API';
  }

  return (
    <Container size="md">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>Admin</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            User &amp; group management
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Users</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            Cognito principals in this user pool. Click a row to view detail and adjust group
            membership.
          </p>
        </header>

        <form
          action="/admin/users"
          method="get"
          role="search"
          className="mb-4 flex flex-wrap gap-2"
        >
          <label htmlFor="admin-user-search" className="sr-only">
            Search users
          </label>
          <Input
            id="admin-user-search"
            type="search"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Username or email prefix (e.g. alice, bob@)"
            leadingIcon={<SearchIcon size={16} />}
            className="min-w-0 flex-1"
          />
        </form>

        {error ? (
          <Alert tone="danger">
            <AlertTitle>Users unavailable</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        ) : !response || response.items.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--color-subtle)] text-left text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Username
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Groups
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {response.items.map((u) => (
                  <UserRow key={u.sub} u={u} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </Container>
  );
}

function UserRow({ u }: { u: AdminUserSummary }) {
  return (
    <tr className="border-t border-[var(--color-border)] hover:bg-[var(--color-subtle)]/60 transition-colors">
      <td className="px-4 py-2">
        <Link
          href={`/admin/users/${encodeURIComponent(u.username)}`}
          className="font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
        >
          {u.username}
        </Link>
      </td>
      <td className="px-4 py-2 text-[var(--color-muted-foreground)]">
        {u.email ?? <span className="italic">—</span>}
      </td>
      <td className="px-4 py-2">
        {u.groups.length === 0 ? (
          <span className="text-xs text-[var(--color-muted-foreground)]">None</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {u.groups.map((g) => (
              <Badge
                key={g}
                // eslint-disable-next-line security/detect-object-injection -- typed enum keys
                tone={GROUP_TONE[g] ?? 'neutral'}
              >
                {g}
              </Badge>
            ))}
          </span>
        )}
      </td>
      <td className="px-4 py-2">
        <Badge tone={statusTone(u.status)}>{u.status.toLowerCase()}</Badge>
      </td>
    </tr>
  );
}

function statusTone(s: AdminUserSummary['status']): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (s) {
    case 'CONFIRMED':
      return 'success';
    case 'COMPROMISED':
    case 'RESET_REQUIRED':
      return 'danger';
    case 'UNCONFIRMED':
    case 'FORCE_CHANGE_PASSWORD':
      return 'warning';
    default:
      return 'neutral';
  }
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-12 text-center">
      <h2 className="text-lg font-semibold">No users match</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-muted-foreground)]">
        Cognito returns an empty page for the current filter. Adjust the search to broaden the
        result set.
      </p>
    </div>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
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
  Section,
} from '@oci/ui';
import type { AccessRequestStatus, AccessRequestSummary } from '@oci/shared-types';
import { auth } from '../../../auth';
import { apiFetch } from '../../../lib/api';

export const metadata = {
  title: 'My access requests — OCI Platform',
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

export default async function MyAccessRequestsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/signin?callbackUrl=%2Fdashboard%2Faccess-requests');
  }

  let items: AccessRequestSummary[] | null = null;
  let error: string | null = null;
  try {
    items = await apiFetch<AccessRequestSummary[]>('/v2/me/access-requests', {
      session,
      revalidate: 0,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach catalog API';
  }

  return (
    <Container size="lg">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Dashboard
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">My access requests</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            Restricted datasets you&apos;ve asked to access. Hosts decide each request.
          </p>
        </header>

        {error ? (
          <Alert tone="danger">
            <AlertTitle>Could not load requests</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        ) : !items || items.length === 0 ? (
          <Card tone="subtle">
            <CardHeader>
              <CardTitle>No requests yet</CardTitle>
              <CardDescription>
                Browse the{' '}
                <Link href="/catalog" className="underline">
                  catalog
                </Link>{' '}
                and submit a request from any RESTRICTED dataset&apos;s detail page.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="space-y-3">
            {items.map((req) => (
              <li key={req.id}>
                <RequestRow req={req} />
              </li>
            ))}
          </ul>
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
              {' · '}
              Submitted{' '}
              <time dateTime={req.createdAt}>{DATE_FORMATTER.format(new Date(req.createdAt))}</time>
            </CardDescription>
          </div>
          <Badge tone={statusTone[req.status]}>{req.status.toLowerCase()}</Badge>
        </div>
      </CardHeader>
      {req.status !== 'PENDING' && req.decisionNote ? (
        <CardContent>
          <p className="text-sm">
            <span className="font-medium">Host&apos;s note: </span>
            {req.decisionNote}
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}

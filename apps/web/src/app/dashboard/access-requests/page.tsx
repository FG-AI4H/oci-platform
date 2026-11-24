import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
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
import { getFormatters } from '../../../i18n/server';
import { apiFetch } from '../../../lib/api';

/**
 * The participant's own access requests, in the interface language
 * (#654). Dataset names and the host's decision note are content and
 * are shown as written.
 */
export async function generateMetadata() {
  const t = await getTranslations('AccessRequest');
  return {
    title: t('dashboard.metaTitle'),
    robots: { index: false, follow: false },
  };
}

const statusTone: Record<AccessRequestStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  PENDING: 'info',
  APPROVED: 'success',
  DENIED: 'danger',
  REVOKED: 'neutral',
};

export default async function MyAccessRequestsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/signin?callbackUrl=%2Fdashboard%2Faccess-requests');
  }
  const t = await getTranslations('AccessRequest');

  let items: AccessRequestSummary[] | null = null;
  let error: string | null = null;
  try {
    items = await apiFetch<AccessRequestSummary[]>('/v2/me/access-requests', {
      session,
      revalidate: 0,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : t('page.unavailableFallback');
  }

  return (
    <Container size="lg">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('dashboard.eyebrow')}
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            {t('dashboard.title')}
          </h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">{t('dashboard.lead')}</p>
        </header>

        {error ? (
          <Alert tone="danger">
            <AlertTitle>{t('dashboard.loadErrorTitle')}</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        ) : !items || items.length === 0 ? (
          <Card tone="subtle">
            <CardHeader>
              <CardTitle>{t('dashboard.emptyTitle')}</CardTitle>
              <CardDescription>
                {t.rich('dashboard.emptyBody', {
                  link: (chunks) => (
                    <Link href="/catalog" className="underline">
                      {chunks}
                    </Link>
                  ),
                })}
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

async function RequestRow({ req }: { req: AccessRequestSummary }) {
  const [t, f] = await Promise.all([getTranslations('AccessRequest'), getFormatters()]);
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
              {t.rich('dashboard.submitted', {
                date: f.dateTime(req.createdAt),
                time: (chunks) => <time dateTime={req.createdAt}>{chunks}</time>,
              })}
            </CardDescription>
          </div>
          <Badge tone={statusTone[req.status]}>{t(`status.${req.status}`)}</Badge>
        </div>
      </CardHeader>
      {req.status !== 'PENDING' && req.decisionNote ? (
        <CardContent>
          <p className="text-sm">
            <span className="font-medium">{t('dashboard.hostNote')} </span>
            {req.decisionNote}
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}

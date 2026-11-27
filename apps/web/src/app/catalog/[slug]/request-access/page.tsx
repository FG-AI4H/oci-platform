import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Container,
  Section,
} from '@oci/ui';
import { IntendedUseCategorySchema, type DatasetDetail } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { apiFetch } from '../../../../lib/api';
import { RequestAccessForm } from './request-access-form';

export async function generateMetadata() {
  const t = await getTranslations('AccessRequest');
  return {
    title: t('page.metaTitle'),
    // Auth-gated form, no value to crawlers.
    robots: { index: false, follow: false },
  };
}

interface PageProps {
  params: Promise<{ slug: string }>;
  /** Answers carried over from `/use-case` (#829); anything else is ignored. */
  searchParams: Promise<{ intendedUse?: string | string[]; irbApproved?: string | string[] }>;
}

export default async function RequestAccessPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const carried = await searchParams;
  const carriedUse = IntendedUseCategorySchema.safeParse(carried.intendedUse);
  const prefill = {
    ...(carriedUse.success ? { intendedUseCategory: carriedUse.data } : {}),
    irbApproved: carried.irbApproved === 'true',
  };
  const [session, t] = await Promise.all([auth(), getTranslations('AccessRequest')]);

  // Anonymous → bounce to /signin with a callback back here so the
  // user lands on the form straight after authentication.
  if (!session?.user) {
    // The answers carried from a use case come back after sign-in.
    const carriedQs = new URLSearchParams();
    if (prefill.intendedUseCategory) carriedQs.set('intendedUse', prefill.intendedUseCategory);
    if (prefill.irbApproved) carriedQs.set('irbApproved', 'true');
    const back = `/catalog/${slug}/request-access${carriedQs.size > 0 ? `?${carriedQs.toString()}` : ''}`;
    redirect(`/signin?callbackUrl=${encodeURIComponent(back)}`);
  }

  let detail: DatasetDetail | null = null;
  let error: string | null = null;
  try {
    detail = await apiFetch<DatasetDetail>(`/v2/catalog/datasets/${encodeURIComponent(slug)}`, {
      session,
      revalidate: 0,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : t('page.unavailableFallback');
  }

  if (error) {
    return (
      <Container size="md">
        <Section spacing="md">
          <Alert tone="danger">
            <AlertTitle>{t('page.unavailableTitle')}</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        </Section>
      </Container>
    );
  }
  if (!detail) notFound();

  return (
    <Container size="md">
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <Link
            href={`/catalog/${detail.slug}`}
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
          >
            <ArrowLeftIcon size={14} />
            <span>{detail.name}</span>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('page.eyebrow')}
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t('page.title')}</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            {t.rich('page.lead', {
              link: (chunks) => (
                <Link
                  href="/dashboard/access-requests"
                  className="font-medium text-[var(--color-primary)] underline underline-offset-2"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </header>

        <Alert tone="info" className="mb-6">
          <AlertTitle>{t('page.auditableTitle')}</AlertTitle>
          <AlertDescription>{t('page.auditableBody')}</AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>{t('page.detailsTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <RequestAccessForm
              slug={detail.slug}
              datasetDuoTerms={detail.duoTerms ?? []}
              prefill={prefill}
            />
          </CardContent>
        </Card>
      </Section>
    </Container>
  );
}

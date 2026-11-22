import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
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
import type { DatasetDetail } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { apiFetch } from '../../../../lib/api';
import { requireHost } from '../../../../lib/groups';
import { FileUploader } from './file-uploader';
import { PublishMode } from './publish-mode';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Publish');
  return {
    title: t('metaTitle'),
    robots: { index: false, follow: false },
  };
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function PublishVersionPage({ params }: PageProps) {
  const { slug } = await params;
  const t = await getTranslations('Publish');
  const tDataset = await getTranslations('Dataset');
  const session = await auth();
  requireHost(session);

  let detail: DatasetDetail | null = null;
  let error: string | null = null;
  try {
    detail = await apiFetch<DatasetDetail>(`/v2/catalog/datasets/${encodeURIComponent(slug)}`, {
      session,
      revalidate: 0,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : t('page.catalogUnreachable');
  }

  if (error) {
    return (
      <Container size="md">
        <Section spacing="md">
          <Alert tone="danger">
            <AlertTitle>{t('page.catalogUnavailable')}</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">{error}</pre>
            </AlertDescription>
          </Alert>
        </Section>
      </Container>
    );
  }
  if (!detail) notFound();

  const nextVersion = bumpPatch(detail.latestVersion ?? '0.1.0');

  return (
    <Container size="wide">
      <Section spacing="md">
        <header className="mb-8 space-y-3">
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
          <p className="max-w-prose text-[var(--color-muted-foreground)]">{t('page.intro')}</p>
          {/*
           * The dataset facts this version attaches to. One row under the
           * heading, where the host reads it once, instead of a sticky
           * sidebar that took an 18rem column from the form on every step.
           */}
          <DefinitionList
            aria-label={t('page.factsLabel')}
            className="flex flex-wrap gap-x-8 gap-y-2 border-t border-[var(--color-border)] pt-4 text-sm"
          >
            <DefinitionItem term={t('page.slug')} mono>
              {detail.slug}
            </DefinitionItem>
            <DefinitionItem term={t('page.visibility')}>
              <Badge tone="neutral">{tDataset(`visibilityBadge.${detail.visibility}`)}</Badge>
            </DefinitionItem>
            <DefinitionItem term={t('page.accessTier')}>
              <Badge tone="neutral">{tDataset(`accessTier.${detail.accessTier}`)}</Badge>
            </DefinitionItem>
            {detail.latestVersion ? (
              <DefinitionItem term={t('page.latest')}>
                <Badge tone="primary">v{detail.latestVersion}</Badge>
              </DefinitionItem>
            ) : null}
            <DefinitionItem term={t('page.next')}>
              <Badge tone="accent">v{nextVersion}</Badge>
            </DefinitionItem>
          </DefinitionList>
        </header>

        <div className="space-y-10">
          <PublishMode
            slug={detail.slug}
            suggestedVersion={nextVersion}
            visibility={detail.visibility}
            accessTier={detail.accessTier}
          />

          {/*
           * Self-hosted uploads (PR I, #87). Only meaningful once a
           * version exists — multipart-complete attaches each file
           * to the latest published version. Surfaced after the
           * publish form so the host's flow is "publish manifest →
           * upload files → paste contentUrls → publish next version".
           * For datasets that already use external URLs, this
           * section is just ignored.
           */}
          {detail.latestVersion && session?.user ? (
            <Card className="max-w-3xl">
              <CardHeader>
                <CardTitle>{t('page.uploadTitle')}</CardTitle>
                <CardDescription>
                  {t.rich('page.uploadDescription', {
                    code: (chunks) => <code className="font-mono text-xs">{chunks}</code>,
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FileUploader slug={detail.slug} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </Section>
    </Container>
  );
}

/** Bump the PATCH segment of a semver-ish string. Falls back to 0.1.0. */
function bumpPatch(v: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return '0.1.0';
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

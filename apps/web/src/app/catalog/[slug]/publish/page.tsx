import Link from 'next/link';
import { notFound } from 'next/navigation';
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
  Section,
} from '@oci/ui';
import type { DatasetDetail } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { apiFetch } from '../../../../lib/api';
import { requireHost } from '../../../../lib/groups';
import { FileUploader } from './file-uploader';
import { PublishVersionForm } from './publish-version-form';

export const metadata = {
  title: 'Publish version — OCI Catalog',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function PublishVersionPage({ params }: PageProps) {
  const { slug } = await params;
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
    error = err instanceof Error ? err.message : 'Unable to reach catalog API';
  }

  if (error) {
    return (
      <Container size="md">
        <Section spacing="md">
          <Alert tone="danger">
            <AlertTitle>Catalog unavailable</AlertTitle>
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
    <Container size="lg">
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
            Host workflow
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Publish a new version
          </h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            Paste or upload a Croissant&nbsp;1.1 manifest. We&apos;ll validate it against Croissant
            + RAI + BIOCroissant before mirroring its distributions to the catalog.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>New version</CardTitle>
              </CardHeader>
              <CardContent>
                <PublishVersionForm slug={detail.slug} suggestedVersion={nextVersion} />
              </CardContent>
            </Card>

            {/*
             * Self-hosted uploads (PR I, #87). Only meaningful once a
             * version exists — multipart-complete attaches each file
             * to the latest published version. Surfaced after the
             * publish form so the host's flow is "publish manifest →
             * upload files → paste contentUrls → publish next version".
             * For datasets that already use external URLs, this
             * section is just ignored.
             */}
            {detail.latestVersion && session?.accessToken ? (
              <Card>
                <CardHeader>
                  <CardTitle>Upload files</CardTitle>
                  <CardDescription>
                    Optional. Host the data on this platform instead of pointing the manifest at
                    an upstream URL. Each upload yields a stable{' '}
                    <code className="font-mono text-xs">contentUrl</code> for the next version&apos;s
                    manifest.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FileUploader slug={detail.slug} accessToken={session.accessToken} />
                </CardContent>
              </Card>
            ) : null}
          </div>

          <Card tone="subtle" className="h-fit lg:sticky lg:top-20">
            <CardHeader>
              <CardTitle>Current state</CardTitle>
              <CardDescription>The dataset row this version will attach to.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--color-muted-foreground)]">Slug</span>
                <span className="font-mono text-xs">{detail.slug}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--color-muted-foreground)]">Status</span>
                <Badge tone="neutral">{detail.status}</Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--color-muted-foreground)]">Visibility</span>
                <Badge tone="neutral">{detail.visibility}</Badge>
              </div>
              {detail.latestVersion ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--color-muted-foreground)]">Latest</span>
                  <Badge tone="primary">v{detail.latestVersion}</Badge>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
                <span className="text-[var(--color-muted-foreground)]">Suggested next</span>
                <Badge tone="accent">v{nextVersion}</Badge>
              </div>
            </CardContent>
          </Card>
          {/* end grid columns */}
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

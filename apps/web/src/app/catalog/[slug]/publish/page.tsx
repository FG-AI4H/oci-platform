import Link from 'next/link';
import { notFound } from 'next/navigation';
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
} from '@oci/ui';
import type { DatasetDetail } from '@oci/shared-types';
import { auth } from '../../../../auth';
import { apiFetch } from '../../../../lib/api';
import { requireHost } from '../../../../lib/groups';
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
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Alert tone="danger">
          <AlertTitle>Catalog unavailable</AlertTitle>
          <AlertDescription>
            <pre className="mt-1 whitespace-pre-wrap text-xs font-mono">{error}</pre>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!detail) notFound();

  const nextVersion = bumpPatch(detail.latestVersion ?? '0.1.0');

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-12 space-y-6">
      <header className="space-y-2">
        <Link
          href={`/catalog/${detail.slug}`}
          className="text-sm text-[var(--color-muted-foreground)] hover:underline"
        >
          ← {detail.name}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Publish a new version</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Paste or upload a Croissant&nbsp;1.1 manifest. We&apos;ll validate it against Croissant +
          RAI + BIOCroissant before mirroring its distributions to the catalog.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Current state</CardTitle>
          <CardDescription>
            <span className="font-mono">{detail.slug}</span> · status&nbsp;
            <Badge tone="neutral">{detail.status}</Badge> · visibility&nbsp;
            <Badge tone="neutral">{detail.visibility}</Badge>
            {detail.latestVersion ? (
              <>
                {' · latest '}
                <Badge tone="primary">v{detail.latestVersion}</Badge>
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>New version</CardTitle>
        </CardHeader>
        <CardContent>
          <PublishVersionForm slug={detail.slug} suggestedVersion={nextVersion} />
        </CardContent>
      </Card>
    </div>
  );
}

/** Bump the PATCH segment of a semver-ish string. Falls back to 0.1.0. */
function bumpPatch(v: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return '0.1.0';
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

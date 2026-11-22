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
            Host workflow
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Publish a new version
          </h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            Describe the dataset once in the guided form, or paste a Croissant&nbsp;1.1 manifest you
            already have. Either way the platform validates it against Croissant, RAI, BIOCroissant
            and the bio-prov provenance profile before it goes into the catalogue.
          </p>
          {/*
           * The dataset facts this version attaches to. One row under the
           * heading, where the host reads it once, instead of a sticky
           * sidebar that took an 18rem column from the form on every step.
           */}
          <DefinitionList
            aria-label="Dataset"
            className="flex flex-wrap gap-x-8 gap-y-2 border-t border-[var(--color-border)] pt-4 text-sm"
          >
            <DefinitionItem term="Slug" mono>
              {detail.slug}
            </DefinitionItem>
            <DefinitionItem term="Visibility">
              <Badge tone="neutral">{detail.visibility}</Badge>
            </DefinitionItem>
            <DefinitionItem term="Access tier">
              <Badge tone="neutral">{detail.accessTier}</Badge>
            </DefinitionItem>
            {detail.latestVersion ? (
              <DefinitionItem term="Latest">
                <Badge tone="primary">v{detail.latestVersion}</Badge>
              </DefinitionItem>
            ) : null}
            <DefinitionItem term="Next">
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
                <CardTitle>Upload files</CardTitle>
                <CardDescription>
                  Optional. Host the data on this platform instead of pointing the manifest at an
                  upstream URL. Each upload yields a stable{' '}
                  <code className="font-mono text-xs">contentUrl</code> for the next version&apos;s
                  manifest.
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

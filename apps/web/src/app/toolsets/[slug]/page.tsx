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
  CardHeader,
  CardTitle,
  Container,
  DefinitionItem,
  DefinitionList,
  ExternalLinkIcon,
  Section,
} from '@oci/ui';
import { ToolsetSlugSchema, type ToolsetResponse } from '@oci/shared-types';
import { auth } from '../../../auth';
import { apiFetch } from '../../../lib/api';
import { siteUrl } from '../../../lib/site-url';
import { toolsetJsonLd } from '../../../lib/toolset-jsonld';
import { ToolsetLifecyclePanel } from './lifecycle-panel';

/**
 * One toolset (#830, ADR-0031). Public once published; a draft or a
 * withdrawn toolset is served to its declarer and to operators only, and is
 * a 404 for anyone else (the API decides). The page leads with what the
 * toolset is and the way out to it, since the platform only lists it.
 */

const LINK_CLASS =
  'font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded';

async function load(slug: string): Promise<ToolsetResponse | null> {
  if (!ToolsetSlugSchema.safeParse(slug).success) return null;
  const session = await auth();
  return apiFetch<ToolsetResponse>(
    `/v2/toolsets/${encodeURIComponent(slug)}`,
    session?.user ? { session, revalidate: 0 } : { revalidate: 0 },
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [toolset, t] = await Promise.all([
    load(slug).catch(() => null),
    getTranslations('Toolsets'),
  ]);
  return {
    title: t('detail.metaTitle', { name: toolset?.name ?? slug }),
    ...(toolset ? { description: toolset.summary.slice(0, 300) } : {}),
    // A draft or a withdrawn toolset: nothing for a crawler to index.
    ...(toolset?.status === 'PUBLISHED' ? {} : { robots: { index: false, follow: false } }),
  };
}

export default async function ToolsetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTranslations('Toolsets');

  let toolset: ToolsetResponse | null = null;
  let error: string | null = null;
  try {
    toolset = await load(slug);
  } catch (err) {
    error = err instanceof Error ? err.message : t('unavailable.fallback');
  }
  if (error) {
    return (
      <Container size="md">
        <Section spacing="md">
          <Alert tone="danger">
            <AlertTitle>{t('unavailable.title')}</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{error}</pre>
            </AlertDescription>
          </Alert>
        </Section>
      </Container>
    );
  }
  if (!toolset) notFound();

  const published = toolset.status === 'PUBLISHED';
  const jsonLd = published ? toolsetJsonLd(toolset, siteUrl()) : null;
  const showLifecycle = toolset.canEdit || toolset.moves.length > 0 || !published;
  const hasLinks = toolset.datasets.length > 0 || toolset.modelCards.length > 0;

  return (
    <>
      {jsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      ) : null}

      <Section spacing="md" surface="hero">
        <Container size="xl">
          <Link
            href="/toolsets"
            className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <ArrowLeftIcon size={14} />
            <span>{t('detail.back')}</span>
          </Link>
          <div className="mt-4 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="primary">{t(`kind.${toolset.kind}`)}</Badge>
              {toolset.version ? <Badge tone="neutral">v{toolset.version}</Badge> : null}
            </div>
            <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight sm:text-4xl">
              {toolset.name}
            </h1>
            <p className="mt-4 whitespace-pre-line text-[var(--color-muted-foreground)]">
              {toolset.summary}
            </p>
            <a
              href={toolset.url}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--color-primary)] px-5 text-sm font-medium text-[var(--color-primary-foreground)] shadow-[var(--shadow-sm)] hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
            >
              <span>{t('detail.open')}</span>
              <ExternalLinkIcon size={16} />
              <span className="sr-only"> ({t('detail.opensElsewhere')})</span>
            </a>
            <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">
              {t('detail.byReference')}
            </p>
          </div>
        </Container>
      </Section>

      <Container size="xl">
        {showLifecycle ? (
          <div className="pt-8">
            <ToolsetLifecyclePanel
              slug={toolset.slug}
              status={toolset.status}
              statusLabel={t(`status.${toolset.status}`)}
              moves={toolset.moves}
              canEdit={toolset.canEdit}
            />
          </div>
        ) : null}

        <Section spacing="md" className="grid gap-8 lg:grid-cols-2">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle as="h2">{t('detail.about')}</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinitionList>
                <DefinitionItem term={t('detail.maintainer')}>{toolset.maintainer}</DefinitionItem>
                <DefinitionItem term={t('detail.contact')}>
                  {toolset.contact ?? t('detail.notDeclared')}
                </DefinitionItem>
                <DefinitionItem term={t('detail.licence')}>
                  {toolset.licence ? (
                    <>
                      {toolset.licence}
                      <span className="mt-0.5 block text-xs text-[var(--color-muted-foreground)]">
                        {t('detail.licenceNote')}
                      </span>
                    </>
                  ) : (
                    t('detail.notDeclared')
                  )}
                </DefinitionItem>
                <DefinitionItem term={t('detail.version')}>
                  {toolset.version ?? t('detail.notDeclared')}
                </DefinitionItem>
                <DefinitionItem term={t('detail.address')}>
                  <span className="break-all font-mono text-xs">{toolset.url}</span>
                </DefinitionItem>
              </DefinitionList>
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle as="h2">{t('detail.worksWith')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {!hasLinks ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  {t('detail.noLinks')}
                </p>
              ) : null}
              {toolset.datasets.length > 0 ? (
                <section aria-labelledby="toolset-datasets">
                  <h3 id="toolset-datasets" className="text-sm font-semibold">
                    {t('detail.datasets')}
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {toolset.datasets.map((d) => (
                      <li key={d.slug}>
                        <Link
                          href={`/catalog/${encodeURIComponent(d.slug)}`}
                          className={`${LINK_CLASS} break-words`}
                        >
                          {d.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {toolset.modelCards.length > 0 ? (
                <section aria-labelledby="toolset-models">
                  <h3 id="toolset-models" className="text-sm font-semibold">
                    {t('detail.models')}
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {toolset.modelCards.map((m) => (
                      <li key={m.slug}>
                        <Link
                          href={`/models/${encodeURIComponent(m.slug)}`}
                          className={`${LINK_CLASS} break-words`}
                        >
                          {m.slug}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </CardContent>
          </Card>
        </Section>
      </Container>
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Container,
  Input,
  Section,
} from '@oci/ui';
import {
  ListToolsetsQuerySchema,
  ToolsetKindSchema,
  type ListMyToolsetsResponse,
  type ListToolsetsResponse,
  type ToolsetStatus,
  type ToolsetSummary,
} from '@oci/shared-types';
import { auth } from '../../auth';
import { apiFetch } from '../../lib/api';

/**
 * `/toolsets` (#830, ADR-0031): the public list of published toolsets, with
 * a search and a filter by kind. A signed-in visitor also sees the toolsets
 * they declared, drafts included, since a draft is in no public list.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Toolsets');
  return { title: t('metaTitle'), description: t('metaDescription') };
}

type SearchParams = Partial<Record<'q' | 'kind' | 'page', string | string[]>>;

const SELECT_CLASS =
  'block h-10 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-base sm:text-sm text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

const LINK_CLASS =
  'font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded';

const STATUS_TONE: Record<ToolsetStatus, 'info' | 'success' | 'neutral'> = {
  DRAFT: 'info',
  PUBLISHED: 'success',
  WITHDRAWN: 'neutral',
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ToolsetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [t, session] = await Promise.all([getTranslations('Toolsets'), auth()]);
  // An answer the schema refuses (a one-letter search) falls back to no filter.
  const parsed = ListToolsetsQuerySchema.safeParse({
    q: first(params.q),
    kind: first(params.kind),
    page: first(params.page),
  });
  const query = parsed.success ? parsed.data : ListToolsetsQuerySchema.parse({});
  const filtered = Boolean(query.q) || Boolean(query.kind);

  const qs = new URLSearchParams();
  if (query.q) qs.set('q', query.q);
  if (query.kind) qs.set('kind', query.kind);
  const pageHref = (page: number) => {
    const next = new URLSearchParams(qs);
    if (page > 1) next.set('page', String(page));
    const text = next.toString();
    return text ? `/toolsets?${text}` : '/toolsets';
  };

  let response: ListToolsetsResponse | null = null;
  let mine: ToolsetSummary[] = [];
  let error: string | null = null;
  try {
    const apiQs = new URLSearchParams(qs);
    apiQs.set('page', String(query.page));
    apiQs.set('limit', String(query.limit));
    response = await apiFetch<ListToolsetsResponse>(`/v2/toolsets?${apiQs.toString()}`, {
      revalidate: 0,
    });
    if (session?.user) {
      // Best-effort: the public list stands without it.
      mine = await apiFetch<ListMyToolsetsResponse>('/v2/toolsets/mine', {
        session,
        revalidate: 0,
      })
        .then((res) => res?.items ?? [])
        .catch(() => []);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : t('unavailable.fallback');
  }

  const row = (item: ToolsetSummary, showStatus: boolean) => (
    <li
      key={item.slug}
      className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
    >
      <div className="min-w-0 space-y-1.5">
        <Link
          href={`/toolsets/${encodeURIComponent(item.slug)}`}
          className={`${LINK_CLASS} break-words`}
        >
          {item.name}
        </Link>
        <p className="line-clamp-2 text-sm text-[var(--color-muted-foreground)]">{item.summary}</p>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {t('list.by', { maintainer: item.maintainer })}
          {item.licence ? <> · {t('list.licence', { licence: item.licence })}</> : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Badge tone="neutral">{t(`kind.${item.kind}`)}</Badge>
        {showStatus ? (
          <Badge tone={STATUS_TONE[item.status]}>{t(`status.${item.status}`)}</Badge>
        ) : null}
      </div>
    </li>
  );

  return (
    <Container size="page">
      <Section spacing="md">
        <header className="mb-6 flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('list.eyebrow')}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t('list.heading')}
            </h1>
            {response ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                {t(filtered ? 'list.countMatching' : 'list.count', { count: response.total })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <p className="max-w-2xl text-[var(--color-muted-foreground)]">{t('list.intro')}</p>
            {session?.user ? (
              <Button asChild variant="primary" className="shrink-0 self-start">
                <Link href="/toolsets/new">{t('list.declare')}</Link>
              </Button>
            ) : null}
          </div>
        </header>

        <form action="/toolsets" method="get" role="search" className="mb-6 flex flex-wrap gap-2">
          <label htmlFor="toolsets-search" className="sr-only">
            {t('search.label')}
          </label>
          {/* The box takes the room the kind filter and the button leave it. */}
          <div className="min-w-0 flex-1 basis-56">
            <Input
              id="toolsets-search"
              type="search"
              name="q"
              defaultValue={query.q ?? ''}
              placeholder={t('search.placeholder')}
            />
          </div>
          <label htmlFor="toolsets-kind" className="sr-only">
            {t('search.kind')}
          </label>
          <select
            id="toolsets-kind"
            name="kind"
            defaultValue={query.kind ?? ''}
            className={SELECT_CLASS}
          >
            <option value="">{t('search.anyKind')}</option>
            {ToolsetKindSchema.options.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kind.${kind}`)}
              </option>
            ))}
          </select>
          <Button type="submit">{t('search.submit')}</Button>
        </form>

        {error ? (
          <Alert tone="danger">
            <AlertTitle>{t('unavailable.title')}</AlertTitle>
            <AlertDescription>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{error}</pre>
            </AlertDescription>
          </Alert>
        ) : !response || response.items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--color-border)] p-6 text-[var(--color-muted-foreground)]">
            {filtered ? t('list.emptyFiltered') : t('list.empty')}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
              {response.items.map((item) => row(item, false))}
            </ul>
            {response.totalPages > 1 ? (
              <nav
                aria-label={t('list.pagination')}
                className="mt-4 flex items-center justify-between gap-4 text-sm"
              >
                {response.page > 1 ? (
                  <Link href={pageHref(response.page - 1)} className={LINK_CLASS}>
                    {t('list.previous')}
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-[var(--color-muted-foreground)]">
                  {t('list.page', { page: response.page, total: response.totalPages })}
                </span>
                {response.page < response.totalPages ? (
                  <Link href={pageHref(response.page + 1)} className={LINK_CLASS}>
                    {t('list.next')}
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </>
        )}

        {mine.length > 0 ? (
          <section aria-labelledby="toolsets-mine" className="mt-12">
            <h2 id="toolsets-mine" className="text-xl font-semibold tracking-tight">
              {t('list.mine')}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
              {t('list.mineHint')}
            </p>
            <ul className="mt-4 divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
              {mine.map((item) => row(item, true))}
            </ul>
          </section>
        ) : null}
      </Section>
    </Container>
  );
}

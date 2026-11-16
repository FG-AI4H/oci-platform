import Link from 'next/link';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Container,
  Input,
  SearchIcon,
  Section,
  SparkIcon,
} from '@oci/ui';
import type {
  ListModelCardsResponse,
  ListModelCardsSort,
  ModelCardSummary,
  ModelClass,
} from '@oci/shared-types';
import { apiFetch } from '../../lib/api';
import {
  JURISDICTION_OPTIONS,
  MODEL_CLASS_OPTIONS,
  REGULATORY_STATUS_LABEL,
  REGULATORY_STATUS_TONE,
  humanise,
  modelClassLabel,
  normaliseJurisdiction,
  normaliseModelClass,
} from '../../lib/model-card-labels';

/**
 * Public model catalogue (#591, Y.3176 Discover) — the model counterpart of
 * `/catalog`. Anonymous: the API lists PUBLISHED cards only, whoever asks,
 * so the page doesn't forward the session.
 *
 * Same shape as `/catalog`: the URL is the source of truth, every filter,
 * sort and page change is a `Link` that re-issues the GET, and there is no
 * client-side state. Two facets (model class, jurisdiction), both
 * single-value to match the API.
 */

const PAGE_SIZE = 24;

interface SearchParams {
  q?: string;
  modelClass?: string;
  jurisdiction?: string;
  sort?: string;
  page?: string;
}

interface FilterState {
  q?: string;
  modelClass: ModelClass | null;
  jurisdiction: string | null;
  sort: ListModelCardsSort;
  page: number;
}

const SORT_OPTIONS: ReadonlyArray<{ value: ListModelCardsSort; label: string }> = [
  { value: 'recent', label: 'Most recent' },
  { value: 'name', label: 'Name' },
  { value: 'oldest', label: 'Oldest' },
];

export const metadata = {
  title: 'Models — OCI Platform',
  description:
    'Discover published health AI models with their intended use, regulatory status and WHO Model Facts label.',
};

function parseFilters(params: SearchParams): FilterState {
  const q = params.q?.trim();
  return {
    q: q && q.length > 0 ? q : undefined,
    modelClass: normaliseModelClass(params.modelClass),
    jurisdiction: normaliseJurisdiction(params.jurisdiction),
    sort: params.sort === 'name' || params.sort === 'oldest' ? params.sort : 'recent',
    page: Math.max(1, Number(params.page ?? '1') || 1),
  };
}

/** Outgoing link for a filter state. Defaults are left out to keep URLs canonical. */
function buildUrl(state: FilterState, overrides: Partial<FilterState>): string {
  const merged: FilterState = { ...state, ...overrides };
  const qs = new URLSearchParams();
  if (merged.q) qs.set('q', merged.q);
  if (merged.modelClass) qs.set('modelClass', merged.modelClass);
  if (merged.jurisdiction) qs.set('jurisdiction', merged.jurisdiction);
  if (merged.sort !== 'recent') qs.set('sort', merged.sort);
  if (merged.page > 1) qs.set('page', String(merged.page));
  const s = qs.toString();
  return s.length > 0 ? `/models?${s}` : '/models';
}

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = parseFilters(await searchParams);

  const apiQs = new URLSearchParams();
  if (filters.q) apiQs.set('q', filters.q);
  if (filters.modelClass) apiQs.set('modelClass', filters.modelClass);
  if (filters.jurisdiction) apiQs.set('jurisdiction', filters.jurisdiction);
  apiQs.set('sort', filters.sort);
  apiQs.set('page', String(filters.page));
  apiQs.set('limit', String(PAGE_SIZE));

  let response: ListModelCardsResponse | null = null;
  let error: string | null = null;
  try {
    response = await apiFetch<ListModelCardsResponse>(
      `/v2/prediction/model-cards?${apiQs.toString()}`,
      { revalidate: 0 },
    );
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach the model catalogue API';
  }

  const activeFilters = (filters.modelClass ? 1 : 0) + (filters.jurisdiction ? 1 : 0);

  return (
    <Container size="wide">
      <Section spacing="md">
        <header className="mb-6 flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Catalog
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Models</h1>
            {response ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                <span className="text-[var(--color-foreground)] font-medium tabular-nums">
                  {response.total.toLocaleString('en-GB')}
                </span>{' '}
                {response.total === 1 ? 'published model' : 'published models'}
                {filters.q ? (
                  <>
                    {' matching '}
                    <span className="text-[var(--color-foreground)]">
                      &ldquo;{filters.q}&rdquo;
                    </span>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <p className="max-w-2xl text-[var(--color-muted-foreground)]">
            Published health AI models with a declared intended use. Each card carries a WHO Model
            Facts label summarising what the model is for, how it was validated and when to stop
            relying on it.
          </p>
        </header>

        <form action="/models" method="get" role="search" className="mb-4 flex flex-wrap gap-2">
          <label htmlFor="models-search" className="sr-only">
            Search models
          </label>
          <Input
            id="models-search"
            type="search"
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder="Search by name, developer or intended use"
            leadingIcon={<SearchIcon size={16} />}
            wrapperClassName="min-w-0 flex-1"
          />
          {filters.modelClass ? (
            <input type="hidden" name="modelClass" value={filters.modelClass} />
          ) : null}
          {filters.jurisdiction ? (
            <input type="hidden" name="jurisdiction" value={filters.jurisdiction} />
          ) : null}
          {filters.sort !== 'recent' ? (
            <input type="hidden" name="sort" value={filters.sort} />
          ) : null}
          <Button type="submit">Search</Button>
        </form>

        <AppliedFilters filters={filters} />

        <div className="grid gap-6 lg:grid-cols-[16rem_1fr] lg:gap-8">
          <div className="min-w-0">
            {/* Same disclosure pattern as /catalog: facets collapse below lg. */}
            <details className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] lg:hidden">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] [&::-webkit-details-marker]:hidden">
                Filters
                {activeFilters > 0 ? <Badge tone="primary">{activeFilters} active</Badge> : null}
                <span
                  aria-hidden="true"
                  className="ms-auto text-[var(--color-muted-foreground)] motion-safe:transition-transform group-open:rotate-180"
                >
                  ▾
                </span>
              </summary>
              <div className="border-t border-[var(--color-border)] p-4">
                <FilterPanel filters={filters} />
              </div>
            </details>
            <div className="hidden lg:block">
              <FilterPanel filters={filters} />
            </div>
          </div>
          <div className="min-w-0">
            <SortToolbar filters={filters} response={response} />
            {error ? (
              <Alert tone="danger">
                <AlertTitle>Model catalogue unavailable</AlertTitle>
                <AlertDescription>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">
                    {error}
                  </pre>
                </AlertDescription>
              </Alert>
            ) : !response || response.items.length === 0 ? (
              <EmptyState hasFilters={Boolean(filters.q) || activeFilters > 0} />
            ) : (
              <>
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {response.items.map((m) => (
                    <li key={m.id}>
                      <ModelCardTile m={m} />
                    </li>
                  ))}
                </ul>
                <Pagination filters={filters} response={response} />
              </>
            )}
          </div>
        </div>
      </Section>
    </Container>
  );
}

function FilterPanel({ filters }: { filters: FilterState }) {
  return (
    <aside aria-label="Filters" className="space-y-5">
      <FacetSection
        title="Model class"
        options={MODEL_CLASS_OPTIONS}
        selected={filters.modelClass}
        toggleHref={(v) =>
          buildUrl(filters, {
            modelClass: filters.modelClass === v ? null : normaliseModelClass(v),
            page: 1,
          })
        }
      />
      <FacetSection
        title="Jurisdiction"
        options={JURISDICTION_OPTIONS}
        selected={filters.jurisdiction}
        toggleHref={(v) =>
          buildUrl(filters, { jurisdiction: filters.jurisdiction === v ? null : v, page: 1 })
        }
      />
    </aside>
  );
}

function FacetSection({
  title,
  options,
  selected,
  toggleHref,
}: {
  title: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: string | null;
  toggleHref: (value: string) => string;
}) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
        {title}
      </legend>
      <ul className="space-y-1">
        {options.map((opt) => {
          const isSelected = selected === opt.value;
          return (
            <li key={opt.value}>
              {/* Navigation links, so `aria-current` rather than `aria-pressed` (#148). */}
              <Link
                href={toggleHref(opt.value)}
                aria-current={isSelected ? 'true' : undefined}
                className={
                  'flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
                  (isSelected
                    ? 'bg-[var(--color-primary-soft)] text-[var(--color-foreground)] font-medium'
                    : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]')
                }
              >
                <span
                  aria-hidden="true"
                  className={
                    'inline-block h-3 w-3 flex-shrink-0 rounded-full border ' +
                    (isSelected
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]'
                      : 'border-[var(--color-border-strong)]')
                  }
                />
                <span className="truncate">{opt.label}</span>
                <span className="sr-only">
                  {isSelected ? ' (selected — activate to remove filter)' : ' (activate to filter)'}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function AppliedFilters({ filters }: { filters: FilterState }) {
  const chips: Array<{ label: string; href: string }> = [];
  if (filters.modelClass) {
    chips.push({
      label: `Class: ${modelClassLabel(filters.modelClass)}`,
      href: buildUrl(filters, { modelClass: null, page: 1 }),
    });
  }
  if (filters.jurisdiction) {
    chips.push({
      label: `Jurisdiction: ${filters.jurisdiction}`,
      href: buildUrl(filters, { jurisdiction: null, page: 1 }),
    });
  }
  if (chips.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
        Applied
      </span>
      {chips.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1 text-xs font-medium text-[var(--color-foreground)] hover:bg-[var(--color-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          <span>{c.label}</span>
          <span aria-hidden="true">×</span>
          <span className="sr-only">Remove filter</span>
        </Link>
      ))}
      <Link
        href={buildUrl(filters, { modelClass: null, jurisdiction: null, page: 1 })}
        className="text-xs font-medium text-[var(--color-muted-foreground)] underline-offset-2 hover:underline"
      >
        Clear all
      </Link>
    </div>
  );
}

function SortToolbar({
  filters,
  response,
}: {
  filters: FilterState;
  response: ListModelCardsResponse | null;
}) {
  if (!response) return null;
  const start = (response.page - 1) * response.pageSize + 1;
  const end = start + response.items.length - 1;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-[var(--color-muted-foreground)]">
        {response.items.length === 0 ? (
          <>No results.</>
        ) : (
          <>
            Showing{' '}
            <span className="text-[var(--color-foreground)] tabular-nums">
              {start}–{end}
            </span>{' '}
            of{' '}
            <span className="text-[var(--color-foreground)] tabular-nums">
              {response.total.toLocaleString('en-GB')}
            </span>
          </>
        )}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--color-muted-foreground)]">Sort</span>
        <nav
          aria-label="Sort"
          className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-0.5 text-xs"
        >
          {SORT_OPTIONS.map((opt) => {
            const isActive = filters.sort === opt.value;
            return (
              <Link
                key={opt.value}
                href={buildUrl(filters, { sort: opt.value, page: 1 })}
                aria-current={isActive ? 'page' : undefined}
                className={
                  'rounded px-2.5 py-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
                  (isActive
                    ? 'bg-[var(--color-primary-soft)] text-[var(--color-foreground)] font-medium'
                    : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]')
                }
              >
                {opt.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function Pagination({
  filters,
  response,
}: {
  filters: FilterState;
  response: ListModelCardsResponse;
}) {
  const { totalPages } = response;
  const current = filters.page;
  if (totalPages <= 1 && current <= 1) return null;
  const prev = current > 1 ? buildUrl(filters, { page: current - 1 }) : null;
  const next = current < totalPages ? buildUrl(filters, { page: current + 1 }) : null;

  return (
    <nav
      aria-label="Pagination"
      className="mt-10 flex flex-wrap items-center justify-center gap-3 text-sm"
    >
      {prev ? (
        <Button asChild variant="outline" size="sm">
          <Link href={prev} rel="prev">
            ← Prev
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          ← Prev
        </Button>
      )}
      <span className="tabular-nums text-[var(--color-muted-foreground)]">
        Page {current} of {totalPages}
      </span>
      {next ? (
        <Button asChild variant="outline" size="sm">
          <Link href={next} rel="next">
            Next →
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          Next →
        </Button>
      )}
    </nav>
  );
}

function ModelCardTile({ m }: { m: ModelCardSummary }) {
  return (
    <Link
      href={`/models/${m.slug}`}
      className="group block h-full rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
    >
      <Card accent="primary" interactive="hover" className="h-full">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle
              as="h2"
              className="min-w-0 break-words line-clamp-2 group-hover:text-[var(--color-primary)] transition-colors"
            >
              {m.slug}
            </CardTitle>
            <Badge tone="primary" className="shrink-0">
              v{m.versionMajorMinorPatch}
            </Badge>
          </div>
          {m.modelDeveloper ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">{m.modelDeveloper}</p>
          ) : null}
          <CardDescription className="line-clamp-3 min-h-[3.5rem]">
            {m.clinicalSummary ?? <em>No clinical summary provided.</em>}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-1.5 border-t border-[var(--color-border)] pt-4 text-xs">
          <Badge tone="neutral">{modelClassLabel(m.modelClass)}</Badge>
          <Badge tone="neutral">{humanise(m.medicalPurpose)}</Badge>
          <Badge tone="info">Risk tier {m.riskTier}</Badge>
          {m.generativeAi ? <Badge tone="accent">Generative AI</Badge> : null}
          {m.regulatoryApprovalStatus ? (
            <Badge tone={REGULATORY_STATUS_TONE[m.regulatoryApprovalStatus]}>
              {REGULATORY_STATUS_LABEL[m.regulatoryApprovalStatus]}
            </Badge>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-12 text-center">
      <span
        className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-[var(--shadow-xs)]"
        aria-hidden="true"
      >
        <SparkIcon size={20} />
      </span>
      <h2 className="mt-4 text-lg font-semibold">
        {hasFilters ? 'No matching models' : 'No published models yet'}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-muted-foreground)]">
        {hasFilters
          ? 'Try fewer filters, or broaden your search.'
          : 'Model cards appear here once they are published. Drafts and submissions under review are not listed.'}
      </p>
      {hasFilters ? (
        <div className="mt-5">
          <Button asChild variant="outline" size="sm">
            <Link href="/models">Clear all filters</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

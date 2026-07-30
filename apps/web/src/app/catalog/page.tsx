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
  DatabaseIcon,
  Input,
  SearchIcon,
  Section,
} from '@oci/ui';
import type {
  DatasetSource,
  DatasetSummary,
  DatasetVisibility,
  ListDatasetsResponse,
  ListDatasetsSort,
} from '@oci/shared-types';
import { DUO_REGISTRY, lookupDuoTerm } from '@oci/croissant';
import { auth } from '../../auth';
import { isHost } from '../../lib/groups';
import { apiFetch } from '../../lib/api';

/**
 * Catalog list (PR L.1, #91 — major rewrite from PR C/D's "search +
 * load more"). Adds:
 *
 *   - **Faceted filtering** down a left rail: imaging modality,
 *     body region, condition (BioCroissant); anonymisation level;
 *     license; DUO permission terms (J.1).
 *   - **Offset pagination** with page numbers + prev/next instead of
 *     cursor "Load more". Cursor mode is preserved for federation /
 *     API clients but the web UI uses pages.
 *   - **Sort options**: most-recent (default), name, oldest.
 *   - **Applied-filter chips** above the grid so the user always
 *     sees what's narrowing the result set, with one-click removal.
 *
 * URL is the source of truth. Every filter is a query-string param,
 * every transition (filter, page, sort) is a `Link` that re-issues
 * the GET — no client-side state, no JS bundle for the list itself.
 *
 * The free-text `?q=` keeps existing FTS over name/description/
 * keywords; structured filters AND with `q`. Empty multi-value
 * facets are dropped from the URL to keep canonical link shapes.
 */

const PAGE_SIZE = 24;

interface SearchParams {
  q?: string;
  cursor?: string;
  source?: string;
  page?: string;
  sort?: string;
  modality?: string | string[];
  bodyRegion?: string | string[];
  condition?: string | string[];
  anonymizationLevel?: string;
  license?: string | string[];
  duoTerms?: string | string[];
  /** Commercial-use facet (#119). Single-value enum. */
  commercialUseTerms?: string;
}

const SOURCE_OPTIONS: ReadonlyArray<{ value: DatasetSource; label: string; hint: string }> = [
  { value: 'local', label: 'Local', hint: 'Datasets published on this platform.' },
  {
    value: 'federated',
    label: 'Federated',
    hint: 'Mirrors of datasets harvested from peer catalogues.',
  },
  { value: 'all', label: 'All', hint: 'Everything — local first, federated to fill the page.' },
];

const SORT_OPTIONS: ReadonlyArray<{ value: ListDatasetsSort; label: string }> = [
  { value: 'recent', label: 'Most recent' },
  { value: 'name', label: 'Name' },
  { value: 'oldest', label: 'Oldest' },
];

// Curated facet vocabularies. Hand-picked subsets of what's likely
// in real-world manifests; the API search uses ILIKE so values
// outside this list still match if hosts use them in the manifest.
const MODALITY_OPTIONS = ['X-ray', 'CT', 'MRI', 'Ultrasound', 'Fundus', 'Pathology'];
const BODY_REGION_OPTIONS = ['Chest', 'Retina', 'Brain', 'Abdomen', 'Skin', 'Cardiovascular'];
const CONDITION_OPTIONS = [
  'Pneumonia',
  'Diabetic retinopathy',
  'Cancer',
  'Tuberculosis',
  'COVID-19',
  'Cardiac arrhythmia',
];
const LICENSE_OPTIONS = [
  { label: 'CC-BY-4.0', value: 'creativecommons.org/licenses/by/4.0' },
  { label: 'CC-BY-NC-4.0', value: 'creativecommons.org/licenses/by-nc/4.0' },
  { label: 'CC0', value: 'creativecommons.org/publicdomain/zero' },
  { label: 'MIT', value: 'MIT' },
  { label: 'Apache 2.0', value: 'Apache' },
];
const ANON_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'ANONYMIZED', label: 'Anonymised' },
  { value: 'PSEUDONYMIZED', label: 'Pseudonymised' },
  { value: 'IDENTIFIED', label: 'Identified' },
];

function normaliseSource(value: string | undefined): DatasetSource {
  return value === 'federated' || value === 'all' ? value : 'local';
}

function normaliseSort(value: string | undefined): ListDatasetsSort {
  return value === 'name' || value === 'oldest' ? value : 'recent';
}

/** Coerce a single-or-array param to an always-array of strings. */
function toArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v.filter((s) => s.length > 0) : v.length > 0 ? [v] : [];
}

const visibilityTone: Record<DatasetVisibility, 'success' | 'info' | 'warning'> = {
  PUBLIC: 'success',
  RESTRICTED: 'warning',
  PRIVATE: 'info',
};

const visibilityAccent: Record<DatasetVisibility, 'success' | 'warning' | 'info'> = {
  PUBLIC: 'success',
  RESTRICTED: 'warning',
  PRIVATE: 'info',
};

const visibilityLabel: Record<DatasetVisibility, string> = {
  PUBLIC: 'public',
  RESTRICTED: 'restricted',
  PRIVATE: 'private',
};

export const metadata = {
  title: 'Catalog — OCI Platform',
  description:
    'Discover datasets curated under the GI-AI4H Topic Groups, with provenance and consent tracked end-to-end.',
};

interface FilterState {
  q?: string;
  source: DatasetSource;
  sort: ListDatasetsSort;
  modality: string[];
  bodyRegion: string[];
  condition: string[];
  anonymizationLevel: string | null;
  license: string[];
  duoTerms: string[];
  /** Commercial-use facet (#119). `null` = no filter. */
  commercialUseTerms: 'OK' | 'NON_COMMERCIAL_ONLY' | 'CASE_BY_CASE' | null;
  page: number;
}

function parseFilters(params: SearchParams): FilterState {
  return {
    q: params.q,
    source: normaliseSource(params.source),
    sort: normaliseSort(params.sort),
    modality: toArray(params.modality),
    bodyRegion: toArray(params.bodyRegion),
    condition: toArray(params.condition),
    anonymizationLevel: params.anonymizationLevel ?? null,
    license: toArray(params.license),
    duoTerms: toArray(params.duoTerms),
    commercialUseTerms: normaliseCommercial(params.commercialUseTerms),
    page: Math.max(1, Number(params.page ?? '1') || 1),
  };
}

function normaliseCommercial(
  v: string | undefined,
): 'OK' | 'NON_COMMERCIAL_ONLY' | 'CASE_BY_CASE' | null {
  if (v === 'OK' || v === 'NON_COMMERCIAL_ONLY' || v === 'CASE_BY_CASE') return v;
  return null;
}

/**
 * Compose the `URLSearchParams` for an outgoing link. We intentionally
 * do not include defaults (page=1, source=local, sort=recent) so
 * canonical URLs stay short. Pass overrides to flip a single facet
 * without rebuilding the whole struct.
 */
function buildUrl(state: FilterState, overrides: Partial<FilterState>): string {
  const merged: FilterState = { ...state, ...overrides };
  const qs = new URLSearchParams();
  if (merged.q) qs.set('q', merged.q);
  if (merged.source !== 'local') qs.set('source', merged.source);
  if (merged.sort !== 'recent') qs.set('sort', merged.sort);
  for (const v of merged.modality) qs.append('modality', v);
  for (const v of merged.bodyRegion) qs.append('bodyRegion', v);
  for (const v of merged.condition) qs.append('condition', v);
  if (merged.anonymizationLevel) qs.set('anonymizationLevel', merged.anonymizationLevel);
  for (const v of merged.license) qs.append('license', v);
  for (const v of merged.duoTerms) qs.append('duoTerms', v);
  if (merged.commercialUseTerms) qs.set('commercialUseTerms', merged.commercialUseTerms);
  if (merged.page > 1) qs.set('page', String(merged.page));
  const s = qs.toString();
  return s.length > 0 ? `/catalog?${s}` : '/catalog';
}

/** Toggle a value in a multi-select facet. Resets to page 1. */
function toggleArrayFilter(
  state: FilterState,
  field: 'modality' | 'bodyRegion' | 'condition' | 'license' | 'duoTerms',
  value: string,
): string {
  // The `field` argument is a closed string-literal union typed at
  // compile time; safe object access.
  // eslint-disable-next-line security/detect-object-injection
  const current = state[field];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return buildUrl(state, { [field]: next, page: 1 });
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await auth();
  const canCreateDataset = isHost(session);
  const filters = parseFilters(params);

  const apiQs = new URLSearchParams();
  if (filters.q) apiQs.set('q', filters.q);
  apiQs.set('source', filters.source);
  apiQs.set('sort', filters.sort);
  apiQs.set('limit', String(PAGE_SIZE));
  apiQs.set('page', String(filters.page));
  for (const v of filters.modality) apiQs.append('modality', v);
  for (const v of filters.bodyRegion) apiQs.append('bodyRegion', v);
  for (const v of filters.condition) apiQs.append('condition', v);
  if (filters.anonymizationLevel) apiQs.set('anonymizationLevel', filters.anonymizationLevel);
  for (const v of filters.license) apiQs.append('license', v);
  for (const v of filters.duoTerms) apiQs.append('duoTerms', v);
  if (filters.commercialUseTerms) apiQs.set('commercialUseTerms', filters.commercialUseTerms);

  let response: ListDatasetsResponse | null = null;
  let error: string | null = null;
  try {
    response = await apiFetch<ListDatasetsResponse>(`/v2/catalog/datasets?${apiQs.toString()}`, {
      session,
      revalidate: 0,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unable to reach catalog API';
  }

  return (
    <Container>
      <Section spacing="md">
        <header className="mb-6 flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Catalog
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Datasets</h1>
            <div className="flex items-center gap-4">
              {response ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  <span className="text-[var(--color-foreground)] font-medium tabular-nums">
                    {response.totalEstimate.toLocaleString('en-GB')}
                  </span>{' '}
                  {response.totalEstimate === 1 ? 'dataset' : 'datasets'}
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
              {canCreateDataset ? (
                <Button asChild size="sm">
                  <Link href="/catalog/new">New dataset</Link>
                </Button>
              ) : null}
            </div>
          </div>
          <p className="max-w-2xl text-[var(--color-muted-foreground)]">
            Browse the GI-AI4H curated catalogue. Each dataset ships a Croissant 1.1 manifest with
            RAI + BIOCroissant health metadata; restricted rows require approval before download.
          </p>
        </header>

        <form action="/catalog" method="get" role="search" className="mb-4 flex flex-wrap gap-2">
          <label htmlFor="catalog-search" className="sr-only">
            Search datasets
          </label>
          <Input
            id="catalog-search"
            type="search"
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder="Search by name, slug, or description"
            leadingIcon={<SearchIcon size={16} />}
            className="min-w-0 flex-1 sm:flex-1"
          />
          <input type="hidden" name="source" value={filters.source} />
          {filters.sort !== 'recent' ? (
            <input type="hidden" name="sort" value={filters.sort} />
          ) : null}
          {filters.modality.map((v) => (
            <input key={`m-${v}`} type="hidden" name="modality" value={v} />
          ))}
          {filters.bodyRegion.map((v) => (
            <input key={`b-${v}`} type="hidden" name="bodyRegion" value={v} />
          ))}
          {filters.condition.map((v) => (
            <input key={`c-${v}`} type="hidden" name="condition" value={v} />
          ))}
          {filters.anonymizationLevel ? (
            <input type="hidden" name="anonymizationLevel" value={filters.anonymizationLevel} />
          ) : null}
          {filters.license.map((v) => (
            <input key={`l-${v}`} type="hidden" name="license" value={v} />
          ))}
          {filters.duoTerms.map((v) => (
            <input key={`d-${v}`} type="hidden" name="duoTerms" value={v} />
          ))}
          {filters.commercialUseTerms ? (
            <input type="hidden" name="commercialUseTerms" value={filters.commercialUseTerms} />
          ) : null}
          <Button type="submit">Search</Button>
        </form>

        <SourceChips filters={filters} />

        <AppliedFilters filters={filters} />

        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <FilterPanel filters={filters} />
          <div className="min-w-0">
            <SortToolbar filters={filters} response={response} />
            {error ? (
              <Alert tone="danger">
                <AlertTitle>Catalog unavailable</AlertTitle>
                <AlertDescription>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-xs font-mono">
                    {error}
                  </pre>
                </AlertDescription>
              </Alert>
            ) : !response || response.items.length === 0 ? (
              <EmptyState filters={filters} />
            ) : (
              <>
                <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {response.items.map((d) => (
                    <li key={d.id}>
                      <DatasetCard d={d} />
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
    <aside
      aria-label="Filters"
      className="space-y-5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-auto"
    >
      <FacetSection
        title="Imaging modality"
        options={MODALITY_OPTIONS.map((v) => ({ label: v, value: v }))}
        selected={filters.modality}
        toggleHref={(v) => toggleArrayFilter(filters, 'modality', v)}
      />
      <FacetSection
        title="Body region"
        options={BODY_REGION_OPTIONS.map((v) => ({ label: v, value: v }))}
        selected={filters.bodyRegion}
        toggleHref={(v) => toggleArrayFilter(filters, 'bodyRegion', v)}
      />
      <FacetSection
        title="Disease / condition"
        options={CONDITION_OPTIONS.map((v) => ({ label: v, value: v }))}
        selected={filters.condition}
        toggleHref={(v) => toggleArrayFilter(filters, 'condition', v)}
      />
      <FacetSection
        title="Anonymisation"
        options={ANON_OPTIONS}
        selected={filters.anonymizationLevel ? [filters.anonymizationLevel] : []}
        toggleHref={(v) =>
          buildUrl(filters, {
            anonymizationLevel: filters.anonymizationLevel === v ? null : v,
            page: 1,
          })
        }
      />
      <FacetSection
        title="License"
        options={LICENSE_OPTIONS}
        selected={filters.license}
        toggleHref={(v) => toggleArrayFilter(filters, 'license', v)}
      />
      <FacetSection
        title="Data use (DUO)"
        options={DUO_REGISTRY.filter((t) => t.category === 'permission').map((t) => ({
          label: `${t.code} — ${t.label}`,
          value: t.id,
        }))}
        selected={filters.duoTerms}
        toggleHref={(v) => toggleArrayFilter(filters, 'duoTerms', v)}
      />
      <FacetSection
        title="Commercial use"
        options={[
          { label: 'OK for commercial use', value: 'OK' },
          { label: 'Non-commercial only', value: 'NON_COMMERCIAL_ONLY' },
          { label: 'Case-by-case', value: 'CASE_BY_CASE' },
        ]}
        selected={filters.commercialUseTerms ? [filters.commercialUseTerms] : []}
        toggleHref={(v) =>
          buildUrl(filters, {
            commercialUseTerms:
              filters.commercialUseTerms === v
                ? null
                : (v as 'OK' | 'NON_COMMERCIAL_ONLY' | 'CASE_BY_CASE'),
            page: 1,
          })
        }
      />
    </aside>
  );
}

interface FacetOption {
  label: string;
  value: string;
}
function FacetSection({
  title,
  options,
  selected,
  toggleHref,
}: {
  title: string;
  options: ReadonlyArray<FacetOption>;
  selected: string[];
  toggleHref: (value: string) => string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
        {title}
      </legend>
      <ul className="space-y-1">
        {options.map((opt) => {
          const isSelected = selected.includes(opt.value);
          return (
            <li key={opt.value}>
              <Link
                href={toggleHref(opt.value)}
                aria-pressed={isSelected}
                className={
                  'flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
                  (isSelected
                    ? 'bg-[var(--color-primary-soft)] text-[var(--color-foreground)] font-medium'
                    : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]')
                }
              >
                <span
                  aria-hidden="true"
                  className={
                    'inline-block h-3 w-3 flex-shrink-0 rounded border ' +
                    (isSelected
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]'
                      : 'border-[var(--color-border-strong)]')
                  }
                />
                <span className="truncate">{opt.label}</span>
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

  for (const v of filters.modality) {
    chips.push({ label: `Modality: ${v}`, href: toggleArrayFilter(filters, 'modality', v) });
  }
  for (const v of filters.bodyRegion) {
    chips.push({ label: `Body: ${v}`, href: toggleArrayFilter(filters, 'bodyRegion', v) });
  }
  for (const v of filters.condition) {
    chips.push({ label: `Condition: ${v}`, href: toggleArrayFilter(filters, 'condition', v) });
  }
  if (filters.anonymizationLevel) {
    chips.push({
      label: `Anonymisation: ${filters.anonymizationLevel.toLowerCase()}`,
      href: buildUrl(filters, { anonymizationLevel: null, page: 1 }),
    });
  }
  for (const v of filters.license) {
    const opt = LICENSE_OPTIONS.find((o) => o.value === v);
    chips.push({
      label: `License: ${opt?.label ?? v}`,
      href: toggleArrayFilter(filters, 'license', v),
    });
  }
  for (const v of filters.duoTerms) {
    const t = lookupDuoTerm(v);
    chips.push({
      label: `DUO: ${t?.code ?? v}`,
      href: toggleArrayFilter(filters, 'duoTerms', v),
    });
  }
  if (filters.commercialUseTerms) {
    const label =
      filters.commercialUseTerms === 'OK'
        ? 'commercial OK'
        : filters.commercialUseTerms === 'NON_COMMERCIAL_ONLY'
          ? 'non-commercial only'
          : 'case-by-case';
    chips.push({
      label: `Commercial: ${label}`,
      href: buildUrl(filters, { commercialUseTerms: null, page: 1 }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
        Applied
      </span>
      {chips.map((c, i) => (
        <Link
          key={i}
          href={c.href}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1 text-xs font-medium text-[var(--color-foreground)] hover:bg-[var(--color-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          <span>{c.label}</span>
          <span aria-hidden="true">×</span>
          <span className="sr-only">Remove filter</span>
        </Link>
      ))}
      <Link
        href={
          filters.q
            ? buildUrl(
                {
                  ...filters,
                  modality: [],
                  bodyRegion: [],
                  condition: [],
                  anonymizationLevel: null,
                  license: [],
                  duoTerms: [],
                  commercialUseTerms: null,
                  page: 1,
                },
                {},
              )
            : '/catalog'
        }
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
  response: ListDatasetsResponse | null;
}) {
  if (!response) return null;
  const start = (filters.page - 1) * PAGE_SIZE + 1;
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
              {response.totalEstimate.toLocaleString('en-GB')}
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
  response: ListDatasetsResponse;
}) {
  // Use the API's authoritative `totalPages` when in page mode; fall
  // back to "show prev/next only" when the API didn't compute it
  // (cursor mode, federated path).
  const totalPages = response.totalPages ?? null;
  const current = filters.page;
  const prev = current > 1 ? buildUrl(filters, { page: current - 1 }) : null;
  const next = totalPages && current < totalPages ? buildUrl(filters, { page: current + 1 }) : null;
  if (!prev && !next && (!totalPages || totalPages <= 1)) return null;

  // Compact page-number list: first / current ± 2 / last with ellipses.
  const numbers: Array<{ key: string; label: string; href: string | null; active: boolean }> = [];
  if (totalPages) {
    const window = new Set<number>([1, totalPages]);
    for (let i = current - 2; i <= current + 2; i++) {
      if (i >= 1 && i <= totalPages) window.add(i);
    }
    const sorted = [...window].sort((a, b) => a - b);
    let prevPage = 0;
    for (const p of sorted) {
      if (p - prevPage > 1) {
        numbers.push({ key: `gap-${p}`, label: '…', href: null, active: false });
      }
      numbers.push({
        key: `p-${p}`,
        label: String(p),
        href: buildUrl(filters, { page: p }),
        active: p === current,
      });
      prevPage = p;
    }
  }

  return (
    <nav
      aria-label="Pagination"
      className="mt-10 flex flex-wrap items-center justify-center gap-2 text-sm"
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
      {numbers.map((n) =>
        n.href ? (
          <Link
            key={n.key}
            href={n.href}
            aria-current={n.active ? 'page' : undefined}
            className={
              'inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-2 text-sm tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
              (n.active
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] font-medium text-[var(--color-foreground)]'
                : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]')
            }
          >
            {n.label}
          </Link>
        ) : (
          <span
            key={n.key}
            aria-hidden="true"
            className="inline-flex h-9 items-center px-1 text-[var(--color-muted-foreground)]"
          >
            {n.label}
          </span>
        ),
      )}
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

function DatasetCard({ d }: { d: DatasetSummary }) {
  const isFederated = d.sourceCatalog !== null;
  const href = isFederated ? (d.originUrl ?? '#') : `/catalog/${d.slug}`;
  const linkProps = isFederated
    ? ({ target: '_blank', rel: 'noreferrer noopener' } as const)
    : ({} as const);

  return (
    <Link
      href={href}
      {...linkProps}
      aria-label={
        isFederated
          ? `${d.name} — opens upstream on ${d.sourceCatalog?.name} in a new tab`
          : undefined
      }
      className="group block h-full rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
    >
      <Card accent={visibilityAccent[d.visibility]} interactive="hover" className="h-full">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="line-clamp-2 group-hover:text-[var(--color-primary)] transition-colors">
              {d.name}
            </CardTitle>
            {isFederated ? (
              <Badge tone="accent">federated</Badge>
            ) : (
              <Badge tone={visibilityTone[d.visibility]}>{visibilityLabel[d.visibility]}</Badge>
            )}
          </div>
          <CardDescription className="line-clamp-3 min-h-[3.5rem]">
            {d.description ?? <em>No description provided.</em>}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-muted-foreground)]">
          <span className="min-w-0 truncate font-mono">{d.slug}</span>
          {/* `shrink-0`: the badge row keeps its intrinsic width and the slug
              truncates instead — otherwise a long slug squeezes the badges. */}
          <span className="flex shrink-0 items-center gap-1.5">
            {/* Commercial-use band on the card (#119). Only emphasised
                when the host has explicitly granted (`OK`) or refused
                (`NON_COMMERCIAL_ONLY`); CASE_BY_CASE is the conservative
                default and would noise-up every card if shown. */}
            {!isFederated && d.commercialUseTerms === 'OK' ? (
              <Badge tone="success">commercial OK</Badge>
            ) : !isFederated && d.commercialUseTerms === 'NON_COMMERCIAL_ONLY' ? (
              <Badge tone="warning">non-commercial</Badge>
            ) : null}
            {isFederated ? (
              <Badge tone="neutral">from {d.sourceCatalog?.name}</Badge>
            ) : d.latestVersion ? (
              <Badge tone="primary">v{d.latestVersion}</Badge>
            ) : (
              <Badge tone="neutral">no version</Badge>
            )}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

function SourceChips({ filters }: { filters: FilterState }) {
  return (
    <nav aria-label="Source filter" className="mb-4 flex flex-wrap gap-2">
      {SOURCE_OPTIONS.map((opt) => {
        const isActive = opt.value === filters.source;
        const href = buildUrl(filters, { source: opt.value, page: 1 });
        return (
          <Link
            key={opt.value}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            title={opt.hint}
            className={
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
              (isActive
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]/40 text-[var(--color-foreground)]'
                : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]')
            }
          >
            {opt.label}
          </Link>
        );
      })}
    </nav>
  );
}

function EmptyState({ filters }: { filters: FilterState }) {
  const hasFilters =
    filters.q ||
    filters.modality.length > 0 ||
    filters.bodyRegion.length > 0 ||
    filters.condition.length > 0 ||
    filters.anonymizationLevel ||
    filters.license.length > 0 ||
    filters.duoTerms.length > 0 ||
    filters.commercialUseTerms !== null;
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-12 text-center">
      <span
        className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-[var(--shadow-xs)]"
        aria-hidden="true"
      >
        <DatabaseIcon size={20} />
      </span>
      <h2 className="mt-4 text-lg font-semibold">
        {hasFilters ? 'No matches yet' : 'No datasets yet'}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-muted-foreground)]">
        {hasFilters ? (
          <>Try fewer filters, or broaden your search to find more datasets.</>
        ) : (
          <>
            The catalogue is empty on this environment. Once hosts publish the first Croissant 1.1
            manifests, they will appear here.
          </>
        )}
      </p>
      {hasFilters ? (
        <div className="mt-5">
          <Button asChild variant="outline" size="sm">
            <Link href="/catalog">Clear all filters</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

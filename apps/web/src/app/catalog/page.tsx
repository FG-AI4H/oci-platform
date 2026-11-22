import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
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
  AnonymizationLevel,
  DatasetSource,
  DatasetSummary,
  DatasetVisibility,
  ListDatasetsResponse,
  ListDatasetsSort,
} from '@oci/shared-types';
import { DUO_REGISTRY, lookupDuoTerm } from '@oci/croissant';
import { auth } from '../../auth';
import { isHost } from '../../lib/groups';
import { viewerUuid } from '../../lib/identity';
import { apiFetch } from '../../lib/api';
import { ANONYMIZATION_OPTIONS, normaliseAnonymizationLevel } from '../../lib/catalog-filters';
import { getFormatters } from '../../i18n/server';

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
 *
 * Text comes from the `Catalog` messages (#654). Facet values stay
 * English in the URL and the API query; only their labels translate.
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
  /** `1` = only the signed-in host's own datasets, drafts included. */
  mine?: string;
}

// Labels and hints are in the `Catalog` messages (`source.*`).
const SOURCE_OPTIONS = [
  { value: 'local', label: 'source.local', hint: 'source.localHint' },
  { value: 'federated', label: 'source.federated', hint: 'source.federatedHint' },
  { value: 'all', label: 'source.all', hint: 'source.allHint' },
] as const satisfies ReadonlyArray<{ value: DatasetSource; label: string; hint: string }>;

// Labels are in the `Catalog` messages (`sort.*`).
const SORT_OPTIONS: ReadonlyArray<ListDatasetsSort> = ['recent', 'name', 'oldest'];

// Curated facet vocabularies. Hand-picked subsets of what's likely
// in real-world manifests; the API search uses ILIKE so values
// outside this list still match if hosts use them in the manifest.
// `value` reaches the URL and the API (English, as in the manifests);
// `key` names the displayed label in the `Catalog` messages.
const MODALITY_OPTIONS = [
  { value: 'X-ray', key: 'xRay' },
  { value: 'CT', key: 'ct' },
  { value: 'MRI', key: 'mri' },
  { value: 'Ultrasound', key: 'ultrasound' },
  { value: 'Fundus', key: 'fundus' },
  { value: 'Pathology', key: 'pathology' },
] as const;
const BODY_REGION_OPTIONS = [
  { value: 'Chest', key: 'chest' },
  { value: 'Retina', key: 'retina' },
  { value: 'Brain', key: 'brain' },
  { value: 'Abdomen', key: 'abdomen' },
  { value: 'Skin', key: 'skin' },
  { value: 'Cardiovascular', key: 'cardiovascular' },
] as const;
const CONDITION_OPTIONS = [
  { value: 'Pneumonia', key: 'pneumonia' },
  { value: 'Diabetic retinopathy', key: 'diabeticRetinopathy' },
  { value: 'Cancer', key: 'cancer' },
  { value: 'Tuberculosis', key: 'tuberculosis' },
  { value: 'COVID-19', key: 'covid19' },
  { value: 'Cardiac arrhythmia', key: 'cardiacArrhythmia' },
] as const;
const LICENSE_OPTIONS = [
  { label: 'CC-BY-4.0', value: 'creativecommons.org/licenses/by/4.0' },
  { label: 'CC-BY-NC-4.0', value: 'creativecommons.org/licenses/by-nc/4.0' },
  { label: 'CC0', value: 'creativecommons.org/publicdomain/zero' },
  { label: 'MIT', value: 'MIT' },
  { label: 'Apache 2.0', value: 'Apache' },
];
const COMMERCIAL_OPTIONS = ['OK', 'NON_COMMERCIAL_ONLY', 'CASE_BY_CASE'] as const;

/** The known anonymisation level a URL value names, or `undefined`. */
function knownAnonymizationLevel(value: string): AnonymizationLevel | undefined {
  return ANONYMIZATION_OPTIONS.find((o) => o.value === value)?.value;
}

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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Catalog');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

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
  /** The host's own rows, every status. Ignored for viewers who are not hosts. */
  mine: boolean;
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
    anonymizationLevel: normaliseAnonymizationLevel(params.anonymizationLevel),
    license: toArray(params.license),
    duoTerms: toArray(params.duoTerms),
    commercialUseTerms: normaliseCommercial(params.commercialUseTerms),
    mine: params.mine === '1',
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
  if (merged.mine) qs.set('mine', '1');
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
  const [session, t, f] = await Promise.all([auth(), getTranslations('Catalog'), getFormatters()]);
  const canCreateDataset = isHost(session);
  const filters = parseFilters(params);
  // "My datasets": the API returns every status for a host's own rows,
  // so an abandoned draft can be found and finished. Nobody else can
  // list drafts; see the catalogue service's status rule.
  const ownerId = canCreateDataset && filters.mine ? viewerUuid(session) : null;

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
  if (ownerId) apiQs.set('hostId', ownerId);

  let response: ListDatasetsResponse | null = null;
  let error: string | null = null;
  try {
    response = await apiFetch<ListDatasetsResponse>(`/v2/catalog/datasets?${apiQs.toString()}`, {
      session,
      revalidate: 0,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : t('error.unreachable');
  }
  const formattedTotal = response ? f.number(response.totalEstimate) : '';
  const countNumber = (chunks: ReactNode) => (
    <span className="text-[var(--color-foreground)] font-medium tabular-nums">{chunks}</span>
  );

  return (
    <Container size="wide">
      <Section spacing="md">
        <header className="mb-6 flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {t('eyebrow')}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t('heading')}</h1>
            <div className="flex items-center gap-4">
              {response ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  {filters.q
                    ? t.rich('resultCountMatching', {
                        total: formattedTotal,
                        count: response.totalEstimate,
                        q: filters.q,
                        num: countNumber,
                        query: (chunks) => (
                          <span className="text-[var(--color-foreground)]">{chunks}</span>
                        ),
                      })
                    : t.rich('resultCount', {
                        total: formattedTotal,
                        count: response.totalEstimate,
                        num: countNumber,
                      })}
                </p>
              ) : null}
              {canCreateDataset ? (
                <>
                  <Button asChild size="sm" variant={filters.mine ? 'primary' : 'outline'}>
                    <Link
                      href={buildUrl(filters, { mine: !filters.mine, page: 1 })}
                      aria-pressed={filters.mine}
                    >
                      {t('myDatasets')}
                    </Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link href="/catalog/new">{t('newDataset')}</Link>
                  </Button>
                </>
              ) : null}
            </div>
          </div>
          <p className="max-w-2xl text-[var(--color-muted-foreground)]">{t('intro')}</p>
        </header>

        <form action="/catalog" method="get" role="search" className="mb-4 flex flex-wrap gap-2">
          <label htmlFor="catalog-search" className="sr-only">
            {t('search.label')}
          </label>
          <Input
            id="catalog-search"
            type="search"
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder={t('search.placeholder')}
            leadingIcon={<SearchIcon size={16} />}
            wrapperClassName="min-w-0 flex-1"
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
          <Button type="submit">{t('search.submit')}</Button>
        </form>

        <SourceChips filters={filters} />

        <AppliedFilters filters={filters} />

        <div className="grid gap-6 lg:grid-cols-[16rem_1fr] lg:gap-8">
          <div className="min-w-0">
            {/* Below lg the facets would push every result under ~30 links, so
                they collapse behind a native disclosure (no JS). At lg+ the
                rail is always visible and scrolls with the page. */}
            <details className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] lg:hidden">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] [&::-webkit-details-marker]:hidden">
                {t('filters.title')}
                {activeFilterCount(filters) > 0 ? (
                  <Badge tone="primary">
                    {t('filters.activeCount', { count: activeFilterCount(filters) })}
                  </Badge>
                ) : null}
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
            <SortToolbar filters={filters} response={response} formattedTotal={formattedTotal} />
            {error ? (
              <Alert tone="danger">
                <AlertTitle>{t('error.title')}</AlertTitle>
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
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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

function activeFilterCount(filters: FilterState): number {
  return (
    filters.modality.length +
    filters.bodyRegion.length +
    filters.condition.length +
    filters.license.length +
    filters.duoTerms.length +
    (filters.anonymizationLevel ? 1 : 0) +
    (filters.commercialUseTerms ? 1 : 0)
  );
}

function FilterPanel({ filters }: { filters: FilterState }) {
  const t = useTranslations('Catalog');
  // No sticky / max-height / inner overflow: seven facet groups are taller
  // than any viewport, so a sticky rail always grew its own scrollbars (#597).
  return (
    <aside aria-label={t('filters.title')} className="space-y-5">
      <FacetSection
        title={t('facets.modality')}
        options={MODALITY_OPTIONS.map((o) => ({ label: t(`modalities.${o.key}`), value: o.value }))}
        selected={filters.modality}
        toggleHref={(v) => toggleArrayFilter(filters, 'modality', v)}
      />
      <FacetSection
        title={t('facets.bodyRegion')}
        options={BODY_REGION_OPTIONS.map((o) => ({
          label: t(`bodyRegions.${o.key}`),
          value: o.value,
        }))}
        selected={filters.bodyRegion}
        toggleHref={(v) => toggleArrayFilter(filters, 'bodyRegion', v)}
      />
      <FacetSection
        title={t('facets.condition')}
        options={CONDITION_OPTIONS.map((o) => ({
          label: t(`conditions.${o.key}`),
          value: o.value,
        }))}
        selected={filters.condition}
        toggleHref={(v) => toggleArrayFilter(filters, 'condition', v)}
      />
      <FacetSection
        title={t('facets.anonymization')}
        options={ANONYMIZATION_OPTIONS.map((o) => ({
          label: t(`anonymization.${o.value}`),
          value: o.value,
        }))}
        selected={filters.anonymizationLevel ? [filters.anonymizationLevel] : []}
        toggleHref={(v) =>
          buildUrl(filters, {
            anonymizationLevel: filters.anonymizationLevel === v ? null : v,
            page: 1,
          })
        }
      />
      <FacetSection
        title={t('facets.license')}
        options={LICENSE_OPTIONS}
        selected={filters.license}
        toggleHref={(v) => toggleArrayFilter(filters, 'license', v)}
      />
      <FacetSection
        title={t('facets.duo')}
        // DUO term labels come from the ontology (English), as in the manifests.
        options={DUO_REGISTRY.filter((term) => term.category === 'permission').map((term) => ({
          label: `${term.code} — ${term.label}`,
          value: term.id,
        }))}
        selected={filters.duoTerms}
        toggleHref={(v) => toggleArrayFilter(filters, 'duoTerms', v)}
      />
      <FacetSection
        title={t('facets.commercialUse')}
        options={COMMERCIAL_OPTIONS.map((v) => ({ label: t(`commercial.${v}`), value: v }))}
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
  const t = useTranslations('Catalog');
  return (
    // `min-w-0`: fieldsets default to `min-inline-size: min-content`, which
    // let long DUO / anonymisation labels widen the rail instead of truncating.
    <fieldset className="min-w-0 space-y-2">
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
                // These are navigation links (SSR faceted search), so `aria-pressed`
                // is invalid (it needs a button/checkbox role) — axe critical (#148).
                // `aria-current` is valid on <a> and marks the active filter; the
                // sr-only suffix makes the toggle affordance explicit for AT.
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
                    'inline-block h-3 w-3 flex-shrink-0 rounded border ' +
                    (isSelected
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]'
                      : 'border-[var(--color-border-strong)]')
                  }
                />
                <span className="truncate">{opt.label}</span>
                <span className="sr-only">
                  {' '}
                  {isSelected ? t('filters.selectedHint') : t('filters.unselectedHint')}
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
  const t = useTranslations('Catalog');
  const chips: Array<{ label: string; href: string }> = [];

  // A URL value outside the curated lists still filters; its chip shows it as typed.
  for (const v of filters.modality) {
    const opt = MODALITY_OPTIONS.find((o) => o.value === v);
    chips.push({
      label: t('chips.modality', { value: opt ? t(`modalities.${opt.key}`) : v }),
      href: toggleArrayFilter(filters, 'modality', v),
    });
  }
  for (const v of filters.bodyRegion) {
    const opt = BODY_REGION_OPTIONS.find((o) => o.value === v);
    chips.push({
      label: t('chips.bodyRegion', { value: opt ? t(`bodyRegions.${opt.key}`) : v }),
      href: toggleArrayFilter(filters, 'bodyRegion', v),
    });
  }
  for (const v of filters.condition) {
    const opt = CONDITION_OPTIONS.find((o) => o.value === v);
    chips.push({
      label: t('chips.condition', { value: opt ? t(`conditions.${opt.key}`) : v }),
      href: toggleArrayFilter(filters, 'condition', v),
    });
  }
  if (filters.anonymizationLevel) {
    const level = knownAnonymizationLevel(filters.anonymizationLevel);
    chips.push({
      label: t('chips.anonymization', {
        value: level ? t(`anonymization.${level}`) : filters.anonymizationLevel,
      }),
      href: buildUrl(filters, { anonymizationLevel: null, page: 1 }),
    });
  }
  for (const v of filters.license) {
    const opt = LICENSE_OPTIONS.find((o) => o.value === v);
    chips.push({
      label: t('chips.license', { value: opt?.label ?? v }),
      href: toggleArrayFilter(filters, 'license', v),
    });
  }
  for (const v of filters.duoTerms) {
    const term = lookupDuoTerm(v);
    chips.push({
      label: t('chips.duo', { value: term?.code ?? v }),
      href: toggleArrayFilter(filters, 'duoTerms', v),
    });
  }
  if (filters.commercialUseTerms) {
    chips.push({
      label: t('chips.commercial', {
        value: t(`chips.commercialValue.${filters.commercialUseTerms}`),
      }),
      href: buildUrl(filters, { commercialUseTerms: null, page: 1 }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
        {t('chips.applied')}
      </span>
      {chips.map((c, i) => (
        <Link
          key={i}
          href={c.href}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1 text-xs font-medium text-[var(--color-foreground)] hover:bg-[var(--color-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          <span>{c.label}</span>
          <span aria-hidden="true">×</span>
          <span className="sr-only">{t('chips.removeFilter')}</span>
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
        {t('chips.clearAll')}
      </Link>
    </div>
  );
}

function SortToolbar({
  filters,
  response,
  formattedTotal,
}: {
  filters: FilterState;
  response: ListDatasetsResponse | null;
  /** `response.totalEstimate` formatted in the interface language. */
  formattedTotal: string;
}) {
  const t = useTranslations('Catalog');
  if (!response) return null;
  const start = (filters.page - 1) * PAGE_SIZE + 1;
  const end = start + response.items.length - 1;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-[var(--color-muted-foreground)]">
        {response.items.length === 0
          ? t('results.none')
          : t.rich('results.showing', {
              start,
              end,
              total: formattedTotal,
              range: (chunks) => (
                <span className="text-[var(--color-foreground)] tabular-nums">{chunks}</span>
              ),
              num: (chunks) => (
                <span className="text-[var(--color-foreground)] tabular-nums">{chunks}</span>
              ),
            })}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--color-muted-foreground)]">{t('sort.label')}</span>
        <nav
          aria-label={t('sort.label')}
          className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-0.5 text-xs"
        >
          {SORT_OPTIONS.map((sort) => {
            const isActive = filters.sort === sort;
            return (
              <Link
                key={sort}
                href={buildUrl(filters, { sort, page: 1 })}
                aria-current={isActive ? 'page' : undefined}
                className={
                  'rounded px-2.5 py-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
                  (isActive
                    ? 'bg-[var(--color-primary-soft)] text-[var(--color-foreground)] font-medium'
                    : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]')
                }
              >
                {t(`sort.${sort}`)}
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
  const t = useTranslations('Catalog');
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
      aria-label={t('pagination.label')}
      className="mt-10 flex flex-wrap items-center justify-center gap-2 text-sm"
    >
      {prev ? (
        <Button asChild variant="outline" size="sm">
          <Link href={prev} rel="prev">
            {t('pagination.prev')}
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          {t('pagination.prev')}
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
            {t('pagination.next')}
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          {t('pagination.next')}
        </Button>
      )}
    </nav>
  );
}

function DatasetCard({ d }: { d: DatasetSummary }) {
  const t = useTranslations('Catalog');
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
          ? t('card.opensUpstream', { name: d.name, catalog: d.sourceCatalog?.name ?? '' })
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
              <Badge tone="accent">{t('card.federated')}</Badge>
            ) : d.status !== 'PUBLISHED' ? (
              <Badge tone="neutral">{t(`status.${d.status}`)}</Badge>
            ) : (
              <Badge tone={visibilityTone[d.visibility]}>{t(`visibility.${d.visibility}`)}</Badge>
            )}
          </div>
          <CardDescription className="line-clamp-3 min-h-[3.5rem]">
            {d.description ?? <em>{t('card.noDescription')}</em>}
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
              <Badge tone="success">{t('card.commercialOk')}</Badge>
            ) : !isFederated && d.commercialUseTerms === 'NON_COMMERCIAL_ONLY' ? (
              <Badge tone="warning">{t('card.nonCommercial')}</Badge>
            ) : null}
            {isFederated ? (
              <Badge tone="neutral">
                {t('card.fromCatalog', { catalog: d.sourceCatalog?.name ?? '' })}
              </Badge>
            ) : d.latestVersion ? (
              <Badge tone="primary">v{d.latestVersion}</Badge>
            ) : (
              <Badge tone="neutral">{t('card.noVersion')}</Badge>
            )}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

function SourceChips({ filters }: { filters: FilterState }) {
  const t = useTranslations('Catalog');
  return (
    <nav aria-label={t('source.label')} className="mb-4 flex flex-wrap gap-2">
      {SOURCE_OPTIONS.map((opt) => {
        const isActive = opt.value === filters.source;
        const href = buildUrl(filters, { source: opt.value, page: 1 });
        return (
          <Link
            key={opt.value}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            title={t(opt.hint)}
            className={
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
              (isActive
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]/40 text-[var(--color-foreground)]'
                : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]')
            }
          >
            {t(opt.label)}
          </Link>
        );
      })}
    </nav>
  );
}

function EmptyState({ filters }: { filters: FilterState }) {
  const t = useTranslations('Catalog');
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
        {hasFilters ? t('empty.noMatchesTitle') : t('empty.noDatasetsTitle')}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-muted-foreground)]">
        {hasFilters ? t('empty.noMatchesBody') : t('empty.noDatasetsBody')}
      </p>
      {hasFilters ? (
        <div className="mt-5">
          <Button asChild variant="outline" size="sm">
            <Link href="/catalog">{t('empty.clearAllFilters')}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

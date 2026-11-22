/**
 * The filters of `/admin/audit` as they travel: in the page's URL (what
 * the form submits) and to the API (what `/v2/audit/events` reads).
 * Validation is the API's, with `AuditEventsQuerySchema`; this only
 * moves values between the two shapes.
 */

export const FILTER_KEYS = ['subjectType', 'subjectId', 'actor', 'action', 'from', 'to'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type PageFilters = Partial<Record<FilterKey, string>>;

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
}

/** The filters in the page's URL; empty fields are dropped. */
export function readFilters(params: SearchParams): PageFilters {
  const given = new Map(Object.entries(params));
  return Object.fromEntries(
    FILTER_KEYS.map((key) => [key, first(given.get(key))] as const).filter(
      ([, value]) => value !== undefined,
    ),
  ) as PageFilters;
}

export function readCursor(params: SearchParams): string | undefined {
  return first(params.cursor);
}

/**
 * A `datetime-local` value (`2026-11-22T09:30`) read as UTC, as the
 * form labels say, to the ISO form the API takes. A value that already
 * carries an offset passes unchanged; anything else passes unchanged
 * for the API to refuse.
 */
export function utcInstant(local: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return `${local}:00Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local)) return `${local}Z`;
  return local;
}

/** Query string for the API: the filters, times in UTC, plus extras. */
export function apiQuery(filters: PageFilters, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const [key, value] of ordered(filters)) {
    q.set(key, key === 'from' || key === 'to' ? utcInstant(value) : value);
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

/** Query string for a link back to this page. */
export function pageQuery(filters: PageFilters, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const [key, value] of ordered(filters)) q.set(key, value);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const text = q.toString();
  return text ? `?${text}` : '';
}

/** The filters that are set, in the order of `FILTER_KEYS`. */
function ordered(filters: PageFilters): [FilterKey, string][] {
  const set = new Map(Object.entries(filters));
  return FILTER_KEYS.flatMap((key) => {
    const value = set.get(key);
    return value === undefined ? [] : [[key, value] as [FilterKey, string]];
  });
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Field, Input, SearchIcon } from '@oci/ui';
import type { ListDatasetsResponse } from '@oci/shared-types';

interface PickedDataset {
  id: string;
  slug: string;
  name: string;
  accessTier: string;
}

export interface DatasetPickerProps {
  /**
   * Dataset already resolved server-side (typically from a
   * `?datasetSlug=` query param). When present, the picker renders
   * pre-populated.
   */
  preselected?: PickedDataset | null;
  /**
   * Echoed datasetId from a failed previous submission. We have only
   * the UUID at this point (the form re-displays values, not full
   * objects); the picker shows the UUID under a "previously selected
   * (unknown details)" affordance and the manager can `Change` to
   * pick again. Keeps `defaultValue` working for the existing form
   * error-recovery flow.
   */
  echoedValue?: string;
  /** Field-level error to render under the hidden input. */
  error?: string;
}

/**
 * Search-as-you-type dataset picker for `/annotation/campaigns/new`
 * (user feedback 2026-05-16). Replaces the bare UUID textbox.
 *
 * Backed by the existing `/v2/catalog/datasets?q=...&source=local`
 * endpoint, which already drives the catalog list page's free-text
 * search. We forward the selected dataset's UUID as `datasetId` (the
 * hidden input that the server action reads) so the API contract
 * doesn't change.
 *
 * Out of scope here: filtering the result set by modality / task-kind
 * compatibility — that's #247.
 */
export function DatasetPicker({ preselected, echoedValue, error }: DatasetPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedDataset[]>([]);
  const [picked, setPicked] = useState<PickedDataset | null>(preselected ?? null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Best-effort recovery: when an echoed UUID comes back from a
  // failed submission, try to resolve it to a friendly row. If the
  // search endpoint can't match by UUID we leave the picker empty and
  // surface the field error — the manager re-picks.
  useEffect(() => {
    if (!echoedValue || picked) return;
    let active = true;
    void resolveById(echoedValue).then((found) => {
      if (active && found) setPicked(found);
    });
    return () => {
      active = false;
    };
  }, [echoedValue, picked]);

  // Debounced search.
  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    setLoading(true);
    const handle = window.setTimeout(() => {
      void search(query)
        .then((rows) => {
          if (active) setResults(rows);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [query]);

  // Close the dropdown on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const clear = useCallback(() => {
    setPicked(null);
    setQuery('');
    setResults([]);
  }, []);

  return (
    <Field
      label="Dataset"
      htmlFor="field-dataset-search"
      required
      hint="Search the catalog by name or slug. Selecting fills in the dataset id."
      error={error}
    >
      <div ref={boxRef} className="relative">
        <input type="hidden" name="datasetId" value={picked?.id ?? ''} />

        {picked ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-primary)] bg-[var(--color-primary-soft)]/40 px-3 py-2 text-sm">
            <span className="flex-1 min-w-0">
              <span className="font-medium">{picked.name}</span>{' '}
              <span className="font-mono text-xs text-[var(--color-muted-foreground)]">
                {picked.slug}
              </span>
            </span>
            <button
              type="button"
              onClick={clear}
              className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] underline underline-offset-2"
              aria-label="Change dataset"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <Input
              id="field-dataset-search"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="Start typing a dataset name or slug…"
              leadingIcon={<SearchIcon size={16} />}
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls="dataset-picker-listbox"
            />
            {open && (query.length >= 2 || loading) ? (
              <ul
                id="dataset-picker-listbox"
                role="listbox"
                className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-md)]"
              >
                {loading ? (
                  <li className="px-3 py-2 text-sm text-[var(--color-muted-foreground)]">
                    Searching…
                  </li>
                ) : results.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-[var(--color-muted-foreground)]">
                    No datasets match.
                  </li>
                ) : (
                  results.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        role="option"
                        onClick={() => {
                          setPicked(d);
                          setOpen(false);
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--color-subtle)] focus-visible:bg-[var(--color-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
                      >
                        <span className="flex-1 min-w-0">
                          <span className="font-medium">{d.name}</span>{' '}
                          <span className="font-mono text-xs text-[var(--color-muted-foreground)]">
                            {d.slug}
                          </span>
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                          {d.accessTier}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </Field>
  );
}

async function search(q: string): Promise<PickedDataset[]> {
  // Hit the existing local-only catalog search. Federated rows have
  // UUIDs that don't FK to our annotation campaigns, so we exclude
  // them via `source=local`. Limit at 10 — anything more is noise in
  // a typeahead.
  const url = `/api/catalog-search?q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as ListDatasetsResponse;
    return body.items.slice(0, 10).map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      accessTier: row.accessTier ?? 'OPEN',
    }));
  } catch {
    return [];
  }
}

async function resolveById(id: string): Promise<PickedDataset | null> {
  // Use the same proxy endpoint; it returns a few rows, and we filter
  // for an exact id match. Cheap enough for the rare echo case.
  const res = await fetch(`/api/catalog-search?q=${encodeURIComponent(id)}`, {
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const body = (await res.json()) as ListDatasetsResponse;
  const found = body.items.find((row) => row.id === id);
  return found
    ? {
        id: found.id,
        slug: found.slug,
        name: found.name,
        accessTier: found.accessTier ?? 'OPEN',
      }
    : null;
}

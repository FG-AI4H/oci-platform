'use client';

import { useState, type ReactNode } from 'react';

/**
 * Three-tab switcher for the manifest section (PR L.2). Inline state,
 * no URL routing — the tab choice is ephemeral; users pick the view
 * they need for the current scroll session, no value to share.
 *
 * Server-component children are passed through verbatim; the client
 * boundary is just the tab list + visibility toggle.
 */

interface Tab {
  id: 'summary' | 'full' | 'raw';
  label: string;
}

const TABS: ReadonlyArray<Tab> = [
  { id: 'summary', label: 'Summary' },
  { id: 'full', label: 'Full manifest' },
  { id: 'raw', label: 'Raw JSON' },
];

interface Props {
  summary: ReactNode;
  full: ReactNode;
  raw: ReactNode;
}

export function ManifestTabs({ summary, full, raw }: Props) {
  const [active, setActive] = useState<Tab['id']>('summary');

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Manifest view"
        className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-subtle)] p-1 text-sm"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={
              'rounded px-3 py-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
              (active === t.id
                ? 'bg-[var(--color-card)] font-medium text-[var(--color-foreground)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {active === 'summary' ? summary : null}
        {active === 'full' ? full : null}
        {active === 'raw' ? raw : null}
      </div>
    </div>
  );
}

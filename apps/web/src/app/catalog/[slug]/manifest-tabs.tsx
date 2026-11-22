'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Three-tab switcher for the manifest section (PR L.2). Inline state,
 * no URL routing — the tab choice is ephemeral; users pick the view
 * they need for the current scroll session, no value to share.
 *
 * Server-component children are passed through verbatim; the client
 * boundary is just the tab list + visibility toggle.
 */

type TabId = 'summary' | 'full' | 'raw';

/** Labels come from `Dataset.manifest.tabs.<id>`. */
const TABS: ReadonlyArray<TabId> = ['summary', 'full', 'raw'];

interface Props {
  summary: ReactNode;
  full: ReactNode;
  raw: ReactNode;
}

export function ManifestTabs({ summary, full, raw }: Props) {
  const t = useTranslations('Dataset');
  const [active, setActive] = useState<TabId>('summary');

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={t('manifest.tabsLabel')}
        className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-subtle)] p-1 text-sm"
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active === id}
            onClick={() => setActive(id)}
            className={
              'rounded px-3 py-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
              (active === id
                ? 'bg-[var(--color-card)] font-medium text-[var(--color-foreground)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]')
            }
          >
            {t(`manifest.tabs.${id}`)}
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

'use client';

import { useState } from 'react';
import { ManifestWizard } from './manifest-wizard';
import { PublishVersionForm } from './publish-version-form';

/**
 * Tab switcher between the wizard (PR K, #90 — default for new
 * versions) and the paste-form escape hatch. The mode is component
 * state, not a URL param — refreshing keeps the host on the wizard
 * unless they've explicitly clicked the escape hatch.
 */
interface Props {
  slug: string;
  suggestedVersion: string;
  visibility: 'PUBLIC' | 'RESTRICTED' | 'PRIVATE';
}

type Mode = 'wizard' | 'paste';

export function PublishMode({ slug, suggestedVersion, visibility }: Props) {
  const [mode, setMode] = useState<Mode>('wizard');

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="Manifest entry mode"
        className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-subtle)] p-1 text-sm"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'wizard'}
          onClick={() => setMode('wizard')}
          className={
            'rounded px-3 py-1.5 transition-colors ' +
            (mode === 'wizard'
              ? 'bg-[var(--color-card)] font-medium text-[var(--color-foreground)] shadow-[var(--shadow-sm)]'
              : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]')
          }
        >
          Wizard
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'paste'}
          onClick={() => setMode('paste')}
          className={
            'rounded px-3 py-1.5 transition-colors ' +
            (mode === 'paste'
              ? 'bg-[var(--color-card)] font-medium text-[var(--color-foreground)] shadow-[var(--shadow-sm)]'
              : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]')
          }
        >
          I already have a manifest
        </button>
      </div>

      {mode === 'wizard' ? (
        <ManifestWizard slug={slug} suggestedVersion={suggestedVersion} visibility={visibility} />
      ) : (
        <PublishVersionForm slug={slug} suggestedVersion={suggestedVersion} />
      )}
    </div>
  );
}

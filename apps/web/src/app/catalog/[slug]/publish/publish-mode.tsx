'use client';

import { useState, type KeyboardEvent } from 'react';
import type { AccessTier } from '@oci/shared-types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@oci/ui';
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
  accessTier: AccessTier;
}

type Mode = 'wizard' | 'paste';

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'wizard', label: 'Wizard' },
  { id: 'paste', label: 'I already have a manifest' },
];

export function PublishMode({ slug, suggestedVersion, visibility, accessTier }: Props) {
  const [mode, setMode] = useState<Mode>('wizard');

  // Real tabs: arrow keys move between them, Home/End jump, and each tab
  // names the panel it controls. Without this contract the role would be
  // a lie to assistive technology.
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = MODES.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    const target = MODES.at(next);
    if (!target) return;
    setMode(target.id);
    document.getElementById(`publish-mode-tab-${target.id}`)?.focus();
  }

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Manifest entry mode"
        className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-subtle)] p-1 text-sm"
      >
        {MODES.map((m, i) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            id={`publish-mode-tab-${m.id}`}
            aria-selected={mode === m.id}
            aria-controls={`publish-mode-panel-${m.id}`}
            tabIndex={mode === m.id ? 0 : -1}
            onClick={() => setMode(m.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={
              'rounded px-3 py-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
              (mode === m.id
                ? 'bg-[var(--color-card)] font-medium text-[var(--color-foreground)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]')
            }
          >
            {m.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`publish-mode-panel-${mode}`}
        aria-labelledby={`publish-mode-tab-${mode}`}
      >
        {mode === 'wizard' ? (
          <ManifestWizard
            slug={slug}
            suggestedVersion={suggestedVersion}
            visibility={visibility}
            accessTier={accessTier}
          />
        ) : (
          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle>Paste a manifest</CardTitle>
              <CardDescription>
                The same validation runs as in the wizard; the paste form is for hosts who already
                hold a Croissant manifest.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PublishVersionForm slug={slug} suggestedVersion={suggestedVersion} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

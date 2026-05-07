'use client';

import { useActionState, useEffect, useRef, type ChangeEvent } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input, Textarea } from '@oci/ui';
import { publishVersionAction, type PublishVersionState } from './actions';

const initial: PublishVersionState = { status: 'idle' };

interface Props {
  slug: string;
  suggestedVersion: string;
}

export function PublishVersionForm({ slug, suggestedVersion }: Props) {
  const [state, action, pending] = useActionState(publishVersionAction, initial);
  const manifestRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const echoed =
    state.status === 'error' || state.status === 'invalid-manifest' ? state.values : undefined;

  function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !manifestRef.current) return;
    file.text().then((text) => {
      if (manifestRef.current) manifestRef.current.value = text;
    });
  }

  // After a failed server round-trip, scroll the error panel into
  // view. Without this the user has to scroll back up to read what
  // went wrong, then back down to the textarea (#79). `block: 'start'`
  // matches the reading order; `behavior: 'smooth'` keeps the jump
  // unobtrusive.
  useEffect(() => {
    if (state.status === 'error' || state.status === 'invalid-manifest') {
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Pull focus into the panel so screen-readers announce it. The
      // panel is `role=alert`; some readers handle that automatically,
      // but explicit focus is more reliable across browsers.
      errorRef.current?.focus();
    }
  }, [state.status]);

  // Re-mount the form after a server round-trip so `defaultValue`
  // settings on the manifest textarea are honoured (React only reads
  // defaultValue on mount).
  const formKey = `${state.status}-${'values' in state && state.values ? state.values.version : ''}`;

  const versionError = fieldError(state, 'version');
  const notesError = fieldError(state, 'notes');
  const manifestError = fieldError(state, 'manifest');

  return (
    <form action={action} className="space-y-5" aria-busy={pending || undefined} key={formKey}>
      <input type="hidden" name="slug" value={slug} />

      {state.status === 'invalid-manifest' ? (
        <div ref={errorRef} tabIndex={-1}>
          <ValidationPanel state={state} />
        </div>
      ) : state.status === 'error' ? (
        <div ref={errorRef} tabIndex={-1}>
          <Alert tone="danger">
            <AlertTitle as="h2">Could not publish</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <Field
        label="Version"
        htmlFor="field-version"
        required
        hint="Semver MAJOR.MINOR.PATCH (e.g. 1.0.0). Pre-release suffixes allowed."
        error={versionError}
      >
        <Input
          id="field-version"
          name="version"
          required
          defaultValue={echoed?.version ?? suggestedVersion}
          invalid={!!versionError}
          aria-describedby={versionError ? 'field-version-err' : undefined}
          pattern="^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$"
          maxLength={40}
        />
      </Field>

      <Field
        label="Notes"
        htmlFor="field-notes"
        hint="Optional. What changed since the previous version?"
        error={notesError}
      >
        <Textarea
          id="field-notes"
          name="notes"
          rows={3}
          maxLength={4000}
          defaultValue={echoed?.notes}
          invalid={!!notesError}
          aria-describedby={notesError ? 'field-notes-err' : undefined}
        />
      </Field>

      <div className="space-y-1.5">
        <label htmlFor="manifest" className="block text-sm font-medium">
          Croissant manifest
          <span aria-hidden="true" className="ms-0.5 text-[var(--color-danger)]">
            *
          </span>
          <span className="sr-only"> required</span>
        </label>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Paste the JSON-LD here, or upload a <code>.json</code> file to populate the field.
        </p>
        <input
          type="file"
          aria-label="Upload manifest from .json file"
          accept="application/json,application/ld+json,.json"
          onChange={onPickFile}
          className="block text-xs file:me-3 file:rounded-md file:border-0 file:bg-[var(--color-subtle)] file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-[var(--color-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        />
        <Textarea
          id="manifest"
          name="manifest"
          ref={manifestRef}
          required
          rows={14}
          mono
          defaultValue={echoed?.manifest}
          invalid={!!manifestError}
          aria-describedby={manifestError ? 'manifest-err' : undefined}
          placeholder='{"@context":"https://schema.org/","@type":"sc:Dataset","conformsTo":"http://mlcommons.org/croissant/1.1",...}'
        />
        {manifestError ? (
          <p id="manifest-err" className="text-xs text-[var(--color-danger)]">
            {manifestError}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Validating…' : 'Validate & publish'}
        </Button>
      </div>
    </form>
  );
}

function ValidationPanel({
  state,
}: {
  state: Extract<PublishVersionState, { status: 'invalid-manifest' }>;
}) {
  return (
    <Alert tone="danger">
      <AlertTitle as="h2">Manifest validation failed ({state.conformance})</AlertTitle>
      <AlertDescription>
        <p className="mb-2">{state.message}</p>
        <ul className="space-y-1.5 text-xs">
          {state.issues.map((issue, i) => (
            <li key={i} className="border-s-2 border-[var(--color-danger)]/40 ps-2">
              {issue.path ? <span className="font-mono">{issue.path}: </span> : null}
              <span>{issue.message}</span>
              {issue.severity ? (
                <span className="ms-1 uppercase opacity-70">[{issue.severity}]</span>
              ) : null}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function fieldError(state: PublishVersionState, name: string): string | undefined {
  if (state.status !== 'error') return undefined;
  return state.fieldErrors?.get(name);
}

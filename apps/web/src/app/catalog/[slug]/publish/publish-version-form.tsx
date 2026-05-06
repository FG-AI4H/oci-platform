'use client';

import { useActionState, useRef, type ChangeEvent } from 'react';
import { Alert, AlertDescription, AlertTitle, Button } from '@oci/ui';
import { publishVersionAction, type PublishVersionState } from './actions';

const initial: PublishVersionState = { status: 'idle' };

interface Props {
  slug: string;
  suggestedVersion: string;
}

export function PublishVersionForm({ slug, suggestedVersion }: Props) {
  const [state, action, pending] = useActionState(publishVersionAction, initial);
  const manifestRef = useRef<HTMLTextAreaElement>(null);

  function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !manifestRef.current) return;
    file.text().then((text) => {
      if (manifestRef.current) manifestRef.current.value = text;
    });
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />

      {state.status === 'invalid-manifest' ? (
        <ValidationPanel state={state} />
      ) : state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>Could not publish</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        label="Version"
        name="version"
        defaultValue={suggestedVersion}
        hint="Semver MAJOR.MINOR.PATCH (e.g. 1.0.0). Pre-release suffixes allowed."
        required
        pattern="^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$"
        maxLength={40}
        error={fieldError(state, 'version')}
      />

      <Field
        label="Notes"
        name="notes"
        as="textarea"
        rows={3}
        hint="Optional. What changed since the previous version?"
        maxLength={4000}
        error={fieldError(state, 'notes')}
      />

      <div className="space-y-1.5">
        <label htmlFor="manifest" className="text-sm font-medium">
          Croissant manifest <span className="text-[var(--color-danger)]">*</span>
        </label>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Paste the JSON-LD here, or upload a <code>.json</code> file to populate the field.
        </p>
        <input
          type="file"
          accept="application/json,application/ld+json,.json"
          onChange={onPickFile}
          className="block text-xs file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-subtle)] file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-[var(--color-muted)]"
        />
        <textarea
          id="manifest"
          name="manifest"
          ref={manifestRef}
          required
          rows={14}
          className={
            'w-full rounded-md border bg-[var(--color-card)] px-3 py-2 text-xs font-mono focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
            (fieldError(state, 'manifest')
              ? 'border-[var(--color-danger)]'
              : 'border-[var(--color-border)]')
          }
          placeholder='{"@context":"https://schema.org/","@type":"sc:Dataset","conformsTo":"http://mlcommons.org/croissant/1.1",...}'
        />
        {fieldError(state, 'manifest') ? (
          <p className="text-xs text-[var(--color-danger)]">{fieldError(state, 'manifest')}</p>
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
      <AlertTitle>Manifest validation failed ({state.conformance})</AlertTitle>
      <AlertDescription>
        <p className="mb-2">{state.message}</p>
        <ul className="space-y-1.5 text-xs">
          {state.issues.map((issue, i) => (
            <li key={i} className="border-l-2 border-[var(--color-danger)]/40 pl-2">
              {issue.path ? <span className="font-mono">{issue.path}: </span> : null}
              <span>{issue.message}</span>
              {issue.severity ? (
                <span className="ml-1 uppercase opacity-70">[{issue.severity}]</span>
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

interface FieldProps {
  label: string;
  name: string;
  hint?: string;
  required?: boolean;
  error?: string;
  defaultValue?: string;
  as?: 'input' | 'textarea';
  rows?: number;
  maxLength?: number;
  pattern?: string;
}

function Field({ label, name, hint, required, error, as = 'input', ...rest }: FieldProps) {
  const id = `field-${name}`;
  const errId = error ? `${id}-err` : undefined;
  const inputClass =
    'w-full h-10 rounded-md border bg-[var(--color-card)] px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] ' +
    (error ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]');
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required ? <span className="text-[var(--color-danger)]"> *</span> : null}
      </label>
      {as === 'textarea' ? (
        <textarea
          id={id}
          name={name}
          required={required}
          aria-describedby={errId}
          className={inputClass + ' h-auto py-2'}
          {...rest}
        />
      ) : (
        <input
          id={id}
          name={name}
          required={required}
          aria-describedby={errId}
          className={inputClass}
          {...rest}
        />
      )}
      {hint && !error ? (
        <p className="text-xs text-[var(--color-muted-foreground)]">{hint}</p>
      ) : null}
      {error ? (
        <p id={errId} className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

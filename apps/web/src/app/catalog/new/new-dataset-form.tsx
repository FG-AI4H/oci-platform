'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button } from '@oci/ui';
import { createDatasetAction, type CreateDatasetState } from './actions';

const initial: CreateDatasetState = { status: 'idle' };

export function NewDatasetForm() {
  const [state, action, pending] = useActionState(createDatasetAction, initial);

  return (
    <form action={action} className="space-y-4">
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>Could not create dataset</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        label="Slug"
        name="slug"
        hint="lower-case, hyphenated, 3–80 chars (e.g. rsna-pneumonia-2018)"
        required
        error={fieldError(state, 'slug')}
        autoComplete="off"
        spellCheck={false}
        pattern="^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9]))*$"
        minLength={3}
        maxLength={80}
      />

      <Field
        label="Name"
        name="name"
        hint="Human-readable title shown in catalog cards and Schema.org Dataset.name."
        required
        error={fieldError(state, 'name')}
        maxLength={200}
      />

      <Field
        label="Description"
        name="description"
        as="textarea"
        hint="Optional. Markdown isn't parsed yet — plain text only."
        rows={4}
        maxLength={2000}
        error={fieldError(state, 'description')}
      />

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Initial visibility</legend>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Drafts are PRIVATE by default. Change later from the dataset page.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {(['PRIVATE', 'RESTRICTED', 'PUBLIC'] as const).map((v) => (
            <label
              key={v}
              className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm cursor-pointer has-[:checked]:border-[var(--color-primary)] has-[:checked]:bg-[var(--color-subtle)]"
            >
              <input type="radio" name="visibility" value={v} defaultChecked={v === 'PRIVATE'} />
              <span>{v}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create draft'}
        </Button>
      </div>
    </form>
  );
}

function fieldError(state: CreateDatasetState, name: string): string | undefined {
  return state.status === 'error' ? state.fieldErrors?.get(name) : undefined;
}

interface FieldProps {
  label: string;
  name: string;
  hint?: string;
  required?: boolean;
  error?: string;
  as?: 'input' | 'textarea';
  rows?: number;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  autoComplete?: string;
  spellCheck?: boolean;
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
          className={inputClass + ' h-auto py-2 font-mono'}
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

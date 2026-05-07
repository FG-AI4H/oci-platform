'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input, Textarea } from '@oci/ui';
import { createDatasetAction, type CreateDatasetState } from './actions';

const initial: CreateDatasetState = { status: 'idle' };

type Visibility = 'PRIVATE' | 'RESTRICTED' | 'PUBLIC';

const VISIBILITY_OPTIONS: ReadonlyArray<{ value: Visibility; title: string; hint: string }> = [
  { value: 'PRIVATE', title: 'Private', hint: 'Only you and admins can see this draft.' },
  {
    value: 'RESTRICTED',
    title: 'Restricted',
    hint: 'Visible after an access request is approved.',
  },
  { value: 'PUBLIC', title: 'Public', hint: 'Listed in the catalog and crawlable.' },
];

export function NewDatasetForm() {
  const [state, action, pending] = useActionState(createDatasetAction, initial);
  const echoed = state.status === 'error' ? state.values : undefined;
  const visibilityDefault: Visibility =
    echoed?.visibility === 'RESTRICTED' || echoed?.visibility === 'PUBLIC'
      ? echoed.visibility
      : 'PRIVATE';

  const slugError = fieldError(state, 'slug');
  const nameError = fieldError(state, 'name');
  const descError = fieldError(state, 'description');

  return (
    <form action={action} className="space-y-5" aria-busy={pending || undefined}>
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>Could not create dataset</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        label="Slug"
        htmlFor="field-slug"
        required
        hint="lower-case, hyphenated, 3–80 chars (e.g. rsna-pneumonia-2018)"
        error={slugError}
      >
        <Input
          id="field-slug"
          name="slug"
          required
          defaultValue={echoed?.slug}
          invalid={!!slugError}
          aria-describedby={slugError ? 'field-slug-err' : undefined}
          autoComplete="off"
          spellCheck={false}
          pattern="^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9]))*$"
          minLength={3}
          maxLength={80}
        />
      </Field>

      <Field
        label="Name"
        htmlFor="field-name"
        required
        hint="Human-readable title shown in catalog cards and Schema.org Dataset.name."
        error={nameError}
      >
        <Input
          id="field-name"
          name="name"
          required
          defaultValue={echoed?.name}
          invalid={!!nameError}
          aria-describedby={nameError ? 'field-name-err' : undefined}
          maxLength={200}
        />
      </Field>

      <Field
        label="Description"
        htmlFor="field-description"
        hint="Optional. Markdown isn't parsed yet — plain text only."
        error={descError}
      >
        <Textarea
          id="field-description"
          name="description"
          rows={4}
          maxLength={2000}
          defaultValue={echoed?.description}
          invalid={!!descError}
          aria-describedby={descError ? 'field-description-err' : undefined}
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Initial visibility</legend>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Drafts default to private. Change later from the dataset page.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {VISIBILITY_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex flex-col gap-0.5 rounded-md border border-[var(--color-border)] p-3 text-sm cursor-pointer transition-colors has-[:checked]:border-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary-soft)]/40 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-ring)]"
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="visibility"
                  value={opt.value}
                  defaultChecked={opt.value === visibilityDefault}
                  className="accent-[var(--color-primary)]"
                />
                <span className="font-medium">{opt.title}</span>
              </span>
              <span className="text-xs text-[var(--color-muted-foreground)] ps-6">{opt.hint}</span>
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

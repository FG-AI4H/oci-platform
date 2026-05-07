'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input, Textarea } from '@oci/ui';
import { createRemoteAction, type CreateRemoteState } from './actions';

const initial: CreateRemoteState = { status: 'idle' };

export function NewRemoteForm() {
  const [state, action, pending] = useActionState(createRemoteAction, initial);
  const echoed = state.status === 'error' ? state.values : undefined;

  const slugError = fieldError(state, 'slug');
  const nameError = fieldError(state, 'name');
  const urlError = fieldError(state, 'endpointUrl');
  const descError = fieldError(state, 'description');

  return (
    <form action={action} className="space-y-5" aria-busy={pending || undefined}>
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>Could not register peer</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        label="Slug"
        htmlFor="field-slug"
        required
        hint="URL-safe identifier for the peer (e.g. huggingface, gi-ai4h-thailand)."
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
          minLength={2}
          maxLength={64}
        />
      </Field>

      <Field
        label="Name"
        htmlFor="field-name"
        required
        hint="Human-readable label shown in lists."
        error={nameError}
      >
        <Input
          id="field-name"
          name="name"
          required
          defaultValue={echoed?.name}
          invalid={!!nameError}
          aria-describedby={nameError ? 'field-name-err' : undefined}
          maxLength={120}
        />
      </Field>

      <Field
        label="Endpoint URL"
        htmlFor="field-endpoint-url"
        required
        hint="Base URL of the peer. The harvester appends /.well-known/croissant-catalog.json."
        error={urlError}
      >
        <Input
          id="field-endpoint-url"
          name="endpointUrl"
          type="url"
          required
          defaultValue={echoed?.endpointUrl}
          invalid={!!urlError}
          aria-describedby={urlError ? 'field-endpoint-url-err' : undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={500}
          placeholder="https://example.org/v2/catalog"
        />
      </Field>

      <Field
        label="Description"
        htmlFor="field-description"
        hint="Optional. Free-text note about who runs this peer or what they publish."
        error={descError}
      >
        <Textarea
          id="field-description"
          name="description"
          rows={3}
          maxLength={2000}
          defaultValue={echoed?.description}
          invalid={!!descError}
          aria-describedby={descError ? 'field-description-err' : undefined}
        />
      </Field>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Registering…' : 'Register peer'}
        </Button>
      </div>
    </form>
  );
}

function fieldError(state: CreateRemoteState, name: string): string | undefined {
  return state.status === 'error' ? state.fieldErrors?.get(name) : undefined;
}

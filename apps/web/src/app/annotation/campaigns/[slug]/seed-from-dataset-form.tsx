'use client';

import { useActionState, useId } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input } from '@oci/ui';
import { seedFromDatasetAction, type SeedFromDatasetState } from './tasks-actions';

const initial: SeedFromDatasetState = { status: 'idle' };

/**
 * "Create tasks from the dataset's files" (#646): one task per hosted
 * PNG / JPEG file of the campaign's pinned dataset version, without
 * typing a file name. Counts first, then asks the manager to confirm.
 */
export function SeedFromDatasetForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(seedFromDatasetAction, initial);
  const prefixId = useId();
  const limitId = useId();
  const echoed = state.status === 'idle' ? null : state;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <h3 className="text-sm font-semibold">Create tasks from the dataset&apos;s files</h3>
      <p className="text-sm text-[var(--color-muted-foreground)]">
        One task per PNG or JPEG file hosted on the platform for the campaign&apos;s dataset
        version. Files that already have a task are left alone, so this is safe to run again.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="File names starting with"
          htmlFor={prefixId}
          hint="Optional. Leave empty for every image file."
        >
          <Input id={prefixId} name="prefix" maxLength={200} defaultValue={echoed?.prefix ?? ''} />
        </Field>
        <Field label="At most" htmlFor={limitId} hint="Optional. Files are taken in name order.">
          <Input
            id={limitId}
            name="limit"
            type="number"
            inputMode="numeric"
            min={1}
            max={10_000}
            step={1}
            defaultValue={echoed?.limit ?? ''}
          />
        </Field>
      </div>

      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>Nothing was created</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === 'success' ? (
        <Alert tone="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {state.status === 'preview' ? (
        <div className="space-y-3 rounded-md border border-[var(--color-border)] p-3">
          <p role="status" className="text-sm">
            {state.matched === 0
              ? 'No hosted PNG or JPEG files match.'
              : `${state.matched} image ${state.matched === 1 ? 'file matches' : 'files match'}: ${state.toCreate} new ${state.toCreate === 1 ? 'task' : 'tasks'}${state.alreadyThere > 0 ? `, ${state.alreadyThere} already ${state.alreadyThere === 1 ? 'has' : 'have'} one` : ''}.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {state.toCreate > 0 ? (
              <Button type="submit" name="intent" value="create" disabled={pending}>
                {pending
                  ? 'Creating…'
                  : `Create ${state.toCreate} ${state.toCreate === 1 ? 'task' : 'tasks'}`}
              </Button>
            ) : null}
            <Button
              type="submit"
              name="intent"
              value="preview"
              variant="outline"
              disabled={pending}
            >
              Count again
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit" name="intent" value="preview" variant="primary" disabled={pending}>
          {pending ? 'Counting…' : 'Count image files'}
        </Button>
      )}
    </form>
  );
}

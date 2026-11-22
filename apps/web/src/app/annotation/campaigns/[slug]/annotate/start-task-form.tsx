'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, Button } from '@oci/ui';
import { startTaskAction, type PullState } from './actions';

const initialStart: PullState = { status: 'idle' };

interface StartTaskFormProps {
  slug: string;
  /** Label of the button, e.g. "Start" or "Start the next task". */
  label: string;
  /** Focus the button, so Enter goes straight on after a submit or skip. */
  autoFocus?: boolean;
}

/**
 * "Start" on the annotator queue (#646). Opening the page reserves
 * nothing; this button takes the next task. On success the action
 * revalidates the page, which then renders the task.
 */
export function StartTaskForm({ slug, label, autoFocus = false }: StartTaskFormProps) {
  const [state, action, pending] = useActionState(startTaskAction, initialStart);
  return (
    <div className="space-y-3">
      {state.status === 'success' && state.assignmentId === null ? (
        <Alert tone="info">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <form action={action}>
        <input type="hidden" name="slug" value={slug} />
        {/* Focused only right after the annotator's own submit or skip, so Enter carries on. */}
        <Button type="submit" variant="primary" disabled={pending} autoFocus={autoFocus}>
          {pending ? 'Starting…' : label}
        </Button>
      </form>
    </div>
  );
}

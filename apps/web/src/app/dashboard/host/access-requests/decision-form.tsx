'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Textarea } from '@oci/ui';
import { decideAction, type DecisionState } from './actions';

const initial: DecisionState = { status: 'idle' };

interface Props {
  id: string;
  /** PENDING shows Approve+Deny; APPROVED shows Revoke; others hide the form. */
  currentStatus: 'PENDING' | 'APPROVED' | 'DENIED' | 'REVOKED';
}

/**
 * Inline decision form per request row in the host inbox. PENDING
 * rows render Approve / Deny pair; APPROVED rows render Revoke; rows
 * already in a terminal non-revocable state render nothing.
 */
export function DecisionForm({ id, currentStatus }: Props) {
  const [state, action, pending] = useActionState(decideAction, initial);

  if (currentStatus === 'DENIED' || currentStatus === 'REVOKED') return null;

  return (
    <form action={action} className="space-y-3 border-t border-[var(--color-border)] pt-4">
      <input type="hidden" name="id" value={id} />

      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle as="h3">Could not record decision</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        label="Decision note"
        htmlFor={`note-${id}`}
        hint="Optional. Visible to the requester. Useful for explaining a denial or attaching MOU references."
      >
        <Textarea id={`note-${id}`} name="decisionNote" rows={2} maxLength={4000} />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        {currentStatus === 'PENDING' ? (
          <>
            <Button type="submit" name="status" value="APPROVED" disabled={pending} size="sm">
              {pending ? 'Saving…' : 'Approve'}
            </Button>
            <Button
              type="submit"
              name="status"
              value="DENIED"
              variant="outline"
              disabled={pending}
              size="sm"
            >
              Deny
            </Button>
          </>
        ) : (
          <Button
            type="submit"
            name="status"
            value="REVOKED"
            variant="danger"
            disabled={pending}
            size="sm"
          >
            {pending ? 'Saving…' : 'Revoke access'}
          </Button>
        )}
      </div>
    </form>
  );
}

'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button } from '@oci/ui';
import { deleteRemoteAction, type DeleteRemoteState } from './actions';

const initial: DeleteRemoteState = { status: 'idle' };

export function DeleteRemoteButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteRemoteAction, initial);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle>Could not deregister</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? 'Deregistering…' : 'Deregister peer'}
      </Button>
    </form>
  );
}

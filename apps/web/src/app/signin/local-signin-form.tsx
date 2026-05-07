'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input } from '@oci/ui';
import { localSignInAction, type SignInState } from './actions';

const initial: SignInState = { status: 'idle' };

interface Props {
  callbackUrl: string;
}

/**
 * Local-dev credentials form. Mirrors the field set the Credentials
 * provider in `apps/web/src/auth.ts` declares: `user` + `roles` (the
 * authorize callback reads these from FormData and stamps a session
 * with the dev-sentinel access token).
 */
export function LocalSignInForm({ callbackUrl }: Props) {
  const [state, action, pending] = useActionState(localSignInAction, initial);
  return (
    <form action={action} className="space-y-4" aria-busy={pending || undefined}>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle as="h2">Sign-in failed</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        label="User"
        htmlFor="signin-user"
        hint="Any string. The UUID-shaped user maps cleanly to identity.users.id; non-UUIDs are derived deterministically (PR D)."
      >
        <Input
          id="signin-user"
          name="user"
          required
          autoComplete="off"
          spellCheck={false}
          defaultValue="local-dev@oci.ai4h.net"
        />
      </Field>

      <Field
        label="Roles"
        htmlFor="signin-roles"
        hint="Comma-separated. Try host, admin, participant, regulator, supervisor."
      >
        <Input
          id="signin-roles"
          name="roles"
          required
          autoComplete="off"
          spellCheck={false}
          defaultValue="host,admin"
        />
      </Field>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in (local dev)'}
      </Button>
    </form>
  );
}

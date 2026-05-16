'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button } from '@oci/ui';
import type { PlatformGroup } from '@oci/shared-types';
import { toggleGroupAction, type GroupActionResult } from './actions';

const initial: GroupActionResult = { status: 'idle' };

export interface GroupToggleFormProps {
  username: string;
  group: PlatformGroup;
  initiallyChecked: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Single-row form: toggles one group for one user. The detail page
 * renders one of these per known group. The form posts the desired
 * end state (`desired=on|off`) so the server action calls the right
 * verb without trusting the client about prior state.
 */
export function GroupToggleForm({
  username,
  group,
  initiallyChecked,
  disabled,
  disabledReason,
}: GroupToggleFormProps) {
  const [state, action, pending] = useActionState(toggleGroupAction, initial);

  return (
    <form action={action} className="flex items-center justify-between gap-3 py-2">
      <input type="hidden" name="username" value={username} />
      <input type="hidden" name="group" value={group} />
      {/*
        The checkbox name is `desired`. When checked, the form data
        includes `desired=on`; when unchecked, the field is omitted so
        the action sees `null` and defaults to revoke.
      */}
      <label className="flex flex-1 items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          name="desired"
          defaultChecked={initiallyChecked}
          disabled={disabled || pending}
          className="h-4 w-4 accent-[var(--color-primary)] cursor-pointer"
          aria-label={`Toggle ${group}`}
        />
        <span className="flex flex-col">
          <span className="font-mono text-sm">{group}</span>
          {disabled && disabledReason ? (
            <span className="text-xs text-[var(--color-muted-foreground)]">{disabledReason}</span>
          ) : null}
        </span>
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={disabled || pending}>
        {pending ? 'Saving…' : 'Apply'}
      </Button>

      {state.status === 'error' ? (
        <Alert tone="danger" className="basis-full">
          <AlertTitle>Could not update {group}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === 'success' ? (
        <Alert tone="success" className="basis-full">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}

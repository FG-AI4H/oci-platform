'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('SignIn.local');
  return (
    <form action={action} className="space-y-4" aria-busy={pending || undefined}>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      {/* NextAuth's signIn(provider, formData) redirects to `redirectTo`,
          else the Referer (this page). Going back to /signin only worked
          because it bounces a signed-in caller on, which it doesn't for
          `reason=expired`. */}
      <input type="hidden" name="redirectTo" value={callbackUrl} />

      {state.status === 'error' ? (
        <Alert tone="danger">
          <AlertTitle as="h2">{t('failedTitle')}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field label={t('user')} htmlFor="signin-user" hint={t('userHint')}>
        <Input
          id="signin-user"
          name="user"
          required
          autoComplete="off"
          spellCheck={false}
          defaultValue="local-dev@oci.ai4h.net"
        />
      </Field>

      <Field label={t('roles')} htmlFor="signin-roles" hint={t('rolesHint')}>
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
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}

'use server';

import { AuthError } from 'next-auth';
import { getLocale, getTranslations } from 'next-intl/server';
import { signIn } from '../../auth';

/**
 * Server action backing the local-dev credentials form on `/signin`.
 *
 * NextAuth's `signIn(providerId, formData)` reads `user` + `roles`
 * from the FormData, runs them through the Credentials provider's
 * `authorize` callback in `apps/web/src/auth.ts`, sets the session
 * cookie, and redirects to `callbackUrl`.
 *
 * Errors from `signIn` propagate as `AuthError`. We catch them and
 * return a small error state so the form can render an inline alert
 * instead of bubbling a 500.
 */
export type SignInState = { status: 'idle' } | { status: 'error'; message: string };

export async function localSignInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  try {
    await signIn('cognito', formData);
    // signIn() throws a NEXT_REDIRECT internally on success; if we
    // somehow reach here without throwing, treat it as a no-op.
    return { status: 'idle' };
  } catch (err) {
    // next/navigation's `redirect()` throws a special error that
    // Next.js handles upstream. We MUST re-throw it so the redirect
    // actually happens — only "real" auth errors stay caught here.
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
    if (err instanceof AuthError) {
      const t = await getTranslations('SignIn.local');
      return { status: 'error', message: t('failedMessage', { type: err.type }) };
    }
    throw err;
  }
}

/**
 * Server action backing the "Continue with Cognito" button in
 * deployed envs. NextAuth handles the OAuth redirect to Cognito's
 * hosted UI; the user comes back to `/api/auth/callback/cognito`
 * which then 302s to `callbackUrl`.
 *
 * The managed login pages open in the interface language (#654): the
 * third argument becomes query parameters on `/oauth2/authorize`, and
 * Cognito reads `lang` there ("The language that you want to display
 * user-interactive pages in. Managed login pages can be localized, but
 * hosted UI (classic) pages can't." — Cognito developer guide,
 * authorization endpoint). `en` and `fr` are both on its list. The pool
 * domains use managed login (identity stack); a classic hosted UI would
 * ignore the parameter and stay in English.
 */
export async function cognitoSignInAction(formData: FormData): Promise<void> {
  const callbackUrl = String(formData.get('callbackUrl') ?? '/dashboard');
  const lang = await getLocale();
  await signIn('cognito', { redirectTo: callbackUrl }, { lang });
}

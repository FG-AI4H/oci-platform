import { Button } from '@oci/ui';
import { getTranslations } from 'next-intl/server';
import { cognitoSignInAction } from './actions';

interface Props {
  callbackUrl: string;
}

/**
 * "Continue with Cognito" button for deployed envs. The button posts
 * to a server action that hands off to NextAuth's OAuth code flow;
 * the user is bounced to Cognito's hosted UI and back via
 * `/api/auth/callback/cognito`.
 */
export async function CognitoSignInButton({ callbackUrl }: Props) {
  const t = await getTranslations('SignIn');
  return (
    <form action={cognitoSignInAction} className="space-y-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <Button type="submit" className="w-full">
        {t('cognitoButton')}
      </Button>
      <p className="text-center text-xs text-[var(--color-muted-foreground)]">{t('cognitoHint')}</p>
    </form>
  );
}

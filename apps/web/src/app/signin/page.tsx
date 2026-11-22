import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Container } from '@oci/ui';
import { auth } from '../../auth';
import { BrandLockup } from '../../components/brand-mark';
import { safeCallbackUrl } from '../../lib/safe-callback-url';
import { CognitoSignInButton } from './cognito-signin-button';
import { LocalSignInForm } from './local-signin-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('SignIn');
  return {
    title: t('metaTitle'),
    // Auth flow lives behind a sign-in surface; not useful to crawl.
    robots: { index: false, follow: false },
  };
}

interface SearchParams {
  callbackUrl?: string;
  error?: string;
  /** `expired`: the API rejected the session's token; sign in again. */
  reason?: string;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [session, t] = await Promise.all([auth(), getTranslations('SignIn')]);
  const callbackUrl = safeCallbackUrl(params.callbackUrl);

  const expired = params.reason === 'expired';

  // Already signed in — bounce straight to the destination. Not when
  // the token expired: the session still exists, so bouncing would loop.
  if (session?.user && !expired) {
    redirect(callbackUrl);
  }

  const isLocal = process.env.OCI_ENV === 'local' || process.env.NEXT_PUBLIC_OCI_ENV === 'local';

  return (
    <Container size="sm">
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-md flex-col justify-center py-12">
        <div className="mb-8 flex justify-center">
          <BrandLockup />
        </div>

        <Card>
          <CardHeader>
            <CardTitle as="h1">{t('title')}</CardTitle>
            <CardDescription>
              {isLocal ? t('descriptionLocal') : t('descriptionCognito')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {expired && !params.error ? (
              <p
                role="status"
                className="mb-4 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-sm"
              >
                {t('expired')}
              </p>
            ) : null}
            {params.error ? (
              <p
                role="alert"
                className="mb-4 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)] px-3 py-2 text-sm"
              >
                {t('failed', { error: params.error })}
              </p>
            ) : null}
            {isLocal ? (
              <LocalSignInForm callbackUrl={callbackUrl} />
            ) : (
              <CognitoSignInButton callbackUrl={callbackUrl} />
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-[var(--color-muted-foreground)]">
          {t('policies')}
        </p>
      </div>
    </Container>
  );
}

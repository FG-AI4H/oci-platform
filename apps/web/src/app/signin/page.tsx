import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Container } from '@oci/ui';
import { auth } from '../../auth';
import { BrandLockup } from '../../components/brand-mark';
import { CognitoSignInButton } from './cognito-signin-button';
import { LocalSignInForm } from './local-signin-form';

export const metadata = {
  title: 'Sign in — OCI Platform',
  // Auth flow lives behind a sign-in surface; not useful to crawl.
  robots: { index: false, follow: false },
};

interface SearchParams {
  callbackUrl?: string;
  error?: string;
}

const ALLOWED_CALLBACK_PREFIX = '/';

function safeCallbackUrl(raw: string | undefined): string {
  // Only allow same-origin redirects; an open redirect here would let
  // an attacker funnel a user to an external site after sign-in.
  if (!raw || !raw.startsWith(ALLOWED_CALLBACK_PREFIX) || raw.startsWith('//')) {
    return '/dashboard';
  }
  return raw;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await auth();
  const callbackUrl = safeCallbackUrl(params.callbackUrl);

  // Already signed in — bounce straight to the destination.
  if (session?.user) {
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
            <CardTitle as="h1">Sign in</CardTitle>
            <CardDescription>
              {isLocal
                ? 'Local dev mode — pick any user and role set to mint a session against the running stack.'
                : 'Use your Cognito account to access the OCI Platform.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {params.error ? (
              <p
                role="alert"
                className="mb-4 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)] px-3 py-2 text-sm"
              >
                Sign-in failed ({params.error}). Try again.
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
          Signing in agrees to the GI-AI4H platform&apos;s data-handling policies.
        </p>
      </div>
    </Container>
  );
}

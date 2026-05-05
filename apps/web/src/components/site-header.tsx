import Link from 'next/link';
import { Badge } from '@oci/ui';
import { auth, signOut } from '../auth';
import { BrandLockup } from './brand-mark';

/**
 * Top navigation bar. Server component — reads the NextAuth session
 * to render either the sign-in CTA path (just the brand) or the
 * authenticated path (brand, dashboard link, sign-out form).
 *
 * The `dev` / `int` / `prod` env tag is rendered as a small badge so
 * operators can tell at a glance which environment they're looking at.
 */
export async function SiteHeader() {
  const session = await auth();
  const env = process.env.OCI_ENV ?? 'local';

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-background)]/85 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-background)]/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <BrandLockup />
          </Link>
          <nav className="hidden sm:flex items-center gap-4">
            <Link
              href="/catalog"
              className="text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
            >
              Catalog
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {env !== 'prod' && (
            <Badge tone={env === 'dev' ? 'info' : env === 'int' ? 'warning' : 'neutral'}>
              {env}
            </Badge>
          )}

          {session?.user ? (
            <>
              <Link
                href="/dashboard"
                className="text-sm font-medium text-[var(--color-foreground)] hover:text-[var(--color-primary)] transition-colors"
              >
                Dashboard
              </Link>
              <span className="hidden sm:inline text-sm text-[var(--color-muted-foreground)]">
                {session.user.email ?? session.user.name}
              </span>
              <form
                action={async () => {
                  'use server';
                  await signOut({ redirectTo: '/' });
                }}
              >
                <button
                  type="submit"
                  className="text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

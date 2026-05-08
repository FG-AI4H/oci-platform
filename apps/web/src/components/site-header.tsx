import Link from 'next/link';
import { Badge, Button } from '@oci/ui';
import { auth, signOut } from '../auth';
import { isAdmin, isHost } from '../lib/groups';
import { BrandLockup } from './brand-mark';

function envTone(env: string): 'info' | 'warning' | 'neutral' {
  if (env === 'dev') return 'info';
  if (env === 'int') return 'warning';
  return 'neutral';
}

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
  const showHostNav = isHost(session);
  const showAdminNav = isAdmin(session);
  const showEnvBadge = env !== 'prod';

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-background)]/85 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-background)]/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6 min-w-0">
          <Link
            href="/"
            className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <BrandLockup />
          </Link>
          <nav aria-label="Primary" className="hidden sm:flex items-center gap-5">
            <NavLink href="/catalog">Catalog</NavLink>
            {showHostNav ? <NavLink href="/catalog/new">New dataset</NavLink> : null}
            {showHostNav ? <NavLink href="/dashboard/host/access-requests">Inbox</NavLink> : null}
            {showAdminNav ? <NavLink href="/catalog/remotes">Remotes</NavLink> : null}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {showEnvBadge && (
            <Badge tone={envTone(env)} className="hidden sm:inline-flex">
              {env}
            </Badge>
          )}

          {session?.user ? (
            <>
              <NavLink href="/dashboard">Dashboard</NavLink>
              <NavLink href="/settings">Settings</NavLink>
              <span
                className="hidden md:inline text-sm text-[var(--color-muted-foreground)] truncate max-w-[14ch]"
                title={session.user.email ?? session.user.name ?? undefined}
              >
                {session.user.email ?? session.user.name}
              </span>
              <form
                action={async () => {
                  'use server';
                  await signOut({ redirectTo: '/' });
                }}
              >
                <Button type="submit" variant="ghost" size="sm">
                  Sign out
                </Button>
              </form>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
    >
      {children}
    </Link>
  );
}

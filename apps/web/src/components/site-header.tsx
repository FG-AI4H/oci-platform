import Link from 'next/link';
import { Badge, Button } from '@oci/ui';
import { redirect } from 'next/navigation';
import { auth, isLocal, signOut } from '../auth';
import { cognitoLogoutUrl } from '../lib/cognito-logout';
import { isAdmin, isHost } from '../lib/groups';
import { activityReportSeconds, sessionIdleSeconds } from '../lib/token-refresh';
import { BrandLockup } from './brand-mark';
import { SessionActivity } from './session-activity';

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
  const showAnnotationNav = session?.user != null;
  const showEnvBadge = env !== 'prod';
  const idleSeconds = sessionIdleSeconds();

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-background)]/85 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-background)]/70">
      <div className="mx-auto flex h-14 max-w-(--breakpoint-2xl) items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6 min-w-0">
          <Link
            href="/"
            className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <BrandLockup />
          </Link>
          <nav aria-label="Primary" className="hidden sm:flex items-center gap-5">
            <NavLink href="/catalog">Catalog</NavLink>
            {/* Public like /catalog: PUBLISHED model cards only (#591). */}
            <NavLink href="/models">Models</NavLink>
            {/* Public like /catalog: evaluation tasks and their scores are
                readable by anyone (ADR-0017); ground truth never is. */}
            <NavLink href="/evaluation">Evaluation</NavLink>
            {showAnnotationNav ? <NavLink href="/annotation/campaigns">Annotation</NavLink> : null}
            {showHostNav ? <NavLink href="/dashboard/host/access-requests">Inbox</NavLink> : null}
            {showAdminNav ? <NavLink href="/admin">Admin</NavLink> : null}
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
              {/* Renders nothing; reports use of the page so that reading
                  or typing does not look like an idle session (#643). */}
              {idleSeconds === null ? null : (
                <SessionActivity reportEverySeconds={activityReportSeconds(idleSeconds)} />
              )}
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
                  // End the Cognito hosted-UI session too, or the next
                  // "Sign in" silently returns the same user (#663).
                  const logoutUrl = isLocal
                    ? null
                    : await cognitoLogoutUrl({
                        issuer: process.env.AUTH_COGNITO_ISSUER,
                        clientId: process.env.AUTH_COGNITO_ID,
                        returnTo: `${(process.env.AUTH_URL ?? '').replace(/\/+$/, '')}/`,
                      });
                  if (logoutUrl === null) {
                    await signOut({ redirectTo: '/' });
                    return;
                  }
                  await signOut({ redirect: false });
                  redirect(logoutUrl);
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

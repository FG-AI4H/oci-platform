import type { Route } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Badge, Button } from '@oci/ui';
import { redirect } from 'next/navigation';
import { auth, isLocal, signOut } from '../auth';
import { cognitoLogoutUrl } from '../lib/cognito-logout';
import { activityReportSeconds, sessionIdleSeconds } from '../lib/token-refresh';
import { BrandLockup } from './brand-mark';
import { HeaderMenu } from './header-menu';
import { LanguageSwitch } from './language-switch';
import { SessionActivity } from './session-activity';
import {
  accountHeaderLinks,
  primaryHeaderLinks,
  rowBreakpoint,
  type HeaderLink,
  type RowBreakpoint,
} from './site-header-links';

// Whole class names, so Tailwind finds them in the source.
function navRowClass(breakpoint: RowBreakpoint): string {
  switch (breakpoint) {
    case 'xl':
      return 'hidden items-center gap-5 xl:flex';
    case '2xl':
      return 'hidden items-center gap-5 2xl:flex';
    case 'never':
      return 'hidden';
  }
}

function accountRowClass(breakpoint: RowBreakpoint): string {
  switch (breakpoint) {
    case 'xl':
      return 'hidden items-center gap-3 xl:flex';
    case '2xl':
      return 'hidden items-center gap-3 2xl:flex';
    case 'never':
      return 'hidden';
  }
}

function envTone(env: string): 'info' | 'warning' | 'neutral' {
  if (env === 'dev') return 'info';
  if (env === 'int') return 'warning';
  return 'neutral';
}

/**
 * Top navigation bar. Server component — reads the NextAuth session
 * to render either the signed-out path (brand, public links, language
 * switch) or the signed-in one (plus dashboard, settings, sign-out).
 *
 * From `xl` up the links sit in a row; below it they move into a menu
 * (#743), which keeps the account area clear at tablet width in both
 * languages. When a caller's roles add enough links that the row would
 * not fit at `xl`, the menu stays up to `2xl`, or at every width
 * (#776; see `rowBreakpoint`).
 *
 * The `dev` / `int` / `prod` env tag is rendered as a small badge so
 * operators can tell at a glance which environment they're looking at.
 */
export async function SiteHeader() {
  const [session, t] = await Promise.all([auth(), getTranslations('Header')]);
  const env = process.env.OCI_ENV ?? 'local';
  const signedIn = session?.user != null;
  const showEnvBadge = env !== 'prod';
  const idleSeconds = sessionIdleSeconds();

  // One list, rendered twice: as a row from the breakpoint where it
  // fits, and inside the menu below it (#743, #776).
  const labelled = ({ href, key }: HeaderLink): { href: Route; label: string } => ({
    href,
    label: t(key),
  });
  const primaryLinks = primaryHeaderLinks(session).map(labelled);
  const accountLinks = accountHeaderLinks(session).map(labelled);
  const accountName = session?.user?.email ?? session?.user?.name ?? null;
  const breakpoint = rowBreakpoint(primaryLinks.map((link) => link.label));

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-background)]/85 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-background)]/70">
      <div className="mx-auto flex h-14 max-w-(--breakpoint-2xl) items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            href="/"
            className="shrink-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <BrandLockup />
          </Link>
          <nav aria-label={t('primaryNav')} className={navRowClass(breakpoint)}>
            {primaryLinks.map((link) => (
              <NavLink key={link.href} href={link.href}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {showEnvBadge && (
            <Badge tone={envTone(env)} className="hidden sm:inline-flex">
              {env}
            </Badge>
          )}

          <LanguageSwitch />

          {signedIn ? (
            <>
              {/* Renders nothing; reports use of the page so that reading
                  or typing does not look like an idle session (#643). */}
              {idleSeconds === null ? null : (
                <SessionActivity reportEverySeconds={activityReportSeconds(idleSeconds)} />
              )}
              <div className={accountRowClass(breakpoint)}>
                {accountLinks.map((link) => (
                  <NavLink key={link.href} href={link.href}>
                    {link.label}
                  </NavLink>
                ))}
                {/* Left out when the row only fits from 2xl: it takes the
                    room the links need there. */}
                {accountName && breakpoint === 'xl' ? (
                  <span
                    className="hidden max-w-[14ch] truncate text-sm text-[var(--color-muted-foreground)] 2xl:inline"
                    title={accountName}
                  >
                    {accountName}
                  </span>
                ) : null}
              </div>
              <form className="hidden sm:block" action={signOutAction}>
                <Button type="submit" variant="ghost" size="sm" className="whitespace-nowrap">
                  {t('signOut')}
                </Button>
              </form>
            </>
          ) : null}

          <HeaderMenu label={t('menu')} hideFrom={breakpoint}>
            <nav aria-label={t('primaryNav')}>
              <ul className="flex flex-col">
                {[...primaryLinks, ...accountLinks].map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="block rounded px-3 py-2 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-ring)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            {signedIn ? (
              <div className="mt-2 border-t border-[var(--color-border)] pt-2">
                {accountName ? (
                  <p className="truncate px-3 py-1 text-xs text-[var(--color-muted-foreground)]">
                    {t('signedInAs', { name: accountName })}
                  </p>
                ) : null}
                <form className="sm:hidden" action={signOutAction}>
                  <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
                    {t('signOut')}
                  </Button>
                </form>
              </div>
            ) : null}
          </HeaderMenu>
        </div>
      </div>
    </header>
  );
}

/**
 * Signs out here and at the Cognito hosted UI, or the next "Sign in"
 * silently returns the same user (#663).
 */
async function signOutAction() {
  'use server';
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
}

function NavLink({ href, children }: { href: Route; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="whitespace-nowrap rounded text-sm font-medium text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
    >
      {children}
    </Link>
  );
}

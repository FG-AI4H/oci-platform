import type { Route } from 'next';
import type { Session } from 'next-auth';
import { canReadAuditTrail, isAdmin, isEvaluationReviewer, isHost } from '../lib/groups';

/** A key of the `Header` message namespace that labels a navigation link. */
export type HeaderLinkKey =
  | 'catalog'
  | 'models'
  | 'evaluation'
  | 'annotation'
  | 'inbox'
  | 'reviews'
  | 'auditTrail'
  | 'admin'
  | 'dashboard'
  | 'settings';

export interface HeaderLink {
  href: Route;
  key: HeaderLinkKey;
}

/**
 * The header's primary links for this caller, in display order. One
 * list, rendered as a row from `xl` up and inside the menu below it
 * (#743). Role-gated links mirror the page guards in `lib/groups.ts`;
 * the API's 403 stays authoritative.
 */
export function primaryHeaderLinks(session: Session | null | undefined): HeaderLink[] {
  const signedIn = session?.user != null;
  const admin = isAdmin(session);
  return [
    { href: '/catalog', key: 'catalog' },
    // Public like /catalog: PUBLISHED model cards only (#591).
    { href: '/models', key: 'models' },
    // Public like /catalog: evaluation tasks and their scores are
    // readable by anyone (ADR-0017); ground truth never is.
    { href: '/evaluation', key: 'evaluation' },
    ...(signedIn ? [{ href: '/annotation/campaigns' as Route, key: 'annotation' as const }] : []),
    ...(isHost(session)
      ? [{ href: '/dashboard/host/access-requests' as Route, key: 'inbox' as const }]
      : []),
    // Method review queue (#776) for evaluation reviewers. Admins, whom
    // `isEvaluationReviewer` also admits, reach it from the /admin page.
    ...(isEvaluationReviewer(session) && !admin
      ? [{ href: '/evaluation/routes/reviews' as Route, key: 'reviews' as const }]
      : []),
    // Audit trail reader (#776) for regulators. Admins reach it from the
    // /admin page too, so a second entry would only crowd their header.
    ...(canReadAuditTrail(session) && !admin
      ? [{ href: '/admin/audit' as Route, key: 'auditTrail' as const }]
      : []),
    ...(admin ? [{ href: '/admin' as Route, key: 'admin' as const }] : []),
  ];
}

/**
 * From which breakpoint the primary links sit in a row beside the
 * account area; below it they are in the menu (#743). `never` keeps the
 * menu at every width.
 */
export type RowBreakpoint = 'xl' | '2xl' | 'never';

/*
 * Decided on the number of links alone (#776), with French, whose
 * labels are the longest, as the worst case. Measured on the rendered
 * header (text-sm, 20 px between links), signed in, with the
 * environment badge shown:
 *
 *   room for the row        en       fr
 *   at 1280 px (xl)       704 px   604 px
 *   at 1536 px (2xl)      960 px   860 px   (account name left out)
 *
 *   links (fr widths)                                 count    fr width
 *   regulator / host / reviewer                          5    448 / 469 / 488 px
 *   admin (Inbox + Admin)                                6    586 px
 *   host + regulator                                     6    588 px
 *   reviewer + regulator                                 6    608 px  overflows at xl
 *   host + reviewer                                      6    629 px  overflows at xl
 *   host + reviewer + regulator (the most links)         7    749 px
 *
 * Some sets of six overflow at 1280 px in French, so six or more wait
 * for 2xl, in both languages. Seven fit at 1536 px with 111 px to spare;
 * more than seven, which no role combination reaches today, keep the
 * menu at every width.
 */
const MAX_LINKS_FROM_XL = 5;
const MAX_LINKS_FROM_2XL = 7;

export function rowBreakpoint(linkCount: number): RowBreakpoint {
  if (linkCount <= MAX_LINKS_FROM_XL) return 'xl';
  if (linkCount <= MAX_LINKS_FROM_2XL) return '2xl';
  return 'never';
}

/** The account links (dashboard, settings), for signed-in callers only. */
export function accountHeaderLinks(session: Session | null | undefined): HeaderLink[] {
  if (session?.user == null) return [];
  return [
    { href: '/dashboard', key: 'dashboard' },
    { href: '/settings', key: 'settings' },
  ];
}

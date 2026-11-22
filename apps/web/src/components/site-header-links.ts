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
    // Method review queue (#776): evaluation reviewers, and admins, who
    // have no other way in from the header.
    ...(isEvaluationReviewer(session)
      ? [{ href: '/evaluation/routes/reviews' as Route, key: 'reviews' as const }]
      : []),
    // Audit trail reader (#776) for regulators. Admins reach it from the
    // /admin page, so a second entry would only crowd their header.
    ...(canReadAuditTrail(session) && !admin
      ? [{ href: '/admin/audit' as Route, key: 'auditTrail' as const }]
      : []),
    ...(admin ? [{ href: '/admin' as Route, key: 'admin' as const }] : []),
  ];
}

/**
 * From which breakpoint the primary links fit in a row beside the
 * account area, or `never` when they need the menu at every width.
 *
 * Each role adds a link, and French labels run long: an admin's links
 * in French fill the row at 1280 px, and the review queue (#776) takes
 * them past it. Rather than let the row run into the account area, the
 * header keeps the menu up to the width where the row fits.
 */
export type RowBreakpoint = 'xl' | '2xl' | 'never';

// Measured on the rendered header (text-sm, gap-5): labels average
// about 7.5 px a character in both languages.
const CHAR_PX = 7.6;
const GAP_PX = 20;
// Room for the row at 1280 px, beside the French account area with the
// environment badge shown (the widest it gets): about 604 px.
const XL_BUDGET_PX = 600;
// Room at the header's 1536 px cap once the account name, which the
// header otherwise shows from 2xl, is left out: about 860 px.
const XXL_BUDGET_PX = 840;

/** An estimate of the row's width in pixels, from its labels. */
export function estimatedRowWidth(labels: readonly string[]): number {
  if (labels.length === 0) return 0;
  const chars = labels.reduce((sum, label) => sum + label.length, 0);
  return chars * CHAR_PX + (labels.length - 1) * GAP_PX;
}

export function rowBreakpoint(labels: readonly string[]): RowBreakpoint {
  const width = estimatedRowWidth(labels);
  if (width <= XL_BUDGET_PX) return 'xl';
  if (width <= XXL_BUDGET_PX) return '2xl';
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

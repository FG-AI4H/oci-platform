import Link from 'next/link';
import { Badge } from '@oci/ui';
import type { AccessRequestStatus, AccessRequestSummary, DatasetDetail } from '@oci/shared-types';

/**
 * Hero-grade access-control widget for the dataset detail page (PR L.3).
 *
 * Replaces the small inline "Request access" link that lived in the
 * old hero subline. Behaviour:
 *
 *   - **Hidden** for callers who already have access by virtue of role
 *     (host of this dataset, admin) or because every distribution is
 *     freely available (PUBLIC + no `requiresAccess`-flagged
 *     distributions).
 *   - **"Request access" CTA** when the caller needs to file a request
 *     and hasn't already.
 *   - **"Pending review" / "Approved" / "Denied" status badges** when
 *     a request already exists, with a link back to the requester's
 *     dashboard. APPROVED prompts to "browse distributions" (the
 *     download buttons further down the page).
 *   - **Anonymous "Sign in to request access"** with a callbackUrl
 *     back to this page so the requester lands on the form straight
 *     after signing in.
 *
 * The "needs access" rule is broader than the old code's
 * `RESTRICTED + PUBLISHED` check: PUBLIC datasets can mark individual
 * distributions as `requiresAccess: true` (e.g. metadata public, full
 * DICOMs gated). Surface the CTA in those cases too.
 */

interface Props {
  detail: DatasetDetail;
  /** Existing access requests this caller has filed for this dataset. */
  ownRequests: AccessRequestSummary[];
  /** True when the caller has a session (any role). */
  isAuthenticated: boolean;
  /** True when the caller is the host of this dataset OR an admin. */
  isPrivilegedForDataset: boolean;
  /** True on the immediate post-submit landing (`?requested=1`). Shows a
   *  one-time confirmation banner above the status panel. */
  justRequested?: boolean;
}

const STATUS_TONE: Record<AccessRequestStatus, 'info' | 'success' | 'danger' | 'neutral'> = {
  PENDING: 'info',
  APPROVED: 'success',
  DENIED: 'danger',
  REVOKED: 'neutral',
};

/**
 * Whether the dataset has any byte that's behind the access gate.
 * RESTRICTED datasets are gated by definition. PUBLIC datasets are
 * gated only when at least one distribution sets `requiresAccess`.
 * PRIVATE datasets are excluded — only host/admin see them, handled
 * upstream.
 */
function needsAccessGate(detail: DatasetDetail): boolean {
  if (detail.visibility === 'RESTRICTED') return true;
  if (detail.visibility === 'PUBLIC') {
    return detail.distributions.some((d) => d.requiresAccess);
  }
  return false;
}

export function AccessCta({
  detail,
  ownRequests,
  isAuthenticated,
  isPrivilegedForDataset,
  justRequested = false,
}: Props) {
  if (detail.status !== 'PUBLISHED') return null;
  if (!needsAccessGate(detail)) return null;
  if (isPrivilegedForDataset) return null;

  if (!isAuthenticated) {
    return (
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <p className="text-sm font-medium">This dataset is gated.</p>
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          Sign in to request access. The host reviews each request.
        </p>
        <Link
          href={`/signin?callbackUrl=${encodeURIComponent(`/catalog/${detail.slug}/request-access`)}`}
          className="mt-3 inline-flex items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)] shadow-[var(--shadow-sm)] hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          Sign in to request access
        </Link>
      </div>
    );
  }

  // Sort by createdAt desc — pick the most recent request as the
  // canonical state. Older requests stay in the dashboard list.
  const requests = [...ownRequests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = requests[0];

  if (!latest) {
    // Authenticated, gated, no prior request → primary CTA.
    return (
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <p className="text-sm font-medium">Access is gated for this dataset.</p>
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          File a structured access request — the host reviews intent + IRB attestation against the
          dataset's DUO permission terms.
        </p>
        <Link
          href={`/catalog/${detail.slug}/request-access`}
          className="mt-3 inline-flex items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)] shadow-[var(--shadow-sm)] hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          Request access
        </Link>
      </div>
    );
  }

  // The caller has a prior request. Surface its state inline.
  return (
    <div className="space-y-3">
      {justRequested && latest.status === 'PENDING' ? (
        <div
          role="status"
          className="rounded-md border border-[var(--color-success)] bg-[var(--color-success-soft)] px-4 py-3 text-sm text-[var(--color-success)]"
        >
          Request submitted. The host has been notified — you&apos;ll see the decision here and on
          your dashboard.
        </div>
      ) : null}
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Your access request</p>
        <Badge tone={STATUS_TONE[latest.status]}>{latest.status.toLowerCase()}</Badge>
      </div>
      {latest.status === 'PENDING' ? (
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          The host is reviewing your request. You&apos;ll see the decision on your dashboard.
        </p>
      ) : null}
      {latest.status === 'APPROVED' ? (
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          You can download distributions below.
        </p>
      ) : null}
      {latest.status === 'DENIED' ? (
        <>
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
            Your request was denied. You can file a fresh request with corrected attestations.
          </p>
          {latest.decisionNote ? (
            <p className="mt-2 rounded-md bg-[var(--color-subtle)] p-2 text-xs">
              <span className="font-medium">Host&apos;s note:</span> {latest.decisionNote}
            </p>
          ) : null}
        </>
      ) : null}
      {latest.status === 'REVOKED' ? (
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          A previously-approved request was revoked. File a fresh request if your project now meets
          the revoked-condition.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <Link
          href="/dashboard/access-requests"
          className="font-medium text-[var(--color-primary)] underline underline-offset-2"
        >
          See your requests
        </Link>
        {latest.status === 'DENIED' || latest.status === 'REVOKED' ? (
          <Link
            href={`/catalog/${detail.slug}/request-access`}
            className="font-medium text-[var(--color-primary)] underline underline-offset-2"
          >
            File a new request
          </Link>
        ) : null}
      </div>
      </div>
    </div>
  );
}

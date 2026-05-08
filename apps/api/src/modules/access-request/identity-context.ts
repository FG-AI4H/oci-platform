/**
 * Requester identity-context normalizer (#115, ADR-0003 Decision 2).
 *
 * Pure function. Takes whatever the API can verify about a caller at
 * request time — for now: their email (when available) and the dataset's
 * email-domain allowlist — and produces a normalised
 * `RequesterIdentityContext`. The DUO matcher reads `identityScore` off
 * the result; the host inbox surfaces the rest as advisory metadata.
 *
 * Today's signal sources:
 *   - email category via `classifyEmailDomain` (#116)
 *   - dataset's `emailDomainAllowlist` (overrides to `institutional`)
 *
 * Future signal sources (each adds a translator without changing the
 * shape):
 *   - ORCID employment claim → `affiliation` + `ORCID_LINKED` lift
 *   - Passport `ResearcherStatus` Visa → `PASSPORT_VERIFIED`
 *   - Quiz pass receipt (#117) → `QUIZ_PASSED`
 *   - Click-wrap acceptance (#118) → `acceptedPolicies` entry
 *   - PI countersign event → `PI_COUNTERSIGNED`
 */

import {
  REQUESTER_IDENTITY_SCORE_RANK,
  safeClassifyEmailDomain,
  type EmailDomainCategory,
  type RequesterIdentityContext,
  type RequesterIdentityScore,
} from '@oci/shared-types';

export interface BuildRequesterIdentityContextInput {
  /**
   * Requester's email if known. `null` when the caller's identity is
   * a UUID-shaped Cognito sub with no separate email available — in
   * production we can't read email from the access token, so this is
   * frequently null until ID-token forwarding or User-table lookup
   * lands. Conservative behaviour: null email → `EMAIL_ONLY`.
   */
  email: string | null;
  /**
   * Per-dataset email-domain allowlist (#116). Empty / null disables
   * the allowlist; a non-empty list forces `institutional` category
   * (and thus `EMAIL_DOMAIN_VERIFIED` score) when the requester's
   * domain matches.
   */
  datasetEmailDomainAllowlist?: readonly string[] | null;
  /**
   * Active certification (#117 quiz). When `true`, the score lifts to
   * `QUIZ_PASSED` if the email-derived score didn't already reach it.
   * The access-request service queries the certification module and
   * passes the result here; the normalizer remains pure.
   */
  hasActiveCertification?: boolean;
}

/**
 * Build the context. Pure, synchronous; no DB or network IO.
 *
 * Score lift rules (only the ones live today):
 *   - `disposable`     → kept at `EMAIL_ONLY`. The PR #116 form-side
 *                       guard rejects these earlier; if we see one
 *                       here it's an admin-side path or a bypass —
 *                       in either case we don't grant the tier lift.
 *   - `public`         → `EMAIL_ONLY`. Gmail is "we know you can
 *                       receive mail at gmail" — that's not a domain
 *                       *verification*, just an email reachability
 *                       check.
 *   - `corporate`      → `EMAIL_DOMAIN_VERIFIED`. The user controls a
 *                       mailbox under a registered organisation
 *                       domain. Combined with email-confirm at signup
 *                       this is a real binding to that org.
 *   - `institutional`  → `EMAIL_DOMAIN_VERIFIED`. Same logic, plus the
 *                       TLD signals an academic / government / research
 *                       org. Future: lift further when an ORCID
 *                       employment claim corroborates.
 *   - allowlist match  → `EMAIL_DOMAIN_VERIFIED` (forced by the
 *                       category lift through `institutional`). Hosts
 *                       use this to pre-bless consortium domains the
 *                       generic heuristic would have classified as
 *                       corporate.
 */
export function buildRequesterIdentityContext(
  input: BuildRequesterIdentityContextInput,
): RequesterIdentityContext {
  const allowlist = input.datasetEmailDomainAllowlist ?? null;
  const classification = input.email ? safeClassifyEmailDomain(input.email, { allowlist }) : null;

  const emailDomainCategory: EmailDomainCategory = classification?.category ?? 'public';
  let identityScore: RequesterIdentityScore = scoreFromCategory(emailDomainCategory);

  // Quiz lift (#117). An active certification raises the score to
  // QUIZ_PASSED — but only if it wouldn't *demote*. PI_COUNTERSIGNED
  // and PASSPORT_VERIFIED already exceed QUIZ_PASSED in rank; if a
  // future translator stamps one of those before this branch runs,
  // we don't undo it.
  if (input.hasActiveCertification) {
    // eslint-disable-next-line security/detect-object-injection -- typed enum keys
    const have = REQUESTER_IDENTITY_SCORE_RANK[identityScore];
    if (have < REQUESTER_IDENTITY_SCORE_RANK.QUIZ_PASSED) {
      identityScore = 'QUIZ_PASSED';
    }
  }

  return {
    identityScore,
    visas: [],
    affiliation: null,
    emailDomainCategory,
    acceptedPolicies: [],
  };
}

function scoreFromCategory(category: EmailDomainCategory): RequesterIdentityScore {
  switch (category) {
    case 'institutional':
    case 'corporate':
      return 'EMAIL_DOMAIN_VERIFIED';
    case 'public':
    case 'disposable':
      return 'EMAIL_ONLY';
  }
}

/**
 * Best-effort email extraction from a Cognito access-token payload.
 * Production tokens carry the email only in the *id* token, which we
 * don't currently forward; in local-dev the `sub` field is itself the
 * email-shaped value the dev guard stamped. This helper hides that
 * branch from callers and keeps the production-path null until the
 * separate ID-token / User-table-lookup work lands.
 */
export function extractRequesterEmail(
  user: { sub?: string; email?: string } | undefined,
): string | null {
  if (!user) return null;
  if (typeof user.email === 'string' && user.email.includes('@')) return user.email;
  if (typeof user.sub === 'string' && user.sub.includes('@')) return user.sub;
  return null;
}

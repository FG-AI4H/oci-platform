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
  /**
   * Active ORCID iD link (#125). When `true`, the score lifts to
   * `ORCID_LINKED` (rank 2) — but only when no higher signal is
   * already in play (e.g. a quiz pass already at QUIZ_PASSED rank 3).
   * The lift composes with the email lift: an institutional email
   * (`EMAIL_DOMAIN_VERIFIED`, rank 1) + ORCID link → `ORCID_LINKED`.
   */
  hasActiveOrcidLink?: boolean;
  /**
   * Optional affiliation derived from the ORCID employment record
   * (#125). When present, populates `RequesterIdentityContext.affiliation`
   * with `source: 'orcid'`. Surfaces on the host inbox as a verified
   * institutional binding.
   */
  orcidAffiliation?: string | null;
  /**
   * Active GA4GH Passport visa types held by the requester (#126).
   * `ResearcherStatus` and `AffiliationAndRole` lift the score to
   * `PASSPORT_VERIFIED` (rank 5 — top of the ladder) per ADR-0003
   * Decision 3. Other types (`AcceptedTermsAndPolicies`,
   * `ControlledAccessGrants`, `LinkedIdentities`) are stored but
   * don't lift the score on their own.
   */
  activeVisaTypes?: readonly string[];
}

/** Visa types that lift the score to `PASSPORT_VERIFIED` (#126). */
const SCORE_LIFTING_VISA_TYPES = new Set(['ResearcherStatus', 'AffiliationAndRole']);

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

  // ORCID lift (#125). Active link raises the score to ORCID_LINKED
  // (rank 2) when nothing higher already applies. Composes with the
  // email lift naturally — domain-verified + ORCID = ORCID_LINKED.
  if (input.hasActiveOrcidLink) {
    /* eslint-disable-next-line security/detect-object-injection -- typed enum keys */
    if (REQUESTER_IDENTITY_SCORE_RANK[identityScore] < REQUESTER_IDENTITY_SCORE_RANK.ORCID_LINKED) {
      identityScore = 'ORCID_LINKED';
    }
  }

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

  // Passport lift (#126). A verified ResearcherStatus or
  // AffiliationAndRole visa lifts the score to PASSPORT_VERIFIED —
  // top of the ladder. Multiple lifts compose monotonically; we only
  // raise, never lower.
  const visaLift = (input.activeVisaTypes ?? []).some((t) => SCORE_LIFTING_VISA_TYPES.has(t));
  if (visaLift) {
    // eslint-disable-next-line security/detect-object-injection -- typed enum keys
    const have = REQUESTER_IDENTITY_SCORE_RANK[identityScore];
    if (have < REQUESTER_IDENTITY_SCORE_RANK.PASSPORT_VERIFIED) {
      identityScore = 'PASSPORT_VERIFIED';
    }
  }

  return {
    identityScore,
    visas: [],
    affiliation: input.orcidAffiliation
      ? { institution: input.orcidAffiliation, role: 'self', source: 'orcid' }
      : null,
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

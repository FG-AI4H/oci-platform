import { z } from 'zod';
import { DISPOSABLE_EMAIL_DOMAINS } from './email-domain-blocklist.js';

/**
 * Email-domain classifier (Phase B · DAP, #116).
 *
 * Pure function used by both the access-request form (web) and the
 * access-request service (api). Returns a coarse trust signal that
 * downstream policy (PR #115 tier scoring) consumes.
 *
 * Categories:
 *   - `institutional`  academic / government / research TLD, OR matched
 *                      a dataset's per-host allowlist. Highest trust.
 *   - `corporate`      no public/institutional/disposable signal —
 *                      treated as a private organisation.
 *   - `public`         known consumer-grade webmail (Gmail, Yahoo, etc.).
 *                      Acceptable for OPEN/REGISTERED tiers; tiered
 *                      access (#115) may step it down for CONTROLLED.
 *   - `disposable`     listed in the disposable-email-domains blocklist.
 *                      Should be rejected at the API boundary.
 *
 * Classification is intentionally heuristic, not authoritative. The
 * goal is to short-circuit obvious abuse (throwaway addresses) and
 * surface "this looks like a real institution" without round-tripping
 * to an identity provider. A human reviewer remains in the loop for
 * CONTROLLED+ tiers.
 */

// ==== Public types =======================================================

export const EmailDomainCategorySchema = z.enum([
  'institutional',
  'corporate',
  'public',
  'disposable',
]);
export type EmailDomainCategory = z.infer<typeof EmailDomainCategorySchema>;

export interface ClassifyEmailDomainOptions {
  /**
   * Per-dataset allowlist (`Dataset.emailDomainAllowlist`). When a
   * domain matches any entry — exactly, or via the leading-dot
   * subdomain-wildcard form `.example.org` — the result is forced to
   * `institutional` regardless of any other signal. Allows hosts to
   * pre-approve research consortia even when their addresses look like
   * generic corporate domains.
   */
  allowlist?: readonly string[] | null | undefined;
}

export interface EmailDomainClassification {
  category: EmailDomainCategory;
  /** Lower-cased, trimmed domain extracted from the email. */
  domain: string;
  /** Human-readable explanation of the category decision; safe to surface. */
  reason: string;
}

// ==== Implementation =====================================================

/**
 * Common consumer-grade webmail providers. Kept small and stable; the
 * goal isn't an exhaustive directory but to flag the obvious "this is a
 * personal address" case so tier scoring (#115) can act on it. Adding a
 * provider here is a deliberate decision; new entries should be common
 * enough to justify the extra rule.
 */
const PUBLIC_WEBMAIL_DOMAINS: readonly string[] = Object.freeze([
  'aol.com',
  'comcast.net',
  'daum.net',
  'fastmail.com',
  'gmail.com',
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'googlemail.com',
  'hanmail.net',
  'hotmail.co.uk',
  'hotmail.com',
  'hotmail.fr',
  'icloud.com',
  'live.com',
  'mac.com',
  'mail.com',
  'mail.ru',
  'me.com',
  'msn.com',
  'naver.com',
  'outlook.com',
  'pm.me',
  'protonmail.com',
  'proton.me',
  'qq.com',
  'rediffmail.com',
  'sina.com',
  'tutamail.com',
  'tutanota.com',
  'web.de',
  'yahoo.co.jp',
  'yahoo.co.uk',
  'yahoo.com',
  'yahoo.de',
  'yahoo.fr',
  'yandex.com',
  'yandex.ru',
  'zoho.com',
  '163.com',
  '126.com',
]);

const DISPOSABLE_SET: ReadonlySet<string> = new Set(DISPOSABLE_EMAIL_DOMAINS);
const PUBLIC_WEBMAIL_SET: ReadonlySet<string> = new Set(PUBLIC_WEBMAIL_DOMAINS);

/**
 * Country-prefixed institutional patterns. Matched as suffixes on the
 * domain — e.g. `cs.stanford.edu` ends with `.edu`, so it's
 * institutional. The matcher walks suffixes so `student.ox.ac.uk` is
 * picked up by `.ac.uk`.
 *
 * Inclusion rule of thumb: a TLD or compound suffix that's structurally
 * reserved for academic, government, military, or international-org
 * use. Generic `.org` is intentionally NOT here — a corporate entity
 * can register an .org.
 */
const INSTITUTIONAL_SUFFIXES: readonly string[] = Object.freeze([
  '.edu',
  '.gov',
  '.mil',
  '.int', // international orgs (who.int, itu.int)
  '.gouv.fr', // French government
  '.gouv.qc.ca',
  '.bund.de', // German federal
  '.gv.at', // Austrian government
  '.admin.ch', // Swiss federal admin
]);

/**
 * Compound country-coded suffixes that take the form `.<x>.<cc>` where
 * `<x>` signals "institutional" (`ac` = academic, `edu` = education,
 * `gov` = government, `mil` = military, `gob` = gobierno). The matcher
 * accepts any 2-3 letter ccTLD after the marker so additions don't
 * require maintaining a country list.
 */
const INSTITUTIONAL_COMPOUND_PREFIXES: readonly string[] = Object.freeze([
  '.ac.', // .ac.uk, .ac.jp, .ac.za, ...
  '.edu.', // .edu.au, .edu.cn, ...
  '.gov.', // .gov.uk, .gov.au, ...
  '.mil.', // .mil.uk, .mil.au, ...
  '.gob.', // Spanish-speaking government
  '.gouv.', // Francophone government
  '.research.', // .research.<cc>
]);

/**
 * Extract and validate the domain part of an email. Returns the
 * lower-cased domain after the last `@`, trimmed. Throws on
 * syntactically invalid input — callers that want a soft signal should
 * `safeClassifyEmailDomain` instead.
 */
function extractDomain(email: string): string {
  if (typeof email !== 'string') {
    throw new TypeError(`expected an email string, got ${typeof email}`);
  }
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) {
    throw new TypeError(`expected a syntactically valid email, got "${email}"`);
  }
  const domain = trimmed.slice(at + 1).toLowerCase();
  // Cheap syntactic check; not a full RFC-5322 validator. The regex
  // is linear-time over length-capped input (53 chars max per RFC-1035
  // label, 253 total) — eslint's heuristic flags the optional repeated
  // group but it cannot backtrack catastrophically here.
  // eslint-disable-next-line security/detect-unsafe-regex
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    throw new TypeError(`domain "${domain}" is not syntactically valid`);
  }
  return domain;
}

/**
 * Walk the suffix chain of `domain` (`a.b.c.example.org` → `a.b.c.example.org`,
 * `b.c.example.org`, `c.example.org`, `example.org`, `org`) and return
 * `true` if any suffix is in the supplied set. Used so a subdomain like
 * `mail.0-mail.com` is recognised as disposable when only the apex is
 * blocklisted.
 */
function anySuffixIn(domain: string, set: ReadonlySet<string>): boolean {
  let d = domain;
  while (d.length > 0) {
    if (set.has(d)) return true;
    const dot = d.indexOf('.');
    if (dot === -1) return false;
    d = d.slice(dot + 1);
  }
  return false;
}

function looksInstitutional(domain: string): boolean {
  for (const suffix of INSTITUTIONAL_SUFFIXES) {
    if (domain === suffix.slice(1) || domain.endsWith(suffix)) return true;
  }
  for (const marker of INSTITUTIONAL_COMPOUND_PREFIXES) {
    const idx = domain.indexOf(marker);
    if (idx === -1) continue;
    // Must be followed by a 2-3 letter ccTLD ending the domain.
    const tail = domain.slice(idx + marker.length);
    if (/^[a-z]{2,3}$/.test(tail)) return true;
  }
  return false;
}

function matchesAllowlist(
  domain: string,
  allowlist: readonly string[] | null | undefined,
): boolean {
  if (!allowlist || allowlist.length === 0) return false;
  for (const entry of allowlist) {
    const lower = entry.trim().toLowerCase();
    if (lower.length === 0) continue;
    if (lower.startsWith('.')) {
      // `.example.org` — match the bare domain and any subdomain.
      const bare = lower.slice(1);
      if (domain === bare || domain.endsWith(lower)) return true;
    } else if (domain === lower) {
      return true;
    }
  }
  return false;
}

/**
 * Classify the domain of `email`. Throws on invalid input.
 *
 * Order of checks matters: allowlist wins over everything (hosts can
 * pre-approve domains that would otherwise look corporate or even
 * public). Disposable wins over public/institutional so a throwaway
 * `.edu` clone doesn't slip through. Public webmail beats institutional
 * lookups so `gmail.com` doesn't accidentally trigger any future TLD
 * heuristic that adds `.com`.
 */
export function classifyEmailDomain(
  email: string,
  opts: ClassifyEmailDomainOptions = {},
): EmailDomainClassification {
  const domain = extractDomain(email);

  if (matchesAllowlist(domain, opts.allowlist)) {
    return { category: 'institutional', domain, reason: 'matched dataset email-domain allowlist' };
  }

  if (anySuffixIn(domain, DISPOSABLE_SET)) {
    return {
      category: 'disposable',
      domain,
      reason: 'domain (or its parent) is in the disposable-email-domains blocklist',
    };
  }

  if (PUBLIC_WEBMAIL_SET.has(domain)) {
    return { category: 'public', domain, reason: 'consumer-grade webmail provider' };
  }

  if (looksInstitutional(domain)) {
    return {
      category: 'institutional',
      domain,
      reason: 'academic / government / research TLD',
    };
  }

  return {
    category: 'corporate',
    domain,
    reason: 'no public/institutional/disposable signal — treated as corporate',
  };
}

/**
 * Soft-failing variant: returns `null` instead of throwing on
 * syntactically invalid input. Useful in form-side previews where a
 * partially-typed address shouldn't produce an error toast.
 */
export function safeClassifyEmailDomain(
  email: string,
  opts: ClassifyEmailDomainOptions = {},
): EmailDomainClassification | null {
  try {
    return classifyEmailDomain(email, opts);
  } catch {
    return null;
  }
}

/**
 * Allowlist entry validator. Accepts either a bare domain
 * (`example.org`) or a leading-dot wildcard (`.example.org`). Used by
 * the host-config form when editing `Dataset.emailDomainAllowlist`.
 */
export const EmailDomainAllowlistEntrySchema = z
  .string()
  .min(3)
  .max(253)
  .regex(
    // Linear-time regex over length-capped input; eslint flags the
    // optional repeated group as "unsafe" but the structure is the
    // same `<label>(.<label>)+` shape as `extractDomain`'s validator.
    // eslint-disable-next-line security/detect-unsafe-regex
    /^\.?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/,
    'expected a bare domain (example.org) or a leading-dot wildcard (.example.org)',
  );
export type EmailDomainAllowlistEntry = z.infer<typeof EmailDomainAllowlistEntrySchema>;

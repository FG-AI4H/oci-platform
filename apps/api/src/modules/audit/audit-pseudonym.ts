import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

/** Used only when OCI_ENV=local, which no deployed environment sets. */
const LOCAL_KEY = 'local-dev-only-audit-pseudonym-key-not-a-secret';
/** A key shorter than this is treated as not configured. */
const MIN_KEY_LENGTH = 32;
/** Domain separation: the same key used elsewhere gives other values. */
const LABEL = 'oci-audit-pseudonym/v1\u0000';

/**
 * Pseudonyms for the people in the audit trail, as a `regulator` reads
 * it (#653).
 *
 *   pseudonym(v) = "ps-" + first 24 hex digits of HMAC-SHA256(key, LABEL + v)
 *
 * - Keyed: without the key, a pseudonym cannot be recomputed from a
 *   guessed identifier, and cannot be turned back into one (HMAC is
 *   one-way; real ids are random UUIDs).
 * - Stable: the same identifier gives the same pseudonym on every page,
 *   in every export, for as long as the key is unchanged. Changing the
 *   key changes every pseudonym, so pseudonyms from before and after
 *   cannot be matched.
 * - 96 bits: no two people share one in practice.
 *
 * The key is `OCI_AUDIT_PSEUDONYM_KEY`, from Secrets Manager on a
 * deployed environment. It is never logged, returned or written to the
 * trail; only whether it is configured is logged. Whoever holds the key
 * can re-identify a pseudonym by computing it over the user ids, which
 * is how a lawful request to re-identify is answered.
 *
 * Without a key a deployed environment withholds actors from a
 * `regulator` entirely, rather than showing them in clear.
 */
@Injectable()
export class AuditPseudonymiser {
  private readonly logger = new Logger(AuditPseudonymiser.name);
  private readonly key: string | null;

  constructor() {
    this.key = resolveKey(process.env.OCI_AUDIT_PSEUDONYM_KEY, process.env.OCI_ENV);
    if (this.key === null) {
      this.logger.warn(
        'OCI_AUDIT_PSEUDONYM_KEY is not set (or shorter than 32 characters): regulators see actors withheld',
      );
    }
  }

  get configured(): boolean {
    return this.key !== null;
  }

  /** The pseudonym of `value`, or null when no key is configured. */
  pseudonym(value: string): string | null {
    if (this.key === null) return null;
    const mac = createHmac('sha256', this.key).update(LABEL + value, 'utf8').digest('hex');
    return `ps-${mac.slice(0, 24)}`;
  }
}

export function resolveKey(configured: string | undefined, env: string | undefined): string | null {
  if (configured !== undefined && configured.length >= MIN_KEY_LENGTH) return configured;
  if (env === 'local') return LOCAL_KEY;
  return null;
}

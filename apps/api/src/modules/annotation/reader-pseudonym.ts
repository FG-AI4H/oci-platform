import { createHmac } from 'node:crypto';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ReaderPseudonym } from '@oci/shared-types';
import { resolveKey } from '../audit/audit-pseudonym.js';

/**
 * Domain separation: the audit trail's pseudonyms use the same key under
 * another label, so a reader's id here never equals their audit
 * pseudonym, and neither can be computed from the other.
 */
const LABEL = 'oci-annotation-reader/v1\u0000';

/**
 * The campaign's pseudonymous reader ids (#648), as the agreement view
 * and the annotation export show them.
 *
 *   id(campaign, reader) = "r-" + first 8 hex digits of
 *                          HMAC-SHA256(key, LABEL + campaign id + NUL + user id)
 *
 * - Scoped to the campaign: the same reader has one id throughout a
 *   campaign (every agreement view, every export) and an unrelated id in
 *   every other campaign, so exports of two campaigns cannot be joined
 *   on the reader.
 * - Keyed: without the key, an id cannot be recomputed from a guessed
 *   user id. Whoever holds the key can, which is how a lawful request to
 *   re-identify is answered.
 * - 32 bits: within one campaign's readers a collision is negligible.
 *
 * The key is the audit trail's (`OCI_AUDIT_PSEUDONYM_KEY`, see
 * `AuditPseudonymiser`), separated by LABEL, so no new secret is
 * provisioned. Without a key a deployed environment refuses (503)
 * rather than show anything closer to an identity.
 */
@Injectable()
export class ReaderPseudonymiser {
  private readonly logger = new Logger(ReaderPseudonymiser.name);
  // Runtime-private: kept out of JSON.stringify, util.inspect and logs.
  readonly #key: string | null;

  constructor() {
    this.#key = resolveKey(process.env.OCI_AUDIT_PSEUDONYM_KEY, process.env.OCI_ENV);
    if (this.#key === null) {
      this.logger.warn(
        'OCI_AUDIT_PSEUDONYM_KEY is not set: campaign agreement and annotation exports are refused',
      );
    }
  }

  /** The id function for one campaign. Throws 503 when no key is configured. */
  forCampaign(campaignId: string): (userId: string) => ReaderPseudonym {
    const key = this.#key;
    if (key === null) {
      throw new ServiceUnavailableException(
        'Reader pseudonyms are not configured on this deployment',
      );
    }
    const cache = new Map<string, ReaderPseudonym>();
    return (userId) => {
      let id = cache.get(userId);
      if (id === undefined) {
        const mac = createHmac('sha256', key)
          .update(`${LABEL}${campaignId}\u0000${userId}`, 'utf8')
          .digest('hex');
        id = `r-${mac.slice(0, 8)}`;
        cache.set(userId, id);
      }
      return id;
    };
  }
}

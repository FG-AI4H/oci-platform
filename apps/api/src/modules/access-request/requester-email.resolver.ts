import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CognitoAdminClient } from '../identity-admin/cognito-admin.client.js';
import { extractRequesterEmail } from './identity-context.js';

/** How long a looked-up address is reused before asking Cognito again. */
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 1_000;

/**
 * The requester's e-mail for the identity score of an access request (#656).
 *
 * Deployed environments authenticate with the Cognito *access* token, which
 * carries no e-mail claim and a UUID `sub`, so `extractRequesterEmail` alone
 * returned null there and every request scored as a free-webmail address.
 * When the token has no e-mail, this looks the address up in the user pool by
 * the token's `username` and uses it only if Cognito marks it verified: an
 * unverified institutional address would let anyone claim an affiliation by
 * typing it at sign-up.
 *
 * A lookup failure resolves to null, which the identity normalizer treats as
 * the lowest score. That is the conservative answer, and the request still
 * goes through to the host.
 */
@Injectable()
export class RequesterEmailResolver {
  private readonly logger = new Logger(RequesterEmailResolver.name);
  private readonly cache = new Map<string, { email: string | null; expiresAt: number }>();

  constructor(@Inject(CognitoAdminClient) private readonly cognito: CognitoAdminClient) {}

  async resolve(user: CognitoAccessTokenPayload | undefined): Promise<string | null> {
    const fromToken = extractRequesterEmail(user as { sub?: string; email?: string } | undefined);
    if (fromToken) return fromToken;

    const username = (user as { username?: unknown } | undefined)?.username;
    if (typeof username !== 'string' || username.length === 0) return null;

    const now = Date.now();
    const hit = this.cache.get(username);
    if (hit && hit.expiresAt > now) return hit.email;

    let email: string | null = null;
    try {
      email = await this.cognito.getVerifiedEmail(username);
    } catch (err) {
      this.logger.warn(
        `Requester e-mail lookup failed; scoring as unknown: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null; // not cached, so the next request retries
    }

    if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.clear();
    this.cache.set(username, { email, expiresAt: now + CACHE_TTL_MS });
    return email;
  }
}

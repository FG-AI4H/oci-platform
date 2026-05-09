import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  OrcidAuthorizeResponse,
  OrcidCallbackRequest,
  OrcidLinkSummary,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { OrcidLinkRepository, type OrcidLinkRow } from './orcid-link.repository.js';
import { OrcidOauthClient } from './orcid-oauth-client.js';

/**
 * ORCID link service (#125, ADR-0003 Phase 2).
 *
 * Three responsibilities:
 *   1. Build the ORCID authorize URL + a CSRF state value.
 *   2. Validate the callback (state match), exchange code → token,
 *      fetch person record, persist the link.
 *   3. Read the caller's link for /me and the identity-context lift.
 *
 * The `OrcidOauthClient` is built from env at construction time. When
 * env isn't configured (dev/CI), the authorize/callback endpoints
 * return 503 and `hasLink()` continues to work — so an unconfigured
 * platform doesn't block the rest of access-governance.
 *
 * State storage is in-memory + signed: we generate a random nonce,
 * sign it with `OCI_ORCID_STATE_SECRET` (or a random secret per boot
 * if unset), and check the HMAC on callback. No Redis dependency
 * yet; the trade-off is that a horizontally-scaled API would lose
 * state across replicas — flag `OCI_ORCID_STATE_SECRET` as
 * shared-across-replicas before scaling out.
 */
@Injectable()
export class OrcidLinkService {
  private readonly logger = new Logger(OrcidLinkService.name);
  private readonly oauthClient: OrcidOauthClient | null;
  private readonly stateSecret: string;

  constructor(@Inject(OrcidLinkRepository) private readonly repo: OrcidLinkRepository) {
    this.oauthClient = OrcidOauthClient.fromEnv();
    if (!this.oauthClient) {
      this.logger.warn(
        'ORCID OAuth disabled — set OCI_ORCID_CLIENT_ID, OCI_ORCID_CLIENT_SECRET, OCI_ORCID_REDIRECT_URI to activate.',
      );
    }
    // A boot-random secret is fine when there's a single replica —
    // the state lives for ~5 minutes during the OAuth dance.
    this.stateSecret = process.env.OCI_ORCID_STATE_SECRET ?? randomBytes(32).toString('hex');
  }

  async startAuthorize(user: CognitoAccessTokenPayload): Promise<OrcidAuthorizeResponse> {
    requireUser(user);
    if (!this.oauthClient) {
      throw new ServiceUnavailableException(
        'ORCID OAuth is not configured on this deployment. Operator must set OCI_ORCID_CLIENT_ID + OCI_ORCID_CLIENT_SECRET + OCI_ORCID_REDIRECT_URI.',
      );
    }
    const state = this.signState({ sub: user.sub, nonce: randomBytes(16).toString('hex') });
    const authorizeUrl = this.oauthClient.buildAuthorizeUrl(state);
    return { authorizeUrl, state };
  }

  async completeCallback(
    body: OrcidCallbackRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<OrcidLinkSummary> {
    requireUser(user);
    if (!this.oauthClient) {
      throw new ServiceUnavailableException('ORCID OAuth is not configured.');
    }

    // CSRF defence: the state must HMAC-verify against the same user
    // that's currently authenticated. A different user landing on the
    // callback URL with a stolen state would fail the sub-match.
    if (!this.verifyState(body.state, user.sub)) {
      throw new BadRequestException('ORCID state did not validate (possible CSRF).');
    }

    const token = await this.oauthClient.exchangeCode(body.code);
    const profile = await this.oauthClient.fetchPersonRecord(token.orcidId, token.accessToken);

    // Cross-user collision check: a different OCI account already
    // claims this ORCID iD. Reject with a 409 — re-claiming is a
    // governance issue, not a user-friendly affordance.
    const existing = await this.repo.findByOrcidId(token.orcidId);
    const userId = subToUuid(user.sub);
    if (existing && existing.userId !== userId) {
      throw new ConflictException(
        `ORCID iD ${token.orcidId} is already linked to a different account on this platform.`,
      );
    }

    const row = await this.repo.upsert({
      userId,
      orcidId: token.orcidId,
      fullName: token.name ?? null,
      primaryEmail: profile.emails[0] ?? null,
      affiliation: profile.affiliation,
    });
    return toSummary(row);
  }

  async getMyLink(user: CognitoAccessTokenPayload): Promise<OrcidLinkSummary | null> {
    requireUser(user);
    const row = await this.repo.findForUser(subToUuid(user.sub));
    return row ? toSummary(row) : null;
  }

  async unlink(user: CognitoAccessTokenPayload): Promise<void> {
    requireUser(user);
    await this.repo.delete(subToUuid(user.sub));
  }

  /**
   * Identity-context input — pure, synchronous read of "does this user
   * have an active ORCID link?". Re-uses the same userId derivation
   * the access-request service uses, so the lookup matches the row
   * we'd persist.
   */
  async hasActiveOrcidLink(user: CognitoAccessTokenPayload): Promise<boolean> {
    if (!user?.sub) return false;
    const row = await this.repo.findForUser(subToUuid(user.sub));
    return row !== null;
  }

  // --- state helpers ----------------------------------------------------

  private signState(payload: { sub: string; nonce: string }): string {
    const json = JSON.stringify(payload);
    const sig = createHash('sha256')
      .update(this.stateSecret)
      .update('|')
      .update(json)
      .digest('hex')
      .slice(0, 32);
    return `${Buffer.from(json).toString('base64url')}.${sig}`;
  }

  private verifyState(state: string, expectedSub: string): boolean {
    const parts = state.split('.');
    if (parts.length !== 2) return false;
    const [encoded, sig] = parts;
    if (!encoded || !sig) return false;
    const expected = createHash('sha256')
      .update(this.stateSecret)
      .update('|')
      .update(Buffer.from(encoded, 'base64url'))
      .digest('hex')
      .slice(0, 32);
    if (sig !== expected) return false;
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
        sub?: string;
      };
      return payload.sub === expectedSub;
    } catch {
      return false;
    }
  }
}

function requireUser(user: CognitoAccessTokenPayload | undefined): void {
  if (!user?.sub) throw new ForbiddenException('authentication required');
}

function toSummary(row: OrcidLinkRow): OrcidLinkSummary {
  return {
    orcidId: row.orcidId as OrcidLinkSummary['orcidId'],
    fullName: row.fullName,
    primaryEmail: row.primaryEmail,
    affiliation: row.affiliation,
    verifiedAt: row.verifiedAt.toISOString(),
    publicUrl: `https://orcid.org/${row.orcidId}`,
  };
}

const SUB_NAMESPACE_UUID = 'a4f1c8b2-7d3e-5b9c-9f0a-3c8d4e5f6a7b';

function subToUuid(sub: string): string {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(sub)) {
    return sub.toLowerCase();
  }
  const nsBytes = Buffer.from(SUB_NAMESPACE_UUID.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(Buffer.from(sub, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

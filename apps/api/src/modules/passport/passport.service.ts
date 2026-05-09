import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  IngestPassportVisaRequest,
  ListPassportVisasResponse,
  PassportTrustedIssuerSummary,
  PassportVisaSummary,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { PassportRepository, type PassportVisaRow } from './passport.repository.js';
import { PassportVerifier } from './passport-verifier.js';

/**
 * GA4GH Passport relying-party service (#126, ADR-0003 Phase 2).
 *
 * Three responsibilities:
 *   1. Ingest a Visa JWT — verify against the trusted-issuer registry's
 *      JWKS and persist the parsed visa row.
 *   2. Read the caller's verified visas (for /me + identity-context lift).
 *   3. Revoke (soft-delete) the caller's own visa.
 *
 * The trusted-issuer registry is admin-managed via Prisma seed / direct
 * DB write today. The `listTrustedIssuers()` accessor is read-only and
 * surfaces the active set for documentation / future admin UI.
 *
 * Identity-context input is a pure function on top of `listActiveVisasForUser`
 * — the access-request service queries it the same way it queries the
 * ORCID link. ResearcherStatus + AffiliationAndRole both lift the score
 * to PASSPORT_VERIFIED per ADR-0003 Decision 3.
 */
@Injectable()
export class PassportService {
  private readonly logger = new Logger(PassportService.name);
  private readonly verifier: PassportVerifier;

  constructor(
    @Inject(PassportRepository) private readonly repo: PassportRepository,
    verifier?: PassportVerifier,
  ) {
    this.verifier = verifier ?? new PassportVerifier();
  }

  async ingestVisa(
    body: IngestPassportVisaRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<PassportVisaSummary> {
    requireUser(user);

    // Decode unverified to read the issuer claim — we need that to
    // pick the right JWKS. The verifier checks signature next.
    const decoded = PassportVerifier.decodeUnverified(body.jwt);
    if (!decoded) {
      throw new BadRequestException('Passport JWT is malformed.');
    }
    const issuerEntry = await this.repo.findActiveIssuer(decoded.iss);
    if (!issuerEntry) {
      throw new BadRequestException(
        `Passport JWT issuer '${decoded.iss}' is not in the trust list.`,
      );
    }
    const jwksUri = issuerEntry.jwksUri ?? defaultJwksUri(issuerEntry.issuer);

    const verified = await this.verifier.verify(body.jwt, {
      issuer: issuerEntry.issuer,
      jwksUri,
    });
    if (!verified) {
      throw new BadRequestException(
        'Passport JWT did not verify (signature, expiry, or missing ga4gh_visa_v1 claim).',
      );
    }

    const userId = subToUuid(user.sub);
    const row = await this.repo.upsertVisa({
      userId,
      issuer: verified.iss,
      visaType: verified.visaType,
      jti: verified.jti,
      payload: verified.visa,
      assertedAt: verified.assertedAt,
      expiresAt: verified.expiresAt,
    });
    return toSummary(row, issuerEntry.displayName);
  }

  async listMyVisas(user: CognitoAccessTokenPayload): Promise<ListPassportVisasResponse> {
    requireUser(user);
    const userId = subToUuid(user.sub);
    const rows = await this.repo.listActiveVisasForUser(userId);
    const issuerLabels = await this.issuerDisplayNameMap();
    return {
      items: rows.map((r) => toSummary(r, issuerLabels.get(r.issuer) ?? r.issuer)),
    };
  }

  async revokeMyVisa(user: CognitoAccessTokenPayload, id: string): Promise<void> {
    requireUser(user);
    const userId = subToUuid(user.sub);
    const row = await this.repo.findVisaForUser(userId, id);
    if (!row) throw new NotFoundException('Passport visa not found.');
    await this.repo.revokeVisa(userId, id);
  }

  async listTrustedIssuers(): Promise<PassportTrustedIssuerSummary[]> {
    const rows = await this.repo.listIssuers();
    return rows.map((r) => ({
      id: r.id,
      issuer: r.issuer,
      displayName: r.displayName,
      jwksUri: r.jwksUri,
      active: r.revokedAt === null,
    }));
  }

  /**
   * Identity-context input — pure read. Returns the highest-rank
   * GA4GH visa type held by the user from the score-lifting set.
   * `ResearcherStatus` and `AffiliationAndRole` both lift to
   * `PASSPORT_VERIFIED` per ADR-0003 Decision 3.
   */
  async listActiveVisaTypesForUser(user: CognitoAccessTokenPayload): Promise<string[]> {
    if (!user?.sub) return [];
    const userId = subToUuid(user.sub);
    const rows = await this.repo.listActiveVisasForUser(userId);
    return rows.map((r) => r.visaType);
  }

  private async issuerDisplayNameMap(): Promise<Map<string, string>> {
    const issuers = await this.repo.listIssuers();
    return new Map(issuers.map((i) => [i.issuer, i.displayName]));
  }
}

function requireUser(user: CognitoAccessTokenPayload | undefined): void {
  if (!user?.sub) throw new ForbiddenException('authentication required');
}

function defaultJwksUri(issuer: string): string {
  // GA4GH Passport spec: discovery via OpenID Connect Discovery, but
  // most issuers also publish a stable `<issuer>/.well-known/jwks.json`.
  // The trusted-issuer entry can override; this is the fallback.
  const trimmed = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
  return `${trimmed}/.well-known/jwks.json`;
}

function toSummary(row: PassportVisaRow, issuerDisplayName: string): PassportVisaSummary {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    visaType: row.visaType,
    issuer: row.issuer,
    issuerDisplayName,
    assertedAt: row.assertedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    verifiedAt: row.verifiedAt.toISOString(),
    value: typeof payload['value'] === 'string' ? (payload['value'] as string) : null,
    source: typeof payload['source'] === 'string' ? (payload['source'] as string) : null,
  };
}

// Same UUIDv5 derivation used elsewhere in identity-schema modules
// (UserOrcidLink, QuizAttempt, …). Keeping it inline rather than
// abstracted into a shared util — there are only a handful of
// callsites and the namespace UUID is intentionally per-deployment.
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

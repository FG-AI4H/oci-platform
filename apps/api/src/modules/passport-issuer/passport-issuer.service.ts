import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';
import type {
  IssuedPassportVisaJwt,
  IssuedPassportVisaSummary,
  ListIssuedPassportVisasResponse,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { SignJWT, importPKCS8 } from 'jose';
import { PassportKeyService, type SigningKeyMaterial } from './passport-key.service.js';
import { PassportIssuerRepository, type IssuedVisaRow } from './passport-issuer.repository.js';

/**
 * GA4GH Passport issuer service (#127, ADR-0003 Phase 2).
 *
 * Mints visas the platform asserts internally:
 *   - `ResearcherStatus`        — on cert quiz pass (#117).
 *   - `AcceptedTermsAndPolicies` — on click-wrap acceptance (#118).
 *   - `ControlledAccessGrants`  — on access-request approval (#75).
 *
 * Storage model: persist the *parameters* (visa type / value /
 * expiry / kid), not the signed JWT. Re-signing is cheap; storing
 * the JWT would lock us into a kid that may rotate. The
 * `materializeJwt` path re-signs at read time using the current
 * key for the row's kid, or — if that kid was retired — the
 * current ACTIVE key (re-issue under a new kid; the verifier sees
 * a new visa from the issuer's POV but the platform's bookkeeping
 * tracks the same logical row).
 */
@Injectable()
export class PassportIssuerService {
  private readonly logger = new Logger(PassportIssuerService.name);
  private readonly issuerUrl: string;
  private readonly kmsClient: KMSClient | null;

  constructor(
    @Inject(PassportKeyService) private readonly keyService: PassportKeyService,
    @Inject(PassportIssuerRepository) private readonly repo: PassportIssuerRepository,
  ) {
    this.issuerUrl = process.env.OCI_PASSPORT_ISSUER_URL ?? 'https://oci.ai4h.net';
    this.kmsClient = process.env.AWS_REGION ? new KMSClient({}) : null;
  }

  /** Issuer URL (the `iss` claim we mint). Surfaced for `/.well-known/openid-configuration`. */
  getIssuerUrl(): string {
    return this.issuerUrl;
  }

  /**
   * Mint a visa for the user. Returns the persisted row's id; the
   * JWT is materialised on demand. Idempotent on
   * `(userId, visaType, contextRef)` — re-issuing the same logical
   * visa updates `expiresAt` rather than stamping duplicates.
   */
  async issueVisa(input: IssueVisaInput): Promise<IssuedPassportVisaSummary> {
    const expiresAt = new Date(Date.now() + input.validForDays * 86_400_000);
    const assertedAt = new Date();
    const key = await this.keyService.ensureActiveKey();

    // Stable jti: hash of (userId, visaType, contextRef) → re-issue
    // returns the same jti so external verifiers de-dupe naturally.
    const jti = stableJti(input.userId, input.visaType, input.contextRef ?? input.value);

    const row = await this.repo.upsertVisa({
      userId: input.userId,
      visaType: input.visaType,
      value: input.value,
      source: input.source ?? this.issuerUrl,
      jti,
      kid: key.kid,
      assertedAt,
      expiresAt,
      contextType: input.contextType ?? null,
      contextRef: input.contextRef ?? null,
    });
    this.logger.log(
      `Issued ${input.visaType} visa for user ${input.userId} (jti=${jti}, expires=${expiresAt.toISOString()})`,
    );
    return toSummary(row);
  }

  /**
   * Re-sign the visa row into a fresh JWT. If the row's kid has been
   * retired, re-mint under the currently-ACTIVE key and update the
   * stored kid — verifiers see a current-kid token and the JWKS
   * contains its public key.
   */
  async materializeJwt(
    user: CognitoAccessTokenPayload,
    visaId: string,
  ): Promise<IssuedPassportVisaJwt> {
    if (!user?.sub) throw new NotFoundException('Issued visa not found.');
    const userId = subToUuid(user.sub);
    const row = await this.repo.findVisaForUser(userId, visaId);
    if (!row || row.revokedAt || row.expiresAt < new Date()) {
      throw new NotFoundException('Issued visa not found or no longer active.');
    }

    let key = await this.keyService.findKey(row.kid);
    if (!key) {
      // Original kid was archived — fall back to current ACTIVE.
      key = await this.keyService.ensureActiveKey();
      await this.repo.updateKid(row.id, key.kid);
    }
    const jwt = await this.signVisa(row, key);
    return { jwt };
  }

  async listIssuedForUser(
    user: CognitoAccessTokenPayload,
  ): Promise<ListIssuedPassportVisasResponse> {
    if (!user?.sub) return { items: [] };
    const userId = subToUuid(user.sub);
    const rows = await this.repo.listForUser(userId);
    return { items: rows.map(toSummary) };
  }

  // --- internals --------------------------------------------------------

  private async signVisa(row: IssuedVisaRow, key: SigningKeyMaterial): Promise<string> {
    const visaClaim = {
      type: row.visaType,
      asserted: Math.floor(row.assertedAt.getTime() / 1000),
      value: row.value,
      source: row.source,
      by: 'system',
    };
    const claims = {
      iss: this.issuerUrl,
      sub: row.userId,
      iat: Math.floor(row.assertedAt.getTime() / 1000),
      exp: Math.floor(row.expiresAt.getTime() / 1000),
      jti: row.jti,
      ga4gh_visa_v1: visaClaim,
    };

    if (key.privateKeyPem) {
      const pkey = await importPKCS8(key.privateKeyPem, key.alg);
      return await new SignJWT(claims as never)
        .setProtectedHeader({ alg: key.alg, kid: key.kid, typ: 'JWT' })
        .sign(pkey);
    }
    if (key.kmsKeyArn) {
      return await this.signWithKms(claims, key);
    }
    throw new Error(`Signing key ${key.kid} has no material — neither KMS ARN nor PEM`);
  }

  private async signWithKms(
    claims: Record<string, unknown>,
    key: SigningKeyMaterial,
  ): Promise<string> {
    if (!this.kmsClient) throw new Error('KMS client not available — set AWS_REGION');
    if (!key.kmsKeyArn) throw new Error('signWithKms called without KMS ARN');
    const header = { alg: key.alg, kid: key.kid, typ: 'JWT' };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signingInput = `${headerB64}.${payloadB64}`;
    const result = await this.kmsClient.send(
      new SignCommand({
        KeyId: key.kmsKeyArn,
        Message: Buffer.from(signingInput),
        MessageType: 'RAW',
        SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
      }),
    );
    if (!result.Signature) throw new Error('KMS Sign returned no signature');
    const sigB64 = Buffer.from(result.Signature).toString('base64url');
    return `${signingInput}.${sigB64}`;
  }
}

export interface IssueVisaInput {
  userId: string;
  visaType:
    | 'ResearcherStatus'
    | 'AcceptedTermsAndPolicies'
    | 'ControlledAccessGrants'
    | 'AffiliationAndRole';
  value: string;
  source?: string;
  validForDays: number;
  contextType?: string | null;
  contextRef?: string | null;
}

function toSummary(row: IssuedVisaRow): IssuedPassportVisaSummary {
  return {
    id: row.id,
    visaType: row.visaType,
    value: row.value,
    source: row.source,
    jti: row.jti,
    assertedAt: row.assertedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    active: row.revokedAt === null && row.expiresAt > new Date(),
    contextType: row.contextType,
    contextRef: row.contextRef,
  };
}

function stableJti(userId: string, visaType: string, ref: string): string {
  const hash = createHash('sha256')
    .update(userId)
    .update('|')
    .update(visaType)
    .update('|')
    .update(ref)
    .digest('hex');
  return `oci-${hash.slice(0, 32)}`;
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

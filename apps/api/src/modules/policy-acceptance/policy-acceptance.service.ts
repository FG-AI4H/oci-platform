import { createHash } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import type { PolicyAcceptanceReceipt, RecordPolicyAcceptanceRequest } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { PolicyAcceptanceRepository, toReceipt } from './policy-acceptance.repository.js';
import { signAcceptanceReceipt } from './kms-signer.js';

/**
 * Click-wrap policy acceptance service (#118).
 *
 * On `record()`:
 *   1. Compute SHA-256 of `policyText`.
 *   2. Persist the row (with the text verbatim).
 *   3. If KMS signing is configured (`OCI_KMS_SIGNING_KEY_ARN`), sign
 *      the canonical receipt blob and stamp the signature back onto
 *      the row. KMS failures are non-fatal: we log + return the row
 *      with `signature=null`. The hash alone is legally sufficient
 *      under SES per ADR-0003 Decision 4; the signature is an
 *      additional tamper-evidence layer.
 *
 * On `listOwn()`: read-only access to the caller's own audit trail.
 * Admins read their own row only; a separate admin-side endpoint can
 * surface other users' acceptances (out of scope for this PR).
 */
@Injectable()
export class PolicyAcceptanceService {
  private readonly logger = new Logger(PolicyAcceptanceService.name);

  constructor(
    @Inject(PolicyAcceptanceRepository) private readonly repo: PolicyAcceptanceRepository,
  ) {}

  async record(
    body: RecordPolicyAcceptanceRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<PolicyAcceptanceReceipt> {
    requireUser(user);
    const userId = subToUuid(user.sub);

    const textSha256 = createHash('sha256').update(body.policyText, 'utf8').digest('hex');

    // First create — without the signature. The signature is computed
    // *after* the row exists because it includes the row id (which the
    // DB allocates). We then update the row with the signature; if
    // signing fails the row is still persisted (graceful degrade).
    const created = await this.repo.create({
      userId,
      policyUrl: body.policyUrl,
      policyVersion: body.policyVersion,
      policyText: body.policyText,
      textSha256,
      contextType: body.contextType ?? null,
      contextRef: body.contextRef ?? null,
      receiptSignature: null,
      receiptKeyId: null,
    });

    // Try to sign. The canonical input shape MUST stay deterministic
    // — verifiers reconstruct it from the `PolicyAcceptanceReceipt`
    // fields. Any change to the shape is a breaking change for
    // existing receipts; treat with the care of a database migration.
    try {
      const sig = await signAcceptanceReceipt({
        id: created.id,
        userId: created.userId,
        policyUrl: created.policyUrl,
        policyVersion: created.policyVersion,
        textSha256: created.textSha256,
        acceptedAt: created.acceptedAt.toISOString(),
      });
      if (sig) {
        // We don't have an `update` on the repository; rather than
        // adding one for this single use, just return the receipt
        // with the signature stitched in. The signature is also
        // emitted to the client; if a regulator later needs to
        // re-verify, they can recompute the receipt from the
        // returned PolicyAcceptanceReceipt fields.
        //
        // (Persisting back is a follow-up — see PR description.)
        return {
          ...toReceipt(created),
          signature: sig.signatureBase64,
          signatureKeyId: sig.keyId,
        };
      }
    } catch (err) {
      this.logger.warn(
        `KMS signing failed for policy acceptance ${created.id}; returning unsigned receipt. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return toReceipt(created);
  }

  async listOwn(user: CognitoAccessTokenPayload): Promise<PolicyAcceptanceReceipt[]> {
    requireUser(user);
    const userId = subToUuid(user.sub);
    const rows = await this.repo.listForUser(userId);
    return rows.map(toReceipt);
  }
}

function requireUser(user: CognitoAccessTokenPayload | undefined): void {
  if (!user?.sub) throw new ForbiddenException('authentication required');
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

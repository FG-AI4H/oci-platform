import { createHash } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  ConsentRecordResponse,
  CreateConsentRequest,
  DatasetConsentHistory,
  RevokeConsentRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { signConsentReceipt } from './consent-receipt.js';
import { ConsentRepository, toConsentResponse } from './consent.repository.js';

/**
 * Dataset consent service (#224, ADR-0012 Decision 2 + 5).
 *
 * Grant (`record`) and revocation (`revoke`) are both signed-receipt
 * events (KMS when configured, hash-binding otherwise — same as #118).
 * `isDatasetAnnotationConsented` is the gate predicate the annotation
 * workflow reads: a revoked (or expired) consent halts the dataset's
 * use in active campaigns.
 */
@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(@Inject(ConsentRepository) private readonly repo: ConsentRepository) {}

  async record(
    body: CreateConsentRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<ConsentRecordResponse> {
    const textSha256 = createHash('sha256').update(body.disclosureText, 'utf8').digest('hex');
    const created = await this.repo.create({
      datasetId: body.datasetId,
      consenterSub: user.sub,
      consenterUserId: body.consenterUserId ?? cognitoSubAsUuid(user.sub),
      consentType: body.consentType,
      scope: body.scope,
      disclosureText: body.disclosureText,
      textSha256,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
    });

    // Sign after the row exists (the envelope includes the row id).
    // Signing is best-effort: a KMS failure leaves the hash-binding row.
    try {
      const sig = await signConsentReceipt({
        id: created.id,
        datasetId: created.datasetId,
        consenterSub: created.consenterSub,
        consentType: created.consentType,
        textSha256,
        event: 'granted',
        at: created.createdAt.toISOString(),
        reason: null,
      });
      if (sig) {
        await this.repo.setGrantSignature(created.id, sig.signatureBase64, sig.keyId);
        return toConsentResponse({
          ...created,
          receiptSignature: sig.signatureBase64,
          receiptKeyId: sig.keyId,
        });
      }
    } catch (err) {
      this.logger.warn(`Consent grant signing failed for ${created.id}: ${String(err)}`);
    }
    return toConsentResponse(created);
  }

  async revoke(
    id: string,
    body: RevokeConsentRequest,
    _user: CognitoAccessTokenPayload,
  ): Promise<ConsentRecordResponse> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException(`Consent '${id}' not found`);
    if (existing.status === 'REVOKED') {
      throw new ConflictException(`Consent '${id}' is already revoked`);
    }

    const revokedAt = new Date();
    let signature: string | null = null;
    let keyId: string | null = null;
    try {
      const sig = await signConsentReceipt({
        id: existing.id,
        datasetId: existing.datasetId,
        consenterSub: existing.consenterSub,
        consentType: existing.consentType,
        textSha256: existing.textSha256,
        event: 'revoked',
        at: revokedAt.toISOString(),
        reason: body.reason,
      });
      if (sig) {
        signature = sig.signatureBase64;
        keyId = sig.keyId;
      }
    } catch (err) {
      this.logger.warn(`Consent revocation signing failed for ${id}: ${String(err)}`);
    }

    const revoked = await this.repo.revoke({
      id,
      reason: body.reason,
      revokedAt,
      signature,
      keyId,
    });
    this.logger.log(`consent.revoke id=${id} dataset=${revoked.datasetId} reason="${body.reason}"`);
    return toConsentResponse(revoked);
  }

  async get(id: string): Promise<ConsentRecordResponse> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`Consent '${id}' not found`);
    return toConsentResponse(row);
  }

  /** Per-dataset audit trail + the gate predicate (ADR-0012 / #224 DoD). */
  async historyForDataset(datasetId: string): Promise<DatasetConsentHistory> {
    const [rows, allowed] = await Promise.all([
      this.repo.listByDataset(datasetId),
      this.isDatasetAnnotationConsented(datasetId),
    ]);
    return { datasetId, annotationAllowed: allowed, records: rows.map(toConsentResponse) };
  }

  /**
   * Gate predicate: true iff the dataset currently has a valid, ACTIVE
   * ANNOTATION_USE consent. A revoked or expired consent yields false,
   * which the annotation workflow uses to halt the dataset's use in
   * active campaigns. Absence of any consent record is also false
   * (caller decides whether a dataset requires consent at all).
   */
  async isDatasetAnnotationConsented(datasetId: string): Promise<boolean> {
    const n = await this.repo.countActiveAnnotationConsents(datasetId, new Date());
    return n > 0;
  }
}

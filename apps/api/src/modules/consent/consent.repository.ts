import { Inject, Injectable } from '@nestjs/common';
import type { ConsentRecord, ConsentType, Prisma } from '@oci/database';
import type { ConsentRecordResponse } from '@oci/shared-types';
import { PrismaService } from '../../prisma.service.js';

/** Map a DB row to the API response (never leak verbatim disclosure text
 * or raw signature material; surface the hash + key id + signed flag). */
export function toConsentResponse(row: ConsentRecord): ConsentRecordResponse {
  return {
    id: row.id,
    datasetId: row.datasetId,
    consenterSub: row.consenterSub,
    consenterUserId: row.consenterUserId,
    consentType: row.consentType,
    status: row.status,
    scope: row.scope as Record<string, unknown>,
    textSha256: row.textSha256,
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil ? row.validUntil.toISOString() : null,
    signatureKeyId: row.receiptKeyId,
    signed: row.receiptSignature !== null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    revocationReason: row.revocationReason,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ConsentRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(args: {
    datasetId: string;
    consenterSub: string;
    consenterUserId: string | null;
    consentType: ConsentType;
    scope: Record<string, unknown>;
    disclosureText: string;
    textSha256: string;
    validUntil: Date | null;
  }): Promise<ConsentRecord> {
    return this.prisma.client.consentRecord.create({
      data: {
        datasetId: args.datasetId,
        consenterSub: args.consenterSub,
        consenterUserId: args.consenterUserId,
        consentType: args.consentType,
        // Prisma's `InputJsonValue` is a structural type; cast the
        // arbitrary user-supplied scope through it (same as catalog repo).
        scope: args.scope as Prisma.InputJsonValue,
        disclosureText: args.disclosureText,
        textSha256: args.textSha256,
        validUntil: args.validUntil,
      },
    });
  }

  async findById(id: string): Promise<ConsentRecord | null> {
    return this.prisma.client.consentRecord.findUnique({ where: { id } });
  }

  async listByDataset(datasetId: string): Promise<ConsentRecord[]> {
    return this.prisma.client.consentRecord.findMany({
      where: { datasetId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setGrantSignature(id: string, signature: string, keyId: string): Promise<void> {
    await this.prisma.client.consentRecord.update({
      where: { id },
      data: { receiptSignature: signature, receiptKeyId: keyId },
    });
  }

  async revoke(args: {
    id: string;
    reason: string;
    revokedAt: Date;
    signature: string | null;
    keyId: string | null;
  }): Promise<ConsentRecord> {
    return this.prisma.client.consentRecord.update({
      where: { id: args.id },
      data: {
        status: 'REVOKED',
        revokedAt: args.revokedAt,
        revocationReason: args.reason,
        revocationSignature: args.signature,
        revocationKeyId: args.keyId,
      },
    });
  }

  /** Count currently-valid ACTIVE ANNOTATION_USE consents for a dataset
   * (the gate predicate: >0 ⇒ annotation allowed). `validUntil` in the
   * past doesn't count even if status wasn't swept to EXPIRED yet. */
  async countActiveAnnotationConsents(datasetId: string, now: Date): Promise<number> {
    return this.prisma.client.consentRecord.count({
      where: {
        datasetId,
        consentType: 'ANNOTATION_USE',
        status: 'ACTIVE',
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
    });
  }
}

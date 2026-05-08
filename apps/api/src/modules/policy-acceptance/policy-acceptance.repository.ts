import { Inject, Injectable } from '@nestjs/common';
import type { PolicyAcceptanceReceipt } from '@oci/shared-types';
import { PrismaService } from '../../prisma.service.js';

interface AcceptanceRow {
  id: string;
  userId: string;
  policyUrl: string;
  policyVersion: string;
  policyText: string;
  textSha256: string;
  contextType: string | null;
  contextRef: string | null;
  receiptSignature: string | null;
  receiptKeyId: string | null;
  acceptedAt: Date;
}

/**
 * Prisma queries for `identity.policy_acceptances` (#118).
 *
 * Lives below the service: service owns hashing + KMS signing, repo
 * just hits the DB. We don't expose `policyText` on the read path
 * (it's bulky and not needed by the audit-trail UI); regulators who
 * need the full text retrieve the row by id via a future admin API.
 */
@Injectable()
export class PolicyAcceptanceRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: {
    userId: string;
    policyUrl: string;
    policyVersion: string;
    policyText: string;
    textSha256: string;
    contextType: string | null;
    contextRef: string | null;
    receiptSignature: string | null;
    receiptKeyId: string | null;
  }): Promise<AcceptanceRow> {
    return (await this.prisma.client.policyAcceptance.create({
      data: input,
    })) as unknown as AcceptanceRow;
  }

  async listForUser(userId: string, limit = 200): Promise<AcceptanceRow[]> {
    return (await this.prisma.client.policyAcceptance.findMany({
      where: { userId },
      orderBy: { acceptedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        policyUrl: true,
        policyVersion: true,
        // intentionally NO `policyText` — bulky, not needed by the
        // audit-trail surface
        policyText: false,
        textSha256: true,
        contextType: true,
        contextRef: true,
        receiptSignature: true,
        receiptKeyId: true,
        acceptedAt: true,
      },
    })) as unknown as AcceptanceRow[];
  }
}

export function toReceipt(row: AcceptanceRow): PolicyAcceptanceReceipt {
  return {
    id: row.id,
    userId: row.userId,
    policyUrl: row.policyUrl,
    policyVersion: row.policyVersion,
    textSha256: row.textSha256,
    acceptedAt: row.acceptedAt.toISOString(),
    contextType: row.contextType,
    contextRef: row.contextRef,
    signature: row.receiptSignature,
    signatureKeyId: row.receiptKeyId,
  };
}

import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';

export interface DuaSignatureRow {
  id: string;
  userId: string;
  accessRequestId: string;
  status: string;
  docusealSubmissionId: string | null;
  signerUrl: string | null;
  documentText: string;
  documentSha256: string;
  signedPdfUrl: string | null;
  createdAt: Date;
  signedAt: Date | null;
  declinedAt: Date | null;
}

@Injectable()
export class DuaSigningRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: {
    userId: string;
    accessRequestId: string;
    documentText: string;
    documentSha256: string;
    docusealSubmissionId: string | null;
    signerUrl: string | null;
  }): Promise<DuaSignatureRow> {
    return (await this.prisma.client.duaSignature.create({
      data: {
        userId: input.userId,
        accessRequestId: input.accessRequestId,
        documentText: input.documentText,
        documentSha256: input.documentSha256,
        docusealSubmissionId: input.docusealSubmissionId,
        signerUrl: input.signerUrl,
        status: 'PENDING',
      },
    })) as unknown as DuaSignatureRow;
  }

  async findById(id: string): Promise<DuaSignatureRow | null> {
    return (await this.prisma.client.duaSignature.findUnique({
      where: { id },
    })) as unknown as DuaSignatureRow | null;
  }

  async findBySubmissionId(docusealSubmissionId: string): Promise<DuaSignatureRow | null> {
    return (await this.prisma.client.duaSignature.findFirst({
      where: { docusealSubmissionId },
    })) as unknown as DuaSignatureRow | null;
  }

  async findForUser(userId: string, id: string): Promise<DuaSignatureRow | null> {
    return (await this.prisma.client.duaSignature.findFirst({
      where: { id, userId },
    })) as unknown as DuaSignatureRow | null;
  }

  async listForUser(userId: string): Promise<DuaSignatureRow[]> {
    return (await this.prisma.client.duaSignature.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })) as unknown as DuaSignatureRow[];
  }

  async findPendingForAccessRequest(accessRequestId: string): Promise<DuaSignatureRow | null> {
    return (await this.prisma.client.duaSignature.findFirst({
      where: { accessRequestId, status: 'PENDING' },
    })) as unknown as DuaSignatureRow | null;
  }

  async markSigned(id: string, signedPdfUrl: string | null): Promise<DuaSignatureRow> {
    return (await this.prisma.client.duaSignature.update({
      where: { id },
      data: {
        status: 'SIGNED',
        signedAt: new Date(),
        signedPdfUrl,
        signerUrl: null,
      },
    })) as unknown as DuaSignatureRow;
  }

  async markDeclined(id: string): Promise<DuaSignatureRow> {
    return (await this.prisma.client.duaSignature.update({
      where: { id },
      data: {
        status: 'DECLINED',
        declinedAt: new Date(),
        signerUrl: null,
      },
    })) as unknown as DuaSignatureRow;
  }

  async markExpired(id: string): Promise<DuaSignatureRow> {
    return (await this.prisma.client.duaSignature.update({
      where: { id },
      data: { status: 'EXPIRED', signerUrl: null },
    })) as unknown as DuaSignatureRow;
  }
}

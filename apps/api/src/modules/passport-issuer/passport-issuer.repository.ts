import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';

export interface IssuedVisaRow {
  id: string;
  userId: string;
  visaType: string;
  value: string;
  source: string;
  jti: string;
  kid: string;
  assertedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  contextType: string | null;
  contextRef: string | null;
  createdAt: Date;
}

@Injectable()
export class PassportIssuerRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Idempotent on `jti` — re-issuing the same logical visa updates
   * `assertedAt`, `expiresAt`, `kid`, `value`, `source` rather than
   * stamping duplicates. The caller computes a stable `jti` from
   * `(userId, visaType, contextRef)` so re-runs converge.
   */
  async upsertVisa(input: {
    userId: string;
    visaType: string;
    value: string;
    source: string;
    jti: string;
    kid: string;
    assertedAt: Date;
    expiresAt: Date;
    contextType: string | null;
    contextRef: string | null;
  }): Promise<IssuedVisaRow> {
    return (await this.prisma.client.issuedPassportVisa.upsert({
      where: { jti: input.jti },
      create: {
        userId: input.userId,
        visaType: input.visaType,
        value: input.value,
        source: input.source,
        jti: input.jti,
        kid: input.kid,
        assertedAt: input.assertedAt,
        expiresAt: input.expiresAt,
        contextType: input.contextType,
        contextRef: input.contextRef,
      },
      update: {
        value: input.value,
        source: input.source,
        kid: input.kid,
        assertedAt: input.assertedAt,
        expiresAt: input.expiresAt,
        contextType: input.contextType,
        contextRef: input.contextRef,
        revokedAt: null,
      },
    })) as unknown as IssuedVisaRow;
  }

  async findVisaForUser(userId: string, id: string): Promise<IssuedVisaRow | null> {
    return (await this.prisma.client.issuedPassportVisa.findFirst({
      where: { id, userId },
    })) as unknown as IssuedVisaRow | null;
  }

  async listForUser(userId: string): Promise<IssuedVisaRow[]> {
    return (await this.prisma.client.issuedPassportVisa.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })) as unknown as IssuedVisaRow[];
  }

  async updateKid(id: string, kid: string): Promise<void> {
    await this.prisma.client.issuedPassportVisa.update({
      where: { id },
      data: { kid },
    });
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';

export interface TrustedIssuerRow {
  id: string;
  issuer: string;
  displayName: string;
  jwksUri: string | null;
  revokedAt: Date | null;
}

export interface PassportVisaRow {
  id: string;
  userId: string;
  issuer: string;
  visaType: string;
  jti: string;
  payload: unknown;
  assertedAt: Date;
  expiresAt: Date;
  verifiedAt: Date;
  revokedAt: Date | null;
}

@Injectable()
export class PassportRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // --- trusted issuers --------------------------------------------------

  async findActiveIssuer(issuer: string): Promise<TrustedIssuerRow | null> {
    return (await this.prisma.client.passportTrustedIssuer.findFirst({
      where: { issuer, revokedAt: null },
    })) as unknown as TrustedIssuerRow | null;
  }

  async listIssuers(): Promise<TrustedIssuerRow[]> {
    return (await this.prisma.client.passportTrustedIssuer.findMany({
      orderBy: { displayName: 'asc' },
    })) as unknown as TrustedIssuerRow[];
  }

  // --- visas ------------------------------------------------------------

  async upsertVisa(input: {
    userId: string;
    issuer: string;
    visaType: string;
    jti: string;
    payload: unknown;
    assertedAt: Date;
    expiresAt: Date;
  }): Promise<PassportVisaRow> {
    return (await this.prisma.client.userPassportVisa.upsert({
      where: {
        userId_issuer_visaType_jti: {
          userId: input.userId,
          issuer: input.issuer,
          visaType: input.visaType,
          jti: input.jti,
        },
      },
      create: {
        userId: input.userId,
        issuer: input.issuer,
        visaType: input.visaType,
        jti: input.jti,
        payload: input.payload as never,
        assertedAt: input.assertedAt,
        expiresAt: input.expiresAt,
      },
      update: {
        payload: input.payload as never,
        assertedAt: input.assertedAt,
        expiresAt: input.expiresAt,
        verifiedAt: new Date(),
        revokedAt: null,
      },
    })) as unknown as PassportVisaRow;
  }

  /** Active = not revoked, not yet expired. */
  async listActiveVisasForUser(userId: string, now = new Date()): Promise<PassportVisaRow[]> {
    return (await this.prisma.client.userPassportVisa.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { verifiedAt: 'desc' },
    })) as unknown as PassportVisaRow[];
  }

  async findVisaForUser(userId: string, id: string): Promise<PassportVisaRow | null> {
    return (await this.prisma.client.userPassportVisa.findFirst({
      where: { id, userId },
    })) as unknown as PassportVisaRow | null;
  }

  /** Soft-delete: stamp `revokedAt`. Audit-preserving. */
  async revokeVisa(userId: string, id: string): Promise<void> {
    await this.prisma.client.userPassportVisa.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

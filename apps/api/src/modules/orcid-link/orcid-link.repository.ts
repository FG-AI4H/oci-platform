import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';

export interface OrcidLinkRow {
  userId: string;
  orcidId: string;
  fullName: string | null;
  primaryEmail: string | null;
  affiliation: string | null;
  verifiedAt: Date;
}

@Injectable()
export class OrcidLinkRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findForUser(userId: string): Promise<OrcidLinkRow | null> {
    return (await this.prisma.client.userOrcidLink.findUnique({
      where: { userId },
    })) as unknown as OrcidLinkRow | null;
  }

  /** True iff *any* user has this ORCID iD linked. Used to detect cross-user collisions. */
  async findByOrcidId(orcidId: string): Promise<OrcidLinkRow | null> {
    return (await this.prisma.client.userOrcidLink.findUnique({
      where: { orcidId },
    })) as unknown as OrcidLinkRow | null;
  }

  async upsert(input: {
    userId: string;
    orcidId: string;
    fullName: string | null;
    primaryEmail: string | null;
    affiliation: string | null;
  }): Promise<OrcidLinkRow> {
    return (await this.prisma.client.userOrcidLink.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        orcidId: input.orcidId,
        fullName: input.fullName,
        primaryEmail: input.primaryEmail,
        affiliation: input.affiliation,
      },
      update: {
        orcidId: input.orcidId,
        fullName: input.fullName,
        primaryEmail: input.primaryEmail,
        affiliation: input.affiliation,
        verifiedAt: new Date(),
      },
    })) as unknown as OrcidLinkRow;
  }

  async delete(userId: string): Promise<void> {
    await this.prisma.client.userOrcidLink.deleteMany({ where: { userId } });
  }
}

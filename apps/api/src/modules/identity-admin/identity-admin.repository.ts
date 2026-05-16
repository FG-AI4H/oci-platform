import { Inject, Injectable } from '@nestjs/common';
import type { IdentityAdminAuditEvent } from '@oci/database';
import { PrismaService } from '../../prisma.service.js';

/**
 * Audit-event persistence for #241. Append-only — admins never delete
 * rows. The detail page reads `last 20 by targetSub`; a future
 * ops-wide timeline reads `last N` ordered by `createdAt` descending.
 */
@Injectable()
export class IdentityAdminRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recordEvent(args: {
    actorSub: string;
    actorUsername: string;
    targetSub: string;
    targetUsername: string;
    action: 'grant' | 'revoke';
    groupName: string;
  }): Promise<IdentityAdminAuditEvent> {
    return this.prisma.client.identityAdminAuditEvent.create({
      data: {
        actorSub: args.actorSub,
        actorUsername: args.actorUsername,
        targetSub: args.targetSub,
        targetUsername: args.targetUsername,
        action: args.action,
        groupName: args.groupName,
      },
    });
  }

  async listForTarget(targetSub: string, limit = 20): Promise<IdentityAdminAuditEvent[]> {
    return this.prisma.client.identityAdminAuditEvent.findMany({
      where: { targetSub },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

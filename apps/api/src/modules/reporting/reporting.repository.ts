import { Inject, Injectable } from '@nestjs/common';
import type { ActivityReportDatasetVersion } from '@oci/shared-types';
import { PrismaService } from '../../prisma.service.js';

/** A period, `[from, to)`. */
export interface Period {
  from: Date;
  to: Date;
}

/**
 * Counts for the activity report (#828). Read-only, and counts only: how many
 * rows a period holds, never what makes a result published or a campaign's
 * readers agree. Those rules stay with the modules that own them, and the
 * service asks them.
 */
@Injectable()
export class ReportingRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async datasets(period: Period): Promise<{
    publishedAtEnd: number;
    versionsPublished: number;
    versions: ActivityReportDatasetVersion[];
  }> {
    const publicAndPublished = { visibility: 'PUBLIC', status: 'PUBLISHED' } as const;
    const inPeriod = {
      publishedAt: { gte: period.from, lt: period.to },
      dataset: publicAndPublished,
    };
    const [publishedAtEnd, versionsPublished, versions] = await Promise.all([
      this.prisma.client.dataset.count({
        where: { ...publicAndPublished, versions: { some: { publishedAt: { lt: period.to } } } },
      }),
      this.prisma.client.datasetVersion.count({ where: inPeriod }),
      this.prisma.client.datasetVersion.findMany({
        where: inPeriod,
        orderBy: { publishedAt: 'desc' },
        take: 50,
        select: {
          version: true,
          publishedAt: true,
          dataset: { select: { slug: true, name: true } },
        },
      }),
    ]);
    return {
      publishedAtEnd,
      versionsPublished,
      versions: versions.map((v) => ({
        slug: v.dataset.slug,
        name: v.dataset.name,
        version: v.version,
        publishedAt: v.publishedAt.toISOString(),
      })),
    };
  }

  /**
   * `approved` and `denied` are requests decided in the period that stand at
   * that outcome today: an approval revoked since is no longer counted as one.
   */
  async accessRequests(period: Period): Promise<{
    submitted: number;
    approved: number;
    denied: number;
    pendingAtEnd: number;
  }> {
    const decidedInPeriod = { decidedAt: { gte: period.from, lt: period.to } };
    const [submitted, approved, denied, pendingAtEnd] = await Promise.all([
      this.prisma.client.accessRequest.count({
        where: { createdAt: { gte: period.from, lt: period.to } },
      }),
      this.prisma.client.accessRequest.count({ where: { ...decidedInPeriod, status: 'APPROVED' } }),
      this.prisma.client.accessRequest.count({ where: { ...decidedInPeriod, status: 'DENIED' } }),
      this.prisma.client.accessRequest.count({
        where: {
          createdAt: { lt: period.to },
          OR: [{ status: 'PENDING' }, { decidedAt: { gte: period.to } }],
        },
      }),
    ]);
    return { submitted, approved, denied, pendingAtEnd };
  }

  /** Submissions received in the period, by task and by how they stand today. */
  async submissionsByTask(
    period: Period,
  ): Promise<Map<string, { received: number; scored: number; failed: number }>> {
    const groups = await this.prisma.client.submission.groupBy({
      by: ['taskId', 'status'],
      where: { createdAt: { gte: period.from, lt: period.to } },
      _count: { _all: true },
    });
    const byTask = new Map<string, { received: number; scored: number; failed: number }>();
    for (const group of groups) {
      const entry = byTask.get(group.taskId) ?? { received: 0, scored: 0, failed: 0 };
      entry.received += group._count._all;
      if (group.status === 'SCORED') entry.scored += group._count._all;
      if (group.status === 'FAILED') entry.failed += group._count._all;
      byTask.set(group.taskId, entry);
    }
    return byTask;
  }

  async models(period: Period): Promise<{ published: number; publishedInPeriod: number }> {
    const [published, publishedInPeriod] = await Promise.all([
      this.prisma.client.modelCard.count({ where: { status: 'PUBLISHED' } }),
      // A card has no "published on" column: the audit trail holds the move.
      this.prisma.client.auditEvent.count({
        where: {
          module: 'prediction',
          action: 'modelcard.status.changed',
          occurredAt: { gte: period.from, lt: period.to },
          payload: { path: ['to'], equals: 'PUBLISHED' },
        },
      }),
    ]);
    return { published, publishedInPeriod };
  }

  auditEvents(period: Period): Promise<number> {
    return this.prisma.client.auditEvent.count({
      where: { occurredAt: { gte: period.from, lt: period.to } },
    });
  }
}

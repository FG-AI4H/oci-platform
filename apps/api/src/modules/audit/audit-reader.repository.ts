import { Inject, Injectable } from '@nestjs/common';
import type { AuditEvent, Prisma } from '@oci/database';
import { PrismaService } from '../../prisma.service.js';

/** What the reader asks for, already resolved from the caller's filters. */
export interface AuditRowFilter {
  /** One of these kinds of subject. */
  subjectTypes?: readonly string[];
  /** Exclude events about these kinds of subject (a regulator's id filter). */
  excludeSubjectTypes?: readonly string[];
  /** One of these subject ids. */
  subjectIds?: readonly string[];
  /** One of these actor ids; `null` means events with no actor. */
  actorUserIds?: readonly string[] | null;
  module?: string;
  action?: string;
  from?: Date;
  to?: Date;
}

/**
 * Reads `platform.audit_events` for the trail reader (#653). Reads only:
 * the table refuses UPDATE and DELETE, and inserts go through the
 * `AuditEmitter`.
 */
@Injectable()
export class AuditReaderRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * A page in sequence order. `after` is the sequence number the page
   * continues from, exclusive, in the direction of `order`.
   */
  async page(args: {
    filter: AuditRowFilter;
    order: 'asc' | 'desc';
    after: bigint | null;
    take: number;
  }): Promise<AuditEvent[]> {
    const where = toWhere(args.filter);
    if (args.after !== null) {
      where.sequenceNumber = args.order === 'desc' ? { lt: args.after } : { gt: args.after };
    }
    return this.prisma.client.auditEvent.findMany({
      where,
      orderBy: { sequenceNumber: args.order },
      take: args.take,
    });
  }

  /** Every distinct actor id in the trail (to resolve a pseudonym). */
  async distinctActorIds(): Promise<string[]> {
    const rows = await this.prisma.client.auditEvent.findMany({
      where: { actorUserId: { not: null } },
      distinct: ['actorUserId'],
      select: { actorUserId: true },
    });
    return rows.map((r) => r.actorUserId).filter((id): id is string => id !== null);
  }

  /** Every distinct subject id among events about the given kinds of subject. */
  async distinctSubjectIds(subjectTypes: readonly string[]): Promise<string[]> {
    const rows = await this.prisma.client.auditEvent.findMany({
      where: { subjectType: { in: [...subjectTypes] } },
      distinct: ['subjectId'],
      select: { subjectId: true },
    });
    return rows.map((r) => r.subjectId);
  }

  /** First and last sequence numbers of the events that occurred in a time range. */
  async sequenceSpan(range: { from?: Date; to?: Date }): Promise<{
    min: bigint | null;
    max: bigint | null;
  }> {
    const occurredAt: Prisma.DateTimeFilter = {};
    if (range.from) occurredAt.gte = range.from;
    if (range.to) occurredAt.lt = range.to;
    const agg = await this.prisma.client.auditEvent.aggregate({
      where: range.from || range.to ? { occurredAt } : {},
      _min: { sequenceNumber: true },
      _max: { sequenceNumber: true },
    });
    return { min: agg._min.sequenceNumber, max: agg._max.sequenceNumber };
  }

  /** The event just before `sequenceNumber`, or null when there is none. */
  async eventBefore(
    sequenceNumber: bigint,
  ): Promise<{ sequenceNumber: bigint; recordHash: string } | null> {
    return this.prisma.client.auditEvent.findFirst({
      where: { sequenceNumber: { lt: sequenceNumber } },
      orderBy: { sequenceNumber: 'desc' },
      select: { sequenceNumber: true, recordHash: true },
    });
  }

  /** Events from `from` (inclusive) up to `to` (inclusive, when given), in chain order. */
  async chainBatch(from: bigint, to: bigint | null, take: number): Promise<AuditEvent[]> {
    return this.prisma.client.auditEvent.findMany({
      where: { sequenceNumber: to === null ? { gte: from } : { gte: from, lte: to } },
      orderBy: { sequenceNumber: 'asc' },
      take,
    });
  }
}

function toWhere(filter: AuditRowFilter): Prisma.AuditEventWhereInput {
  const and: Prisma.AuditEventWhereInput[] = [];
  if (filter.subjectTypes !== undefined) and.push({ subjectType: { in: [...filter.subjectTypes] } });
  if (filter.excludeSubjectTypes && filter.excludeSubjectTypes.length > 0) {
    and.push({ subjectType: { notIn: [...filter.excludeSubjectTypes] } });
  }
  if (filter.subjectIds !== undefined) and.push({ subjectId: { in: [...filter.subjectIds] } });
  if (filter.actorUserIds === null) and.push({ actorUserId: null });
  else if (filter.actorUserIds !== undefined) {
    and.push({ actorUserId: { in: [...filter.actorUserIds] } });
  }
  if (filter.module !== undefined) and.push({ module: filter.module });
  if (filter.action !== undefined) and.push({ action: filter.action });
  if (filter.from !== undefined) and.push({ occurredAt: { gte: filter.from } });
  if (filter.to !== undefined) and.push({ occurredAt: { lt: filter.to } });
  return and.length > 0 ? { AND: and } : {};
}

import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, Toolset } from '@oci/database';
import type { ToolsetKind, ToolsetStatus, ToolsetSummary } from '@oci/shared-types';
import { PrismaService } from '../../prisma.service.js';

export interface CreateToolsetArgs {
  slug: string;
  name: string;
  kind: ToolsetKind;
  summary: string;
  url: string;
  licence: string | null;
  version: string | null;
  maintainer: string;
  contact: string | null;
  datasetSlugs: string[];
  modelCardSlugs: string[];
  submitterUserId: string;
}

/** The editable content: every field optional, `undefined` = unchanged. */
export type UpdateToolsetArgs = Partial<Omit<CreateToolsetArgs, 'slug' | 'submitterUserId'>>;

export interface SearchToolsetsArgs {
  q?: string;
  kind?: ToolsetKind;
  datasetSlug?: string;
  modelCardSlug?: string;
  offset: number;
  limit: number;
}

export function toToolsetSummary(row: Toolset): ToolsetSummary {
  return {
    slug: row.slug,
    name: row.name,
    kind: row.kind as ToolsetKind,
    summary: row.summary,
    maintainer: row.maintainer,
    licence: row.licence,
    status: row.status as ToolsetStatus,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ToolsetRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  create(args: CreateToolsetArgs): Promise<Toolset> {
    return this.prisma.client.toolset.create({ data: args });
  }

  findBySlug(slug: string): Promise<Toolset | null> {
    return this.prisma.client.toolset.findUnique({ where: { slug } });
  }

  update(id: string, args: UpdateToolsetArgs): Promise<Toolset> {
    // Prisma leaves a column alone when its value is `undefined`.
    return this.prisma.client.toolset.update({ where: { id }, data: args });
  }

  updateStatus(id: string, status: ToolsetStatus): Promise<Toolset> {
    return this.prisma.client.toolset.update({ where: { id }, data: { status } });
  }

  /** The public list: PUBLISHED only, most recently changed first. */
  async searchPublished(args: SearchToolsetsArgs): Promise<{ rows: Toolset[]; total: number }> {
    const where: Prisma.ToolsetWhereInput = { status: 'PUBLISHED' };
    if (args.kind) where.kind = args.kind;
    if (args.datasetSlug) where.datasetSlugs = { has: args.datasetSlug };
    if (args.modelCardSlug) where.modelCardSlugs = { has: args.modelCardSlug };
    if (args.q) {
      const contains = { contains: args.q, mode: 'insensitive' } as const;
      where.OR = [{ name: contains }, { summary: contains }, { maintainer: contains }];
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.toolset.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { slug: 'asc' }],
        skip: args.offset,
        take: args.limit,
      }),
      this.prisma.client.toolset.count({ where }),
    ]);
    return { rows, total };
  }

  /** The declarer's own toolsets, every status, most recently changed first. */
  listBySubmitter(submitterUserId: string): Promise<Toolset[]> {
    return this.prisma.client.toolset.findMany({
      where: { submitterUserId },
      orderBy: [{ updatedAt: 'desc' }, { slug: 'asc' }],
      take: 200,
    });
  }
}

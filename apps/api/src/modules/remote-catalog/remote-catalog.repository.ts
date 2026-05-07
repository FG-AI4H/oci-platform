import { Inject, Injectable } from '@nestjs/common';
import type { HarvestStatus, RemoteCatalogSummary } from '@oci/shared-types';
import { PrismaService } from '../../prisma.service.js';

interface RemoteCatalogRow {
  id: string;
  slug: string;
  name: string;
  endpointUrl: string;
  description: string | null;
  harvestStatus: HarvestStatus;
  lastHarvestedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Prisma queries for the `catalog.remote_catalogs` table. Sits below
 * the service layer; service handles authz, repository just hits the
 * DB. Repository pattern matches `apps/api/src/modules/catalog/`.
 */
@Injectable()
export class RemoteCatalogRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(): Promise<RemoteCatalogSummary[]> {
    const rows = (await this.prisma.client.remoteCatalog.findMany({
      orderBy: { createdAt: 'desc' },
    })) as RemoteCatalogRow[];
    return rows.map(toSummary);
  }

  async count(): Promise<number> {
    return this.prisma.client.remoteCatalog.count();
  }

  async findById(id: string): Promise<RemoteCatalogSummary | null> {
    const row = (await this.prisma.client.remoteCatalog.findUnique({
      where: { id },
    })) as RemoteCatalogRow | null;
    return row ? toSummary(row) : null;
  }

  async findBySlug(slug: string): Promise<RemoteCatalogSummary | null> {
    const row = (await this.prisma.client.remoteCatalog.findUnique({
      where: { slug },
    })) as RemoteCatalogRow | null;
    return row ? toSummary(row) : null;
  }

  async create(input: {
    slug: string;
    name: string;
    endpointUrl: string;
    description: string | null;
  }): Promise<RemoteCatalogSummary> {
    const row = (await this.prisma.client.remoteCatalog.create({
      data: {
        slug: input.slug,
        name: input.name,
        endpointUrl: input.endpointUrl,
        description: input.description,
      },
    })) as RemoteCatalogRow;
    return toSummary(row);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.client.remoteCatalog.deleteMany({
      where: { id },
    });
    return result.count > 0;
  }
}

function toSummary(row: RemoteCatalogRow): RemoteCatalogSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    endpointUrl: row.endpointUrl,
    description: row.description,
    harvestStatus: row.harvestStatus,
    lastHarvestedAt: row.lastHarvestedAt ? row.lastHarvestedAt.toISOString() : null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

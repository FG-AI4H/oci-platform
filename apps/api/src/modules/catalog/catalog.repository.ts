import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@oci/database';
import type {
  AccessTier,
  DatasetSummary,
  DatasetDetail,
  DatasetSlug,
  DatasetVisibility,
  DatasetStatus,
} from '@oci/shared-types';
import { PrismaService } from '../../prisma.service.js';

/**
 * Prisma 7 ships its model types as conditional generics
 * (`$Result.DefaultSelection<...>`) that TypeScript can't unwrap into a
 * field-bearing object without a select clause. We define the shapes
 * we actually return ourselves — keeps type resolution local and
 * removes a footgun where adding a column to schema.prisma silently
 * wouldn't propagate to the API surface.
 */
interface DatasetRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  hostId: string;
  visibility: DatasetVisibility;
  status: DatasetStatus;
  conformanceVersion: string | null;
  croissant: unknown;
  duoTerms: string[];
  accessTier: AccessTier;
  createdAt: Date;
  updatedAt: Date;
}

interface DatasetVersionRow {
  id: string;
  datasetId: string;
  version: string;
  croissant: unknown;
  croissantHash: string | null;
  notes: string | null;
  publishedById: string;
  publishedAt: Date;
}

interface DistributionRow {
  id: string;
  datasetVersionId: string;
  croissantId: string;
  contentUrl: string | null;
  contentType: string;
  contentSizeBytes: bigint | null;
  contentHash: string | null;
  requiresAccess: boolean;
}

interface DatasetWithLatest extends DatasetRow {
  versions: DatasetVersionRow[];
}

/**
 * Catalog repository — Prisma queries + the tsvector search via raw SQL.
 *
 * Lives below the service layer; service handles authz + Croissant
 * validation + cursor encoding, repository just hits the DB.
 */
@Injectable()
export class CatalogRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Search + filter datasets. Pagination uses keyset on `(updated_at, id)`
   * so the cursor doesn't drift across writes (offset-based pagination
   * skips/repeats rows when the underlying set mutates between pages).
   *
   * @param q     Free-text. Empty / undefined → no FTS clause.
   * @param visibilities  Restrict to listed visibilities (empty = all).
   * @param statuses      Restrict to listed statuses (empty = all).
   * @param hostId        Restrict to one host (anonymous browser will
   *                      typically pass `undefined`).
   * @param after         Cursor: `{ updatedAt, id }` of the last row of
   *                      the previous page; `undefined` = first page.
   * @param limit         Max rows to return.
   */
  async search(args: {
    q?: string;
    visibilities: DatasetVisibility[];
    statuses?: DatasetStatus[];
    hostId?: string;
    after?: { updatedAt: Date; id: string };
    /** PR L.1 (#91) facets — see `ListDatasetsQuerySchema`. */
    modality?: string[];
    bodyRegion?: string[];
    condition?: string[];
    anonymizationLevel?: 'ANONYMIZED' | 'PSEUDONYMIZED' | 'IDENTIFIED';
    license?: string[];
    duoTerms?: string[];
    /** Sort order. `recent` (default) | `name` | `oldest`. */
    sort?: 'recent' | 'name' | 'oldest';
    /** Offset alternative to cursor. Cursor wins when both are passed. */
    offset?: number;
    limit: number;
  }): Promise<{ rows: DatasetSummary[]; totalEstimate: number }> {
    const {
      q,
      visibilities,
      statuses,
      hostId,
      after,
      modality,
      bodyRegion,
      condition,
      anonymizationLevel,
      license,
      duoTerms,
      sort = 'recent',
      offset,
      limit,
    } = args;

    // Compose a single SQL with conditional filters via Prisma.sql
    // fragments — keeps the query plan stable and avoids string concat.
    const ftsClause = q
      ? Prisma.sql`AND d.search_vector @@ plainto_tsquery('simple', ${q})`
      : Prisma.sql``;
    const visClause =
      visibilities.length > 0
        ? Prisma.sql`AND d.visibility = ANY(${visibilities}::"catalog"."DatasetVisibility"[])`
        : Prisma.sql``;
    const statusClause =
      statuses && statuses.length > 0
        ? Prisma.sql`AND d.status = ANY(${statuses}::"catalog"."DatasetStatus"[])`
        : Prisma.sql``;
    const hostClause = hostId ? Prisma.sql`AND d.host_id = ${hostId}::uuid` : Prisma.sql``;
    const cursorClause = after
      ? Prisma.sql`AND (d.updated_at, d.id) < (${after.updatedAt}::timestamptz, ${after.id}::uuid)`
      : Prisma.sql``;

    // BioCroissant facets (PR L.1). Filter against `d.croissant`
    // (JSONB). Each facet stores values as `[{name: "X-ray"}, ...]`;
    // we ILIKE-match the `name` field. Multiple values OR within a
    // facet (`ANY`); facets AND across each other.
    // Croissant manifests in the wild carry biomedical fields either
    // as `[{name: ...}, ...]` (the wizard's output, MLCommons-recommended
    // for multiple values) or as a single `{name: ...}` object (the
    // IDRiD seed and several upstream manifests). Wrap singletons in
    // an array so `jsonb_array_elements` accepts both shapes.
    const bioFacetClause = (
      key: 'bio:imagingModality' | 'bio:bodyRegion' | 'bio:diseaseCondition',
      values: string[] | undefined,
    ) =>
      values && values.length > 0
        ? Prisma.sql`AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(d.croissant -> ${key}) = 'array'
                  THEN d.croissant -> ${key}
                WHEN jsonb_typeof(d.croissant -> ${key}) = 'object'
                  THEN jsonb_build_array(d.croissant -> ${key})
                ELSE '[]'::jsonb
              END
            ) AS elem
            WHERE elem ->> 'name' ILIKE ANY(${values.map((v) => `%${v}%`)}::text[])
          )`
        : Prisma.sql``;
    const modalityClause = bioFacetClause('bio:imagingModality', modality);
    const bodyRegionClause = bioFacetClause('bio:bodyRegion', bodyRegion);
    const conditionClause = bioFacetClause('bio:diseaseCondition', condition);
    const anonClause = anonymizationLevel
      ? Prisma.sql`AND d.croissant ->> 'bio:anonymizationLevel' = ${anonymizationLevel}`
      : Prisma.sql``;
    // License: substring match against the manifest's `license`
    // string. Croissant allows objects too; those won't match — fine.
    const licenseClause =
      license && license.length > 0
        ? Prisma.sql`AND d.croissant ->> 'license' ILIKE ANY(${license.map((v) => `%${v}%`)}::text[])`
        : Prisma.sql``;
    // DUO terms: array overlap. `&&` returns true when any element
    // of duo_terms is in the requested set.
    const duoClause =
      duoTerms && duoTerms.length > 0
        ? Prisma.sql`AND d.duo_terms && ${duoTerms}::text[]`
        : Prisma.sql``;

    // Sort. FTS rank still wins when `q` is set; secondary sort is
    // controlled by the `sort` arg.
    const rankClause = q
      ? Prisma.sql`ts_rank(d.search_vector, plainto_tsquery('simple', ${q})) DESC,`
      : Prisma.sql``;
    const orderClause =
      sort === 'name'
        ? Prisma.sql`d.name ASC, d.id ASC`
        : sort === 'oldest'
          ? Prisma.sql`d.created_at ASC, d.id ASC`
          : Prisma.sql`d.updated_at DESC, d.id DESC`;
    const offsetClause =
      offset !== undefined && offset > 0 ? Prisma.sql`OFFSET ${offset}` : Prisma.sql``;

    type Row = {
      id: string;
      slug: string;
      name: string;
      description: string | null;
      visibility: DatasetVisibility;
      status: DatasetStatus;
      conformance_version: string | null;
      latest_version: string | null;
      created_at: Date;
      updated_at: Date;
      access_tier: AccessTier;
    };

    const rows = await this.prisma.client.$queryRaw<Row[]>(Prisma.sql`
      SELECT
        d.id,
        d.slug,
        d.name,
        d.description,
        d.visibility,
        d.status,
        d.conformance_version,
        d.access_tier,
        (
          SELECT v.version
          FROM "catalog"."dataset_versions" v
          WHERE v.dataset_id = d.id
          ORDER BY v.published_at DESC
          LIMIT 1
        ) AS latest_version,
        d.created_at,
        d.updated_at
      FROM "catalog"."datasets" d
      WHERE 1=1
        ${ftsClause}
        ${visClause}
        ${statusClause}
        ${hostClause}
        ${modalityClause}
        ${bodyRegionClause}
        ${conditionClause}
        ${anonClause}
        ${licenseClause}
        ${duoClause}
        ${cursorClause}
      ORDER BY ${rankClause} ${orderClause}
      LIMIT ${limit} ${offsetClause}
    `);

    // For the total count: separate query without the cursor / offset / LIMIT.
    // At catalog scale (low thousands) this is cheap; if it ever isn't,
    // switch to a `pg_class.reltuples` estimate.
    const totalRow = await this.prisma.client.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint AS count
      FROM "catalog"."datasets" d
      WHERE 1=1
        ${ftsClause}
        ${visClause}
        ${statusClause}
        ${hostClause}
        ${modalityClause}
        ${bodyRegionClause}
        ${conditionClause}
        ${anonClause}
        ${licenseClause}
        ${duoClause}
    `);
    const totalEstimate = Number(totalRow[0]?.count ?? 0n);

    return {
      rows: rows.map(rowToSummary),
      totalEstimate,
    };
  }

  async findBySlug(slug: DatasetSlug): Promise<DatasetDetail | null> {
    const ds = (await this.prisma.client.dataset.findUnique({
      where: { slug },
      include: {
        versions: {
          orderBy: { publishedAt: 'desc' },
          include: { distributions: true },
        },
      },
    })) as
      | (DatasetRow & {
          versions: (DatasetVersionRow & { distributions: DistributionRow[] })[];
        })
      | null;

    if (!ds) return null;

    const latest = ds.versions[0];
    return {
      id: ds.id,
      slug: ds.slug,
      name: ds.name,
      description: ds.description,
      visibility: ds.visibility as DatasetVisibility,
      status: ds.status as DatasetStatus,
      conformanceVersion: ds.conformanceVersion,
      latestVersion: latest?.version ?? null,
      createdAt: ds.createdAt.toISOString(),
      updatedAt: ds.updatedAt.toISOString(),
      // findBySlug only returns LOCAL rows — federated rows are
      // addressed by id, not slug, and reach via repo.searchFederated.
      sourceCatalog: null,
      originUrl: null,
      croissant: ds.croissant ?? null,
      versions: ds.versions.map((v: DatasetVersionRow) => ({
        id: v.id,
        version: v.version,
        croissantHash: v.croissantHash,
        notes: v.notes,
        publishedAt: v.publishedAt.toISOString(),
      })),
      distributions:
        latest?.distributions.map((d: DistributionRow) => ({
          id: d.id,
          croissantId: d.croissantId,
          contentUrl: d.contentUrl,
          contentType: d.contentType,
          contentSizeBytes: d.contentSizeBytes == null ? null : Number(d.contentSizeBytes),
          contentHash: d.contentHash,
          requiresAccess: d.requiresAccess,
        })) ?? [],
      duoTerms: ds.duoTerms ?? [],
      hostId: ds.hostId,
      accessTier: ds.accessTier as AccessTier,
    };
  }

  async create(data: {
    slug: string;
    name: string;
    description?: string | null;
    hostId: string;
    visibility: DatasetVisibility;
  }): Promise<DatasetRow> {
    return (await this.prisma.client.dataset.create({
      data: {
        slug: data.slug,
        name: data.name,
        description: data.description ?? null,
        hostId: data.hostId,
        visibility: data.visibility,
        status: 'DRAFT',
      },
    })) as DatasetRow;
  }

  async findIdAndHostBySlug(slug: string): Promise<{
    id: string;
    hostId: string;
    visibility: DatasetVisibility;
    duoTerms: string[];
    accessTier: AccessTier;
    emailDomainAllowlist: string[];
  } | null> {
    const ds = await this.prisma.client.dataset.findUnique({
      where: { slug },
      select: {
        id: true,
        hostId: true,
        visibility: true,
        duoTerms: true,
        accessTier: true,
        emailDomainAllowlist: true,
      },
    });
    if (!ds) return null;
    return {
      id: ds.id,
      hostId: ds.hostId,
      visibility: ds.visibility as DatasetVisibility,
      duoTerms: ds.duoTerms ?? [],
      accessTier: ds.accessTier as AccessTier,
      emailDomainAllowlist: ds.emailDomainAllowlist ?? [],
    };
  }

  /**
   * Atomically: create a DatasetVersion, mirror its distribution rows
   * (extracted from the Croissant manifest), and bump the parent dataset's
   * `croissant` (latest) + `conformance_version` + `status` to PUBLISHED.
   */
  async publishVersion(args: {
    datasetId: string;
    version: string;
    croissant: unknown;
    croissantHash: string | null;
    notes: string | null;
    publishedById: string;
    conformanceVersion: string;
    /** PR J.1 (#93): DUO ids extracted from the manifest's consentCode. */
    duoTerms: string[];
    distributions: Array<{
      croissantId: string;
      contentUrl: string | null;
      contentType: string;
      contentSizeBytes: number | null;
      contentHash: string | null;
      requiresAccess: boolean;
      // PR I (#87): when the manifest's `contentUrl` references a
      // platform-hosted upload, the service stamps the source S3
      // location onto the extract so downstream gated downloads work.
      storageBackend?: 'EXTERNAL' | 'S3' | 'EXTERNAL_S3';
      s3Bucket?: string | null;
      s3Key?: string | null;
      uploadStatus?: 'PENDING' | 'READY' | 'FAILED' | null;
    }>;
  }): Promise<DatasetVersionRow> {
    return (await this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
      const v = await tx.datasetVersion.create({
        data: {
          datasetId: args.datasetId,
          version: args.version,
          croissant: args.croissant as Prisma.InputJsonValue,
          croissantHash: args.croissantHash,
          notes: args.notes,
          publishedById: args.publishedById,
        },
      });

      if (args.distributions.length > 0) {
        await tx.distribution.createMany({
          data: args.distributions.map((d) => ({
            datasetVersionId: v.id,
            croissantId: d.croissantId,
            contentUrl: d.contentUrl,
            contentType: d.contentType,
            contentSizeBytes: d.contentSizeBytes == null ? null : BigInt(d.contentSizeBytes),
            contentHash: d.contentHash,
            requiresAccess: d.requiresAccess,
            // Default-to-EXTERNAL is safe; the service only sets these
            // when adopting a prior platform-hosted upload (PR I, #87).
            storageBackend: d.storageBackend ?? 'EXTERNAL',
            s3Bucket: d.s3Bucket ?? null,
            s3Key: d.s3Key ?? null,
            uploadStatus: d.uploadStatus ?? null,
          })),
        });
      }

      await tx.dataset.update({
        where: { id: args.datasetId },
        data: {
          status: 'PUBLISHED',
          conformanceVersion: args.conformanceVersion,
          croissant: args.croissant as Prisma.InputJsonValue,
          duoTerms: args.duoTerms,
        },
      });

      return v;
    })) as DatasetVersionRow;
  }

  /**
   * Look up Distributions by ID for the publish-time adoption pass
   * (PR I, #87). Returns just the columns the catalog service needs
   * to copy onto a freshly-extracted ExtractedDistribution: storage
   * backend + S3 location + size/hash + the dataset id (for the
   * same-dataset guardrail in the service).
   */
  async findDistributionsForAdoption(ids: string[]): Promise<
    Array<{
      id: string;
      datasetId: string;
      uploadStatus: 'PENDING' | 'READY' | 'FAILED' | null;
      s3Bucket: string | null;
      s3Key: string | null;
      contentSizeBytes: bigint | null;
      contentHash: string | null;
    }>
  > {
    if (ids.length === 0) return [];
    const rows = await this.prisma.client.distribution.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        uploadStatus: true,
        s3Bucket: true,
        s3Key: true,
        contentSizeBytes: true,
        contentHash: true,
        // Distribution → DatasetVersion → datasetId. Cheaper than
        // emitting two queries since Prisma flattens to a JOIN.
        datasetVersion: { select: { datasetId: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      datasetId: r.datasetVersion.datasetId,
      uploadStatus: r.uploadStatus,
      s3Bucket: r.s3Bucket,
      s3Key: r.s3Key,
      contentSizeBytes: r.contentSizeBytes,
      contentHash: r.contentHash,
    }));
  }

  /** Public-only: feeds `/v2/catalog/.well-known/croissant-catalog.json`. */
  async listPublicForFederation(): Promise<DatasetWithLatest[]> {
    return (await this.prisma.client.dataset.findMany({
      where: { visibility: 'PUBLIC', status: 'PUBLISHED' },
      include: {
        versions: { orderBy: { publishedAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    })) as DatasetWithLatest[];
  }

  /**
   * Federated rows — mirrors of datasets harvested from peer
   * catalogues (`RemoteDataset`). Optional `q` does a case-insensitive
   * `ILIKE` search on name/slug/description; the local table's
   * tsvector machinery isn't replicated here because federated rows
   * are append-only mirrors and the row count stays modest until PR
   * E.3 scales the worker. Sorted by `harvested_at DESC` so
   * recently-refreshed peers surface first.
   */
  async searchFederated(args: {
    q?: string;
    limit: number;
  }): Promise<{ rows: DatasetSummary[]; totalEstimate: number }> {
    const { q, limit } = args;
    const where: Prisma.RemoteDatasetWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};

    const [rows, totalEstimate] = await Promise.all([
      this.prisma.client.remoteDataset.findMany({
        where,
        include: {
          sourceCatalog: { select: { id: true, slug: true, name: true } },
        },
        orderBy: [{ harvestedAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      this.prisma.client.remoteDataset.count({ where }),
    ]);

    return {
      rows: (
        rows as Array<{
          id: string;
          slug: string;
          name: string;
          description: string | null;
          conformanceVersion: string | null;
          version: string | null;
          originUrl: string;
          harvestedAt: Date;
          createdAt: Date;
          updatedAt: Date;
          sourceCatalog: { id: string; slug: string; name: string };
        }>
      ).map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        // Federated rows are PUBLIC + PUBLISHED by definition (the
        // worker only mirrors what peers expose publicly).
        visibility: 'PUBLIC' as const,
        status: 'PUBLISHED' as const,
        conformanceVersion: r.conformanceVersion,
        latestVersion: r.version,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.harvestedAt.toISOString(),
        sourceCatalog: r.sourceCatalog,
        originUrl: r.originUrl,
        // Federated rows have no local accessTier — peers manage their
        // own tier policy. Default to OPEN so the catalog list renders;
        // any per-distribution `requiresAccess` still gates download.
        accessTier: 'OPEN' as const,
      })),
      totalEstimate,
    };
  }
}

function rowToSummary(r: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: DatasetVisibility;
  status: DatasetStatus;
  conformance_version: string | null;
  latest_version: string | null;
  created_at: Date;
  updated_at: Date;
  access_tier: AccessTier;
}): DatasetSummary {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    visibility: r.visibility,
    status: r.status,
    conformanceVersion: r.conformance_version,
    latestVersion: r.latest_version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    sourceCatalog: null,
    originUrl: null,
    accessTier: r.access_tier,
  };
}

import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@oci/database';
import { validate as validateCroissant, extractDuoTerms } from '@oci/croissant';
import type {
  AccessTier,
  CommercialUseTerms,
  CreateDatasetRequest,
  DatasetDetail,
  DatasetSlug,
  ListDatasetsQuery,
  ListDatasetsResponse,
  PublishDatasetVersionRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { CatalogRepository } from './catalog.repository.js';

/**
 * Catalog service — authz, Croissant validation, version + distribution
 * mirroring. Keeps the controller thin (Nest's recommended layering).
 *
 * Visibility rules for the read path:
 *   - Anonymous (no token): only PUBLIC + PUBLISHED rows.
 *   - Authenticated participant/annotator/reviewer: PUBLIC + RESTRICTED.
 *   - Host: their own datasets at any visibility/status, plus PUBLIC of others.
 *   - Admin / regulator / supervisor: everything (audit need).
 *
 * `cognito:groups` is the source of truth — see RolesGuard.
 */
@Injectable()
export class CatalogService {
  constructor(@Inject(CatalogRepository) private readonly repo: CatalogRepository) {}

  /**
   * Internal lookup used by sibling modules (access-request) that need
   * to know who hosts a dataset before applying their own authz. No
   * visibility filter — callers must NOT surface this directly to
   * un-authenticated readers.
   */
  async findOwnerBySlug(slug: DatasetSlug): Promise<{
    id: string;
    hostId: string;
    visibility: 'PRIVATE' | 'RESTRICTED' | 'PUBLIC';
    duoTerms: string[];
    accessTier: AccessTier;
    emailDomainAllowlist: string[];
    commercialUseTerms: CommercialUseTerms;
    commercialClauses: string | null;
  } | null> {
    return this.repo.findIdAndHostBySlug(slug);
  }

  async list(
    query: ListDatasetsQuery,
    user?: CognitoAccessTokenPayload,
  ): Promise<ListDatasetsResponse> {
    const groups = (user?.['cognito:groups'] ?? []) as string[];
    const visibilities = visibilitiesFor(groups);

    // PR E.2 federation filter:
    //   - source=local      → only local rows (default; backwards-compat with PRs C/D)
    //   - source=federated  → only RemoteDataset mirrors (no cursor — list is bounded
    //                          by `limit` per call; pagination across the merged set
    //                          arrives in a follow-up if scale demands it)
    //   - source=all        → local first (with cursor), then federated to fill the
    //                          remaining slots up to `limit`. The cursor still keys
    //                          on the local table so pages stay deterministic; once
    //                          locals run out, federated rows are appended in
    //                          harvested-at order.
    if (query.source === 'federated') {
      const { rows, totalEstimate } = await this.repo.searchFederated({
        q: query.q,
        limit: query.limit,
      });
      return {
        items: rows,
        nextCursor: null,
        totalEstimate,
        page: null,
        pageSize: null,
        totalPages: null,
      };
    }

    // Cursor wins when both `cursor` and `page` are present — older
    // clients shouldn't have their cursor flow disrupted. Page-mode is
    // for the new web UI (PR L.1).
    const usePage = query.page !== undefined && !query.cursor;
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    const offset = usePage ? Math.max(0, ((query.page ?? 1) - 1) * query.limit) : undefined;

    // Normalise repeated facet values (Zod accepts string OR string[]).
    const toArray = (v: string | string[] | undefined): string[] | undefined =>
      v === undefined ? undefined : Array.isArray(v) ? v : [v];

    const { rows: localRows, totalEstimate: localTotal } = await this.repo.search({
      q: query.q,
      visibilities,
      statuses: query.status ? [query.status] : undefined,
      hostId: query.hostId,
      after,
      modality: toArray(query.modality),
      bodyRegion: toArray(query.bodyRegion),
      condition: toArray(query.condition),
      anonymizationLevel: query.anonymizationLevel,
      license: toArray(query.license),
      duoTerms: toArray(query.duoTerms),
      commercialUseTerms: query.commercialUseTerms,
      sort: query.sort,
      offset,
      limit: usePage ? query.limit : query.limit + 1, // cursor mode peeks 1 extra
    });

    let nextCursor: string | null = null;
    let items = localRows;
    if (!usePage && localRows.length > query.limit) {
      items = localRows.slice(0, query.limit);
      const last = items[items.length - 1]!;
      nextCursor = encodeCursor({ updatedAt: new Date(last.updatedAt), id: last.id });
    }

    if (
      query.source === 'all' &&
      ((usePage && items.length < query.limit) ||
        (!usePage && nextCursor === null && items.length < query.limit))
    ) {
      const fedSlots = query.limit - items.length;
      const { rows: fedRows, totalEstimate: fedTotal } = await this.repo.searchFederated({
        q: query.q,
        limit: fedSlots,
      });
      const mergedTotal = localTotal + fedTotal;
      return {
        items: [...items, ...fedRows],
        nextCursor: null,
        totalEstimate: mergedTotal,
        page: usePage ? (query.page ?? 1) : null,
        pageSize: usePage ? query.limit : null,
        totalPages: usePage ? Math.max(1, Math.ceil(mergedTotal / query.limit)) : null,
      };
    }

    return {
      items,
      nextCursor,
      totalEstimate: localTotal,
      page: usePage ? (query.page ?? 1) : null,
      pageSize: usePage ? query.limit : null,
      totalPages: usePage ? Math.max(1, Math.ceil(localTotal / query.limit)) : null,
    };
  }

  async detail(slug: DatasetSlug, user?: CognitoAccessTokenPayload): Promise<DatasetDetail> {
    const ds = await this.repo.findBySlug(slug);
    if (!ds) throw new NotFoundException(`dataset "${slug}" not found`);

    const groups = (user?.['cognito:groups'] ?? []) as string[];

    // Hosts can always read their own datasets at any visibility/status
    // (they need this to load the publish workflow on a fresh DRAFT
    // they just created). The intent was already documented in the
    // class header; the logic was missing. The repository's findBySlug
    // doesn't surface hostId on the public DTO, so resolve ownership
    // via a separate id+host lookup — same helper publishVersion uses.
    let ownsRow = false;
    if (user?.sub && groups.includes('host')) {
      const owner = await this.repo.findIdAndHostBySlug(slug);
      ownsRow = owner !== null && owner.hostId === cognitoSubAsUuid(user.sub);
    }

    if (!ownsRow && !canSee(ds.visibility, ds.status, groups)) {
      throw new NotFoundException(`dataset "${slug}" not found`); // do not leak existence
    }
    return ds;
  }

  /** Returns the manifest as a plain JSON object (not nested in DatasetDetail). */
  async manifest(slug: DatasetSlug, user?: CognitoAccessTokenPayload): Promise<unknown> {
    const ds = await this.detail(slug, user);
    if (!ds.croissant) {
      throw new NotFoundException(`dataset "${slug}" has no published manifest yet`);
    }
    return ds.croissant;
  }

  async create(req: CreateDatasetRequest, user: CognitoAccessTokenPayload): Promise<DatasetDetail> {
    // Caller authz is already guaranteed by RolesGuard('host'); we just
    // need the user's identity record id. For PR B we use the Cognito
    // sub directly; the User table will be populated by a Phase B follow-up
    // (post-confirmation Cognito hook) and we'll switch to the local id.
    const hostId = cognitoSubAsUuid(user.sub);

    try {
      await this.repo.create({
        slug: req.slug,
        name: req.name,
        description: req.description ?? null,
        hostId,
        visibility: req.visibility,
        commercialUseTerms: req.commercialUseTerms,
        commercialClauses: req.commercialClauses ?? null,
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException(`slug "${req.slug}" is already taken`);
      }
      throw err;
    }
    const ds = await this.repo.findBySlug(req.slug);
    if (!ds) throw new Error('inconsistent state — created dataset not found');
    return ds;
  }

  async publishVersion(
    slug: DatasetSlug,
    req: PublishDatasetVersionRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<DatasetDetail> {
    const target = await this.repo.findIdAndHostBySlug(slug);
    if (!target) throw new NotFoundException(`dataset "${slug}" not found`);

    const groups = (user['cognito:groups'] ?? []) as string[];
    const userId = cognitoSubAsUuid(user.sub);
    const isHost = groups.includes('host') && target.hostId === userId;
    const isAdmin = groups.includes('admin');
    if (!isHost && !isAdmin) {
      throw new ForbiddenException('only the dataset host or an admin can publish a version');
    }

    // Validate the manifest BEFORE writing.
    const result = validateCroissant(req.croissant);
    if (!result.ok) {
      throw new BadRequestException({
        message: 'Croissant manifest validation failed',
        conformance: result.conformance,
        issues: result.issues,
      });
    }

    const conformanceVersion =
      result.conformance === 'croissant-1.1'
        ? '1.1'
        : result.conformance === 'croissant-1.0'
          ? '1.0'
          : 'unknown';

    const distributions = extractDistributions(req.croissant);
    // For each platform-hosted contentUrl, look up the upstream
    // Distribution and inherit its S3 location. The gated download path
    // refuses EXTERNAL rows (correctly — it has nothing to sign), so
    // without this adoption a host who uploads + republishes ends up
    // with a manifest that points at a 400-ing endpoint.
    await this.adoptPlatformHostedDistributions(target.id, distributions);

    // DUO permission terms (PR J.1, #93). Extract from the manifest's
    // `consentCode` and persist on the Dataset row for fast read on
    // the detail page + the access-request matcher. Manifest stays
    // the source of truth — re-publishing rewrites the column.
    const duoTerms = extractDuoTerms(req.croissant);

    // Fail closed for non-PUBLIC datasets without DUO terms (decision
    // #2 in the J.1 design). RESTRICTED + PRIVATE need a declared use
    // policy because access requests for them go through the matcher;
    // PUBLIC can ship without one (open data, anyone in).
    if (target.visibility !== 'PUBLIC' && duoTerms.length === 0) {
      throw new BadRequestException({
        message:
          'Manifest must declare at least one DUO consent code (consentCode) for non-PUBLIC datasets. See https://www.ga4gh.org/product/data-use-ontology-duo/',
        conformance: result.conformance,
        issues: [
          {
            path: '/consentCode',
            level: 'error',
            code: 'oci.j1.duo.missing-on-non-public',
            message:
              'No DUO consent codes detected. Add at least one DefinedTerm referencing a DUO id (e.g. DUO_0000042 General research use, DUO_0000046 Non-commercial use only).',
          },
        ],
      });
    }

    const croissantHash = sha256OfJson(req.croissant);

    try {
      await this.repo.publishVersion({
        datasetId: target.id,
        version: req.version,
        croissant: req.croissant,
        croissantHash,
        notes: req.notes ?? null,
        publishedById: userId,
        conformanceVersion,
        distributions,
        duoTerms,
      });
    } catch (err: unknown) {
      // Unique constraint on (dataset_id, version) — re-publishing the
      // same version. Map to 409 so the seed/CLI gets a clear signal
      // ("bump --version") instead of a generic 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          `version "${req.version}" already exists for dataset "${slug}"`,
        );
      }
      throw err;
    }

    const ds = await this.repo.findBySlug(slug);
    if (!ds) throw new Error('inconsistent state — published dataset not found');
    return ds;
  }

  /**
   * For each entry whose `contentUrl` points at our gated-download
   * route, look up the source Distribution and copy its S3 location
   * onto the entry. Mutates `distributions` in place. Cross-dataset
   * references are intentionally allowed by ID match alone — the
   * caller must already be the host of the destination dataset
   * (publishVersion gates that), and the source row's own visibility
   * is enforced at download time, not at publish time.
   */
  private async adoptPlatformHostedDistributions(
    datasetId: string,
    distributions: ExtractedDistribution[],
  ): Promise<void> {
    const ids = distributions
      .map((d) => (d.contentUrl ? (PLATFORM_HOSTED_URL.exec(d.contentUrl)?.[1] ?? null) : null))
      .filter((id): id is string => id !== null);
    if (ids.length === 0) return;

    const rows = await this.repo.findDistributionsForAdoption(ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const d of distributions) {
      if (!d.contentUrl) continue;
      const m = PLATFORM_HOSTED_URL.exec(d.contentUrl);
      if (!m) continue;
      const src = byId.get(m[1]!);
      // If the upload completed cleanly we adopt; otherwise leave the
      // row as EXTERNAL so the host gets a clear "no bytes" signal at
      // download time rather than a half-broken download. Same dataset
      // requirement is a guardrail — adoption shouldn't make a host
      // siphon another host's bytes.
      if (!src || src.uploadStatus !== 'READY' || src.datasetId !== datasetId) continue;
      d.storageBackend = 'S3';
      d.s3Bucket = src.s3Bucket;
      d.s3Key = src.s3Key;
      d.uploadStatus = 'READY';
      // Carry through size/hash from the upload — the manifest may omit
      // them and the platform already knows the truth.
      if (d.contentSizeBytes == null && src.contentSizeBytes != null) {
        d.contentSizeBytes = Number(src.contentSizeBytes);
      }
      if (d.contentHash == null && src.contentHash != null) {
        d.contentHash = src.contentHash;
      }
    }
  }

  /**
   * Outbound Croissant catalog — `GET /v2/catalog/.well-known/croissant-catalog.json`.
   * Lists every PUBLIC + PUBLISHED dataset's latest version as a thin
   * JSON-LD index that other Croissant catalogues (HuggingFace, OpenML,
   * future GI-AI4H members) can harvest with one fetch.
   */
  async federationIndex(baseUrl: string): Promise<{
    '@context': string;
    '@type': string;
    name: string;
    description: string;
    dataset: Array<{
      '@type': 'sc:Dataset';
      '@id': string;
      name: string;
      url: string;
      description: string | null;
      version: string | null;
    }>;
  }> {
    const datasets = await this.repo.listPublicForFederation();
    return {
      '@context': 'https://schema.org/',
      '@type': 'sc:DataCatalog',
      name: 'OCI Platform Catalog',
      description:
        'Public Croissant-conformant datasets curated under the ITU-WHO-WIPO Global Initiative on AI for Health (GI-AI4H).',
      dataset: datasets.map((d) => ({
        '@type': 'sc:Dataset' as const,
        '@id': `${baseUrl}/v2/catalog/datasets/${d.slug}`,
        name: d.name,
        url: `${baseUrl}/catalog/${d.slug}`,
        description: d.description,
        version: d.versions[0]?.version ?? null,
      })),
    };
  }
}

// ----- helpers -------------------------------------------------------------

function visibilitiesFor(groups: string[]): Array<'PRIVATE' | 'RESTRICTED' | 'PUBLIC'> {
  if (groups.includes('admin') || groups.includes('regulator') || groups.includes('supervisor')) {
    return ['PRIVATE', 'RESTRICTED', 'PUBLIC'];
  }
  if (groups.length > 0) return ['RESTRICTED', 'PUBLIC'];
  return ['PUBLIC'];
}

function canSee(
  visibility: 'PRIVATE' | 'RESTRICTED' | 'PUBLIC',
  status: string,
  groups: string[],
): boolean {
  if (groups.includes('admin') || groups.includes('regulator') || groups.includes('supervisor')) {
    return true;
  }
  if (status !== 'PUBLISHED') return false;
  if (visibility === 'PUBLIC') return true;
  if (visibility === 'RESTRICTED' && groups.length > 0) return true;
  return false;
}

interface CursorPayload {
  updatedAt: Date;
  id: string;
}

function encodeCursor(c: CursorPayload): string {
  const json = JSON.stringify({ u: c.updatedAt.toISOString(), i: c.id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { u?: string; i?: string };
    if (typeof parsed.u !== 'string' || typeof parsed.i !== 'string') {
      throw new Error('malformed');
    }
    return { updatedAt: new Date(parsed.u), id: parsed.i };
  } catch {
    throw new BadRequestException('invalid cursor');
  }
}

interface ExtractedDistribution {
  croissantId: string;
  contentUrl: string | null;
  contentType: string;
  contentSizeBytes: number | null;
  contentHash: string | null;
  requiresAccess: boolean;
  /**
   * If the manifest's `contentUrl` references a platform-hosted file
   * (i.e. `/v2/catalog/datasets/:slug/distributions/:id/download`), the
   * service resolves it to the underlying S3 location and stamps these
   * fields on the new Distribution row. Without this, republishing
   * with the URL the uploader handed back creates an EXTERNAL row that
   * the gated-download path refuses (PR I, #87).
   */
  storageBackend?: 'EXTERNAL' | 'S3' | 'EXTERNAL_S3';
  s3Bucket?: string | null;
  s3Key?: string | null;
  uploadStatus?: 'PENDING' | 'READY' | 'FAILED' | null;
}

/** Matches `/v2/catalog/datasets/<slug>/distributions/<uuid>/download`. */
const PLATFORM_HOSTED_URL =
  /^\/v2\/catalog\/datasets\/[a-z0-9][a-z0-9-]*\/distributions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/download$/;

/**
 * Walk the Croissant manifest's `distribution[]` array (FileObject and
 * FileSet entries) and produce DB rows. We rely on the validator having
 * already passed; here we just translate the JSON-LD shape into our
 * row shape. Both `sc:`-prefixed and bare-key forms are handled because
 * the manifest stored in the DB is the original (unnormalized) input —
 * authoring tools may produce either.
 */
function extractDistributions(croissant: unknown): ExtractedDistribution[] {
  if (!croissant || typeof croissant !== 'object') return [];
  const m = croissant as Record<string, unknown>;
  const dist = (m.distribution ?? m['sc:distribution']) as unknown[] | undefined;
  if (!Array.isArray(dist)) return [];

  const out: ExtractedDistribution[] = [];
  for (const entry of dist) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const id = (e['@id'] ?? '') as string;
    if (!id) continue;
    const contentUrl = (e.contentUrl ?? e['sc:contentUrl'] ?? null) as string | null;
    const contentType = (e.encodingFormat ??
      e['sc:encodingFormat'] ??
      'application/octet-stream') as string;
    const sizeRaw = (e.contentSize ?? e['sc:contentSize'] ?? null) as string | number | null;
    const contentSizeBytes =
      typeof sizeRaw === 'number'
        ? sizeRaw
        : typeof sizeRaw === 'string' && /^\d+$/.test(sizeRaw)
          ? Number(sizeRaw)
          : null;
    const contentHash = (e.sha256 ?? e['sc:sha256'] ?? null) as string | null;
    out.push({
      croissantId: id,
      contentUrl,
      contentType,
      contentSizeBytes,
      contentHash,
      // `requiresAccess` is a platform overlay — defaults false here, set
      // separately by the host via PR C's distribution-management
      // endpoints.
      requiresAccess: false,
    });
  }
  return out;
}

function sha256OfJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

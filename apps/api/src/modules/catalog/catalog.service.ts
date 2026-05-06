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
import { validate as validateCroissant } from '@oci/croissant';
import type {
  CreateDatasetRequest,
  DatasetDetail,
  DatasetSlug,
  ListDatasetsQuery,
  ListDatasetsResponse,
  PublishDatasetVersionRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
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

  async list(
    query: ListDatasetsQuery,
    user?: CognitoAccessTokenPayload,
  ): Promise<ListDatasetsResponse> {
    const groups = (user?.['cognito:groups'] ?? []) as string[];
    const visibilities = visibilitiesFor(groups);

    const after = query.cursor ? decodeCursor(query.cursor) : undefined;

    const { rows, totalEstimate } = await this.repo.search({
      q: query.q,
      visibilities,
      statuses: query.status ? [query.status] : undefined,
      hostId: query.hostId,
      after,
      limit: query.limit + 1, // fetch one extra to know if there's another page
    });

    let nextCursor: string | null = null;
    let items = rows;
    if (rows.length > query.limit) {
      items = rows.slice(0, query.limit);
      const last = items[items.length - 1]!;
      nextCursor = encodeCursor({ updatedAt: new Date(last.updatedAt), id: last.id });
    }

    return { items, nextCursor, totalEstimate };
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

/**
 * Map a Cognito `sub` to a local UUID used as `identity.users.id`.
 *
 * In production Cognito subs ARE UUIDs, so we pass them through. In
 * local dev (and any other environment that exposes a non-UUID sub —
 * federated IdPs, dev stubs) we derive a deterministic UUIDv5 from
 * the sub via SHA-1 + a fixed namespace. The result is stable across
 * requests and across processes, so two host actions from the same
 * principal converge on the same row.
 *
 * Phase B follow-up: once a post-confirmation Cognito Lambda
 * populates `identity.users (cognito_id, …)`, swap this for a real
 * lookup against that table. The deterministic-UUID derivation stays
 * useful for the upsert key.
 */
const SUB_NAMESPACE_UUID = 'a4f1c8b2-7d3e-5b9c-9f0a-3c8d4e5f6a7b';

function cognitoSubAsUuid(sub: string): string {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(sub)) {
    return sub.toLowerCase();
  }
  return uuidV5(sub, SUB_NAMESPACE_UUID);
}

/**
 * RFC 4122 §4.3 name-based UUID (v5, SHA-1). Tiny inline impl so we
 * don't pull in the `uuid` package just for this one call.
 *
 * Steps:
 *   1. Concatenate the namespace bytes (16) and the name bytes.
 *   2. SHA-1 the concatenation.
 *   3. Take the first 16 bytes; set the version (5) and variant
 *      (RFC 4122) bits per the spec.
 *   4. Format as 8-4-4-4-12 hex.
 */
function uuidV5(name: string, namespace: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(Buffer.from(name, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  // RFC 4122 v5: set bits 12–15 of time_hi_and_version to 0101.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  // Variant: set bits 6–7 of clock_seq_hi_and_reserved to 10.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

interface ExtractedDistribution {
  croissantId: string;
  contentUrl: string | null;
  contentType: string;
  contentSizeBytes: number | null;
  contentHash: string | null;
  requiresAccess: boolean;
}

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

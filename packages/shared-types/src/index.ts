import { z } from 'zod';

// ==== Identity ============================================================

export const RoleSchema = z.enum([
  'admin',
  'host',
  'participant',
  'annotator',
  'reviewer',
  'supervisor',
  'regulator',
]);
export type Role = z.infer<typeof RoleSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  cognitoId: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  roles: z.array(RoleSchema),
});
export type User = z.infer<typeof UserSchema>;

// ==== Catalog (DAP package, WS-1) =========================================
//
// Public-facing DTOs. The full Croissant manifest lives at
// `Dataset.croissant` as schema-checked JSON-LD; everything else here is
// derived for fast list/detail rendering. The API and web both type
// against these schemas (Zod parse on the API, type-only on web — no
// runtime cost in the Next.js bundle).

export const DatasetVisibilitySchema = z.enum(['PRIVATE', 'RESTRICTED', 'PUBLIC']);
export type DatasetVisibility = z.infer<typeof DatasetVisibilitySchema>;

export const DatasetStatusSchema = z.enum(['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED']);
export type DatasetStatus = z.infer<typeof DatasetStatusSchema>;

/**
 * Slug rules: lower-case alphanumerics, hyphens; 3–80 chars; no leading
 * or trailing hyphen, no consecutive hyphens. Identical to the rule
 * NPM applies to package names so URLs share that ergonomic shape.
 */
export const DatasetSlugSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(
    /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9]))*$/,
    'slug must be lower-case alphanumerics with single hyphens, 3-80 chars',
  );
export type DatasetSlug = z.infer<typeof DatasetSlugSchema>;

/**
 * Compact reference to the peer catalogue a federated row was
 * harvested from. Null on locally-published rows. Drives the
 * "From <peer>" attribution badge on `/catalog` cards (PR E.2).
 */
export const SourceCatalogRefSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
});
export type SourceCatalogRef = z.infer<typeof SourceCatalogRefSchema>;

/** Summary row returned in list / search responses. Cheap to render. */
export const DatasetSummarySchema = z.object({
  id: z.string().uuid(),
  slug: DatasetSlugSchema,
  name: z.string(),
  description: z.string().nullable(),
  visibility: DatasetVisibilitySchema,
  status: DatasetStatusSchema,
  conformanceVersion: z.string().nullable(),
  /** Latest version string (e.g. "1.0.0"). Null when no version published. */
  latestVersion: z.string().nullable(),
  createdAt: z.string(), // ISO 8601
  updatedAt: z.string(),
  /**
   * Peer catalogue this row was harvested from. Null for
   * locally-published rows. Federated rows are always PUBLIC +
   * PUBLISHED (we only mirror what peers expose publicly).
   */
  sourceCatalog: SourceCatalogRefSchema.nullable().default(null),
  /**
   * The peer's `@id` for this dataset. Null for local rows. The web
   * UI uses this to deep-link the card to the upstream host since
   * federated rows aren't addressable as `/catalog/<slug>` (slugs
   * may collide across peers).
   */
  originUrl: z.string().nullable().default(null),
});
export type DatasetSummary = z.infer<typeof DatasetSummarySchema>;

/** Distribution shape mirrored from the Croissant manifest for direct rendering. */
export const DistributionSchema = z.object({
  id: z.string().uuid(),
  croissantId: z.string(),
  contentUrl: z.string().nullable(),
  contentType: z.string(),
  contentSizeBytes: z.number().int().nullable(),
  contentHash: z.string().nullable(),
  requiresAccess: z.boolean(),
});
export type Distribution = z.infer<typeof DistributionSchema>;

export const DatasetVersionSchema = z.object({
  id: z.string().uuid(),
  version: z.string(),
  croissantHash: z.string().nullable(),
  notes: z.string().nullable(),
  publishedAt: z.string(),
});
export type DatasetVersion = z.infer<typeof DatasetVersionSchema>;

/** Full detail returned by `GET /v2/catalog/datasets/:slug`. */
export const DatasetDetailSchema = DatasetSummarySchema.extend({
  croissant: z.unknown().nullable(),
  versions: z.array(DatasetVersionSchema),
  distributions: z.array(DistributionSchema),
});
export type DatasetDetail = z.infer<typeof DatasetDetailSchema>;

/**
 * Source filter for `GET /v2/catalog/datasets?source=…`.
 *
 *   - `local`     (default): rows published on this platform.
 *   - `federated`: rows harvested from peer catalogues
 *                  (RemoteDataset). Empty until PR E.3's worker runs.
 *   - `all`:       union of both, sorted by their respective
 *                  `updatedAt` / `harvestedAt`.
 *
 * Default is `local` for backwards-compat with PRs C/D — clients that
 * don't pass `source` see the same shape they did before. Federated
 * rows are PUBLIC + PUBLISHED only (the worker only mirrors public
 * datasets), so visibility/status filters interact additively.
 */
export const DatasetSourceSchema = z.enum(['local', 'federated', 'all']);
export type DatasetSource = z.infer<typeof DatasetSourceSchema>;

/** Query params for `GET /v2/catalog/datasets`. */
export const ListDatasetsQuerySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  visibility: DatasetVisibilitySchema.optional(),
  status: DatasetStatusSchema.optional(),
  hostId: z.string().uuid().optional(),
  source: DatasetSourceSchema.default('local'),
  /** Cursor: opaque base64 of the prior page's last `(updatedAt, id)`. */
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListDatasetsQuery = z.infer<typeof ListDatasetsQuerySchema>;

export const ListDatasetsResponseSchema = z.object({
  items: z.array(DatasetSummarySchema),
  /** Opaque cursor; absent when no more pages. */
  nextCursor: z.string().nullable(),
  /** Total matches (best-effort; may be approximate at scale — Phase E). */
  totalEstimate: z.number().int(),
});
export type ListDatasetsResponse = z.infer<typeof ListDatasetsResponseSchema>;

/** `POST /v2/catalog/datasets` — host create. */
export const CreateDatasetRequestSchema = z.object({
  slug: DatasetSlugSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  visibility: DatasetVisibilitySchema.default('PRIVATE'),
});
export type CreateDatasetRequest = z.infer<typeof CreateDatasetRequestSchema>;

/** `POST /v2/catalog/datasets/:slug/versions` — host publishes a Croissant manifest. */
export const PublishDatasetVersionRequestSchema = z.object({
  version: z
    .string()
    .min(1)
    .max(40)
    // The pre-release/build suffix `(?:[-+][\w.-]+)?` is anchored,
    // length-capped (z.string().max(40) above), and uses linear-time
    // character classes only — not ReDoS-prone in practice. The eslint
    // security plugin flags any optional repeated group as "unsafe".
    // eslint-disable-next-line security/detect-unsafe-regex
    .regex(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, 'expected semver MAJOR.MINOR.PATCH'),
  croissant: z.unknown(), // validated by @oci/croissant before persisting
  notes: z.string().max(4000).nullable().optional(),
});
export type PublishDatasetVersionRequest = z.infer<typeof PublishDatasetVersionRequestSchema>;

// ==== Catalog federation (DAP package, Phase E down-payment) =============
//
// `RemoteCatalog` rows configure peer Croissant catalogues we harvest
// from. The harvester (apps/worker-ingest, Phase E) iterates over the
// rows here, fetches each peer's `.well-known/croissant-catalog.json`,
// and upserts the dataset rows it finds into a `RemoteDataset` table
// (added in PR E.2 alongside the source-filter on /v2/catalog/datasets).
//
// PR E.1 ships only the admin surface for managing the rows; no
// harvest activity yet — `lastHarvestedAt` will stay null until the
// worker lands. Treat the model as the seed for federation, not the
// federation itself.

/**
 * URL-safe identifier for a remote catalog (e.g. "huggingface",
 * "openml", "gi-ai4h-thailand"). Same shape rules as DatasetSlug for
 * URL ergonomics.
 */
export const RemoteCatalogSlugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(
    /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9]))*$/,
    'slug must be lower-case alphanumerics with single hyphens, 2-64 chars',
  );
export type RemoteCatalogSlug = z.infer<typeof RemoteCatalogSlugSchema>;

/**
 * Status of the harvest job for a remote catalog. PR E.1 only writes
 * `IDLE` (set on insert); PR E.3's worker will transition through the
 * other states.
 */
export const HarvestStatusSchema = z.enum(['IDLE', 'RUNNING', 'SUCCEEDED', 'FAILED']);
export type HarvestStatus = z.infer<typeof HarvestStatusSchema>;

/** Summary row returned in list responses. */
export interface RemoteCatalogSummary {
  id: string;
  slug: RemoteCatalogSlug;
  name: string;
  endpointUrl: string;
  description: string | null;
  harvestStatus: HarvestStatus;
  /** ISO 8601; null until the worker has run at least once. */
  lastHarvestedAt: string | null;
  /** Last error message from a FAILED run; null otherwise. */
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Detail returned by `GET /v2/catalog/remotes/:id`. Same shape as the summary
 * for now; future iterations may add harvested-row counts etc. */
export type RemoteCatalogDetail = RemoteCatalogSummary;

export const ListRemoteCatalogsResponseSchema = z.object({
  items: z.array(z.unknown()), // shape pinned at the API layer; here we just
  totalEstimate: z.number().int(), // need the response envelope.
});

/** `POST /v2/catalog/remotes` — admin registers a peer. */
export const CreateRemoteCatalogRequestSchema = z.object({
  slug: RemoteCatalogSlugSchema,
  name: z.string().min(1).max(120),
  /**
   * Base URL of the peer's Croissant catalog endpoint. The harvester
   * will GET `<endpointUrl>/.well-known/croissant-catalog.json` to
   * enumerate its datasets. Must be https in non-local env (enforced
   * at the API; the schema only checks URL syntax).
   */
  endpointUrl: z
    .string()
    .url()
    .max(500)
    .refine((u) => /^https?:\/\//i.test(u), { message: 'endpointUrl must be http(s)' }),
  description: z.string().max(2000).nullable().optional(),
});
export type CreateRemoteCatalogRequest = z.infer<typeof CreateRemoteCatalogRequestSchema>;

export const tokens = {
  /** Phase B will add: Campaign, Task, Sample, Annotation, AnnotationTool */
  /** Phase C will add: Challenge, Submission, Phase, Leaderboard */
  /** Phase D will add: Report, ReportTemplate, AuditEvent */
  /** Phase E will add: DMXP transaction envelope, FederatedConnector */
  /** PR E.2 will add: RemoteDataset, ListDatasetsQuery.source */
};

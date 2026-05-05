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

/** Query params for `GET /v2/catalog/datasets`. */
export const ListDatasetsQuerySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  visibility: DatasetVisibilitySchema.optional(),
  status: DatasetStatusSchema.optional(),
  hostId: z.string().uuid().optional(),
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
    .regex(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, 'expected semver MAJOR.MINOR.PATCH'),
  croissant: z.unknown(), // validated by @oci/croissant before persisting
  notes: z.string().max(4000).nullable().optional(),
});
export type PublishDatasetVersionRequest = z.infer<typeof PublishDatasetVersionRequestSchema>;

export const tokens = {
  /** Phase B will add: Campaign, Task, Sample, Annotation, AnnotationTool */
  /** Phase C will add: Challenge, Submission, Phase, Leaderboard */
  /** Phase D will add: Report, ReportTemplate, AuditEvent */
  /** Phase E will add: DMXP transaction envelope, FederatedConnector */
};

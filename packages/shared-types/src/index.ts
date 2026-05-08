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

/**
 * DUO permission terms attached to a dataset (PR J.1, #93). Extracted
 * from the manifest's `cr:dataUseTerms` array on publish so the detail
 * page + the access-request matcher can read them without re-parsing
 * the manifest. Empty array for legacy rows / PUBLIC datasets that
 * declined to declare. Ids are OBO short form (`DUO_0000042`); the
 * registry in `@oci/croissant` resolves to human labels.
 */
export const DuoTermIdSchema = z.string().regex(/^DUO_\d{7}$/, 'expected DUO OBO id (DUO_NNNNNNN)');
export type DuoTermId = z.infer<typeof DuoTermIdSchema>;

/** Full detail returned by `GET /v2/catalog/datasets/:slug`. */
export const DatasetDetailSchema = DatasetSummarySchema.extend({
  croissant: z.unknown().nullable(),
  versions: z.array(DatasetVersionSchema),
  distributions: z.array(DistributionSchema),
  /** DUO permission term ids attached to the latest published manifest. */
  duoTerms: z.array(DuoTermIdSchema).default([]),
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

// ==== Self-hosted distributions / uploads (DAP, PR I, #87) ===============
//
// Multipart upload protocol (browser → our S3, mediated by the API):
//   1. POST .../uploads             → init
//   2. POST .../uploads/:id/parts/:n/url   (one per part)
//   3. POST .../uploads/:id/complete       (finalise; persists Distribution)
//   4. POST .../uploads/:id/abort          (cleanup on cancel)
//
// Browser uploads parts in parallel against the per-part presigned
// URLs; our API never sees the bytes. Resume across refresh is
// localStorage-keyed by `uploadId` + `key`. Sized for ~50 GB realistic
// browser sessions; the Tier 2 CLI tool (#88) takes the same API
// surface but runs in a stable shell.

export const InitUploadRequestSchema = z.object({
  /** File the browser is about to upload, used to derive the S3 key. */
  filename: z.string().min(1).max(500),
  /** MIME type. We don't enforce a vocabulary — Croissant manifests
   * carry whatever the host published. */
  contentType: z.string().min(1).max(200),
  /** Total size in bytes, claimed by the browser. Used to compute
   * `partSize` so that part count stays under the S3 10 000 cap. */
  contentSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(5 * 1024 ** 4), // 5 TB cap (S3 single-object limit)
  /** Optional SHA-256, hex. Persisted as `Distribution.contentHash`
   * verbatim; the platform doesn't re-verify in PR I (a full read at
   * petabyte scale is cost-prohibitive). */
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lowercase hex characters')
    .optional(),
});
export type InitUploadRequest = z.infer<typeof InitUploadRequestSchema>;

export interface InitUploadResponse {
  uploadId: string;
  /** S3 object key the browser will eventually find at `s3://<bucket>/<key>`. */
  key: string;
  /** Part size in bytes the browser should chunk to. Always a power-of-2-ish
   * multiple of MB; the API picks it so that totalParts < 10 000. */
  partSize: number;
}

export interface PartUrlResponse {
  url: string;
  /** ISO 8601 — browsers should request a fresh URL if this slips. */
  expiresAt: string;
}

export const CompleteUploadRequestSchema = z.object({
  /**
   * Parts the browser successfully uploaded, in order. The S3 ETag
   * is what `PUT` returned for each part — strip the surrounding
   * double-quotes the SDK doesn't strip for you.
   */
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10000),
        etag: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(10000),
  /** Optional manifest hint: `croissantId` to use for the resulting
   * Distribution row. Defaults to `<filename>` when omitted. */
  croissantId: z.string().max(500).optional(),
});
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequestSchema>;

/**
 * Returned by complete + by the upload-list endpoint. The host pastes
 * `contentUrl` into the Croissant manifest's `distribution[]`; the
 * platform serves it via the gated download path, never the raw S3
 * URI.
 */
export interface UploadedDistribution {
  distributionId: string;
  /** Display name (filename). */
  name: string;
  /** Same value the host should use as `contentUrl` in the manifest —
   * a path on this site, not an S3 URL. */
  contentUrl: string;
  contentType: string;
  contentSizeBytes: number;
  sha256: string | null;
  uploadedAt: string;
}

// ==== Access requests (DAP package, Phase B) ============================
//
// Participants request access to RESTRICTED datasets; dataset hosts (or
// admins) approve/deny. The Prisma `AccessRequest` model has lived in
// `packages/database` since PR A — PR F (this slice) wires the HTTP +
// UI surfaces. The actual S3 pre-signed URL minting on approval is a
// separate follow-up; PR F lands the request lifecycle.

export const AccessRequestStatusSchema = z.enum(['PENDING', 'APPROVED', 'DENIED', 'REVOKED']);
export type AccessRequestStatus = z.infer<typeof AccessRequestStatusSchema>;

/**
 * Result of automatically matching the requester's intended use
 * against the dataset's DUO permission terms (PR J.1, #93). Persisted
 * on `AccessRequest.matchStatus`; surfaced as a badge in the host
 * inbox so the host can prioritise quick-decisions on `MATCHED` and
 * scrutiny on `CONFLICT`.
 *
 *   - `MATCHED`   — every requester-declared use is permitted by the
 *                   dataset's terms; no formal-agreement modifier
 *                   blocks approval.
 *   - `CONFLICT`  — the matcher found at least one conflict (e.g.
 *                   commercial intent on a NCU dataset, no IRB on
 *                   IRB-required dataset). Should be denied unless
 *                   the host has out-of-band reason to override.
 *   - `UNCLEAR`   — terms don't cleanly match (e.g. dataset has
 *                   `RTN` modifier requiring a DUA, or one of the
 *                   terms isn't in our registry yet). Host reads the
 *                   structured fields and decides manually.
 */
export const AccessRequestMatchStatusSchema = z.enum(['MATCHED', 'CONFLICT', 'UNCLEAR']);
export type AccessRequestMatchStatus = z.infer<typeof AccessRequestMatchStatusSchema>;

/**
 * What the requester intends to do with the data. The matcher reduces
 * this to one of `commercial / non-commercial / clinical-care` and
 * checks it against the dataset's DUO permission terms.
 */
export const IntendedUseCategorySchema = z.enum([
  'NON_COMMERCIAL_RESEARCH',
  'COMMERCIAL_RESEARCH',
  'CLINICAL_CARE',
  'EDUCATION',
]);
export type IntendedUseCategory = z.infer<typeof IntendedUseCategorySchema>;

/** What gets done with derived outputs. Drives `RTN`/`PUB`-related modifiers. */
export const RedistributionIntentSchema = z.enum(['NONE', 'DERIVATIVES_ONLY', 'WITH_PERMISSION']);
export type RedistributionIntent = z.infer<typeof RedistributionIntentSchema>;

export const OutputTypeSchema = z.enum([
  'PUBLICATION',
  'MODEL_WEIGHTS',
  'DERIVATIVE_DATASET',
  'INTERNAL_USE',
]);
export type OutputType = z.infer<typeof OutputTypeSchema>;

/**
 * Structured intended-use payload submitted by the requester. Stored
 * verbatim in `AccessRequest.attestations` (Json column); the matcher
 * + the host inbox both read from this typed shape.
 *
 * Replaces the v0 free-text justification + ad-hoc DUO IRI list. Old
 * rows persisted with the v0 shape are read with a permissive parser
 * in the API; the form always writes v1.
 */
export const AccessRequestAttestationsSchema = z.object({
  /** Schema version marker — bump when adding required fields. */
  v: z.literal(1).default(1),
  /** Short project title; 5–200 chars, displayed in the host inbox. */
  projectTitle: z.string().min(5).max(200),
  /** Detailed project description; 50–4000 chars. */
  projectDescription: z.string().min(50).max(4000),
  /** Affiliated institution / company. Free-form; not auto-validated. */
  institution: z.string().min(2).max(200),
  /** Primary intended use bucket. */
  intendedUseCategory: IntendedUseCategorySchema,
  /**
   * DUO term ids the requester claims their use is consistent with.
   * Empty array is OK at the form layer (the matcher will then mark
   * the request UNCLEAR), but the form encourages at least one.
   */
  intendedUseDuoTerms: z.array(DuoTermIdSchema).max(20).default([]),
  /** IRB / ethics committee approval status. */
  irbApproved: z.boolean(),
  /** Free-text reference to the IRB approval — number or URL. */
  irbApprovalRef: z.string().max(500).nullable().optional(),
  /** Optional DPIA reference. */
  dpiaRef: z.string().max(500).nullable().optional(),
  /** Retention window in days; capped at 10 years. */
  dataRetentionDays: z.number().int().min(1).max(3650),
  /** Will the requester redistribute derivatives? */
  redistributionIntent: RedistributionIntentSchema,
  /** What kind of output the project will produce. */
  outputType: OutputTypeSchema,
});
export type AccessRequestAttestations = z.infer<typeof AccessRequestAttestationsSchema>;

/**
 * Public-facing summary of an `AccessRequest`. Used in both the
 * requester's "my requests" list and the host's inbox; the two
 * pages render the same shape with different action affordances.
 */
export interface AccessRequestSummary {
  id: string;
  /**
   * Snapshot of the dataset metadata at request time. `duoTerms` are
   * the dataset's DUO permission terms at the moment the request was
   * created — captured here so the host inbox can reason about the
   * decision even if the host re-publishes with different terms
   * later.
   */
  dataset: { id: string; slug: DatasetSlug; name: string; duoTerms: DuoTermId[] };
  /** Requester identity — sub from Cognito (UUID-shaped). */
  requesterId: string;
  /** Optional: requester's display name (email or username). Null when not surfaced. */
  requesterDisplayName: string | null;
  /**
   * Free-text justification. Retained for backwards-compat with the
   * v0 form; v1 mirrors `attestations.projectDescription` here so
   * legacy code paths keep rendering. New consumers should read from
   * `attestations`.
   */
  justification: string;
  attestations: AccessRequestAttestations;
  status: AccessRequestStatus;
  /**
   * Result of the auto-match between requester intent + dataset DUO
   * terms (PR J.1, #93). Null on legacy rows from before the matcher
   * shipped.
   */
  matchStatus: AccessRequestMatchStatus | null;
  /**
   * Human-readable list of the matcher's findings (one entry per
   * conflict / unclear point). Empty when MATCHED. Surfaced verbatim
   * in the host inbox so a host who's not familiar with DUO can still
   * act on the request.
   */
  matchExplanations: string[];
  /** Set when status leaves PENDING. */
  decidedAt: string | null;
  /** Cognito sub of the host/admin who decided. */
  decidedById: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `POST /v2/catalog/datasets/:slug/access-requests` */
export const CreateAccessRequestRequestSchema = z.object({
  attestations: AccessRequestAttestationsSchema,
});
export type CreateAccessRequestRequest = z.infer<typeof CreateAccessRequestRequestSchema>;

/** `POST /v2/catalog/access-requests/:id/decision` */
export const AccessRequestDecisionSchema = z.object({
  /** Only host/admin-driven decisions; PENDING is not a target state here. */
  status: z.enum(['APPROVED', 'DENIED', 'REVOKED']),
  decisionNote: z.string().max(4000).nullable().optional(),
});
export type AccessRequestDecision = z.infer<typeof AccessRequestDecisionSchema>;

export interface ListAccessRequestsResponse {
  items: AccessRequestSummary[];
  totalEstimate: number;
}

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

import { z } from 'zod';
import type { EmailDomainCategory } from './email-domain.js';

export {
  classifyEmailDomain,
  safeClassifyEmailDomain,
  EmailDomainCategorySchema,
  EmailDomainAllowlistEntrySchema,
} from './email-domain.js';
export type {
  EmailDomainCategory,
  EmailDomainClassification,
  ClassifyEmailDomainOptions,
  EmailDomainAllowlistEntry,
} from './email-domain.js';

// Modality → allowed task kinds (#247). Shared between the campaign-
// create form (disables incompatible radios with a rationale tooltip)
// and the API service guard (rejects incompatible combos with 400).
export {
  MODALITY_TASK_KIND_MAP,
  allowedTaskKindsForModalities,
  canonicalizeModality,
  rationaleForDisabledTaskKind,
} from './modality-task-kinds.js';
export type { CanonicalModality } from './modality-task-kinds.js';

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
 * Access-control tier (#115, ADR-0003 Decision 1). Decoupled from
 * `visibility` (which controls who can *see* a dataset card) — `accessTier`
 * controls *what identity assurance* a viewer must demonstrate before
 * download is granted.
 *
 *   - `OPEN`        any signed-in caller; click-wrap only.
 *   - `REGISTERED`  domain-verified email (institutional/corporate);
 *                   public webmail rejected.
 *   - `CONTROLLED`  certification quiz passed (#117) + click-wrap; host
 *                   approval per-request.
 *   - `SENSITIVE`   GA4GH Passport-verified researcher status, DUA via
 *                   QES, OCI ACT review.
 *
 * Default `OPEN` so existing rows stay permissive; hosts opt up as they
 * publish more sensitive material. Tier-vs-score mismatches surface as a
 * CONFLICT explanation in the DUO matcher (PR #115).
 */
export const AccessTierSchema = z.enum(['OPEN', 'REGISTERED', 'CONTROLLED', 'SENSITIVE']);
export type AccessTier = z.infer<typeof AccessTierSchema>;

/**
 * Commercial-use terms (#119, ADR-0003 Decision 9). Source of truth for
 * the matcher's commercial-vs-NCU decision. Three bands:
 *
 *   - `OK`                  host has explicitly granted commercial use
 *                           (optionally with `commercialClauses` text).
 *                           Matcher: no commercial conflict.
 *   - `NON_COMMERCIAL_ONLY` typically paired with `DUO_0000046` (NCU)
 *                           in the manifest. Matcher: CONFLICT for any
 *                           commercial intent.
 *   - `CASE_BY_CASE`        host reviews each commercial request
 *                           bilaterally. Matcher: UNCLEAR for commercial
 *                           intent — host must judge.
 *
 * `CASE_BY_CASE` is the conservative default for newly-published
 * datasets. The migration backfills existing rows that already declare
 * NCU as `NON_COMMERCIAL_ONLY` so the matcher stays consistent across
 * the upgrade. GI-AI4H curated datasets are explicitly seeded as `OK`.
 */
export const CommercialUseTermsSchema = z.enum(['OK', 'NON_COMMERCIAL_ONLY', 'CASE_BY_CASE']);
export type CommercialUseTerms = z.infer<typeof CommercialUseTermsSchema>;

/**
 * Requester identity assurance score (#115, ADR-0003 Decision 2). Computed
 * by the API at access-request creation time from whatever the requester
 * brought (email category, ORCID link, quiz pass, GA4GH Passport visas).
 * Persisted on `AccessRequest.requesterIdentityScore` so the host inbox
 * can see "this requester demonstrated X" without recomputing.
 *
 *   - `EMAIL_ONLY`              baseline; just verified the email at signup.
 *   - `EMAIL_DOMAIN_VERIFIED`   email is in an institutional/corporate domain
 *                               (or matches the dataset's allowlist, #116).
 *   - `ORCID_LINKED`            requester linked an ORCID iD with employment
 *                               claim. (Wiring lands with #117 follow-up.)
 *   - `QUIZ_PASSED`             passed the OCI certification quiz, valid 1y
 *                               (#117).
 *   - `PI_COUNTERSIGNED`        Principal Investigator countersigned the
 *                               request (DUA-tier flow, future PR).
 *   - `PASSPORT_VERIFIED`       GA4GH Passport with verified `ResearcherStatus`
 *                               + `AffiliationAndRole` Visas (future PR).
 *
 * Order matters — `REQUESTER_IDENTITY_SCORE_RANK` reflects the strict
 * progression. Higher rank ⇒ more trust. Tier requirements use the rank.
 */
export const RequesterIdentityScoreSchema = z.enum([
  'EMAIL_ONLY',
  'EMAIL_DOMAIN_VERIFIED',
  'ORCID_LINKED',
  'QUIZ_PASSED',
  'PI_COUNTERSIGNED',
  'PASSPORT_VERIFIED',
]);
export type RequesterIdentityScore = z.infer<typeof RequesterIdentityScoreSchema>;

/** Numeric ranks for `RequesterIdentityScore`; higher is more trusted. */
export const REQUESTER_IDENTITY_SCORE_RANK: Readonly<Record<RequesterIdentityScore, number>> =
  Object.freeze({
    EMAIL_ONLY: 0,
    EMAIL_DOMAIN_VERIFIED: 1,
    ORCID_LINKED: 2,
    QUIZ_PASSED: 3,
    PI_COUNTERSIGNED: 4,
    PASSPORT_VERIFIED: 5,
  });

/**
 * Minimum identity score the platform requires for each access tier.
 * The DUO matcher (#115) compares the requester's score against this
 * map and surfaces a CONFLICT explanation when the requester is below.
 *
 * The host can still approve a CONFLICT (the matcher is advisory) — but
 * doing so is now a deliberate override against a structured warning
 * rather than an unflagged decision.
 */
export const ACCESS_TIER_MIN_SCORE: Readonly<Record<AccessTier, RequesterIdentityScore>> =
  Object.freeze({
    OPEN: 'EMAIL_ONLY',
    REGISTERED: 'EMAIL_DOMAIN_VERIFIED',
    CONTROLLED: 'QUIZ_PASSED',
    SENSITIVE: 'PASSPORT_VERIFIED',
  });

/**
 * Lightweight summary of one GA4GH Passport Visa surfaced on the
 * `RequesterIdentityContext`. Future PRs (Passport ingestion) will add
 * the full Visa shape; this stub records the type + provenance so the
 * host inbox can already render "ResearcherStatus from ELIXIR AAI".
 */
export interface GA4GHVisaSummary {
  /** Visa type (e.g. `ResearcherStatus`, `AffiliationAndRole`, `AcceptedTermsAndPolicies`). */
  type: string;
  /** Issuer URL (e.g. `https://login.elixir-czech.org/oidc/`). */
  source: string;
  /** ISO-8601 timestamp the issuer asserted at. */
  asserted: string;
}

/**
 * Affiliation evidence on the `RequesterIdentityContext`. `source`
 * records *how* we know — `self` is the requester typed it, `orcid`
 * came from a linked ORCID iD's employment record, `edugain` from an
 * eduGAIN R&S bundle, `passport` from a verified GA4GH Visa.
 */
export interface RequesterAffiliation {
  institution: string;
  role: string;
  source: 'self' | 'orcid' | 'edugain' | 'passport';
}

/**
 * Normalised requester identity bundle (#115, ADR-0003 Decision 2).
 * Computed every authorize-decision time. Heterogeneous inputs (Cognito
 * email, ORCID claim, GA4GH Visa, eduGAIN bundle) collapse into this
 * single shape so downstream policy can reason about *what we know*
 * without caring how we know it.
 *
 * For PR #115 only `identityScore` + `emailDomainCategory` are populated.
 * The rest are stubs whose populating PRs are queued (#117 quiz adds
 * `acceptedPolicies` entries; ORCID linkage and Passport ingestion fill
 * `affiliation` and `visas` in later iterations).
 */
export interface RequesterIdentityContext {
  identityScore: RequesterIdentityScore;
  /** Verified GA4GH Visas (both ingested from external IdPs and OCI-issued). Empty until Passport work lands. */
  visas: GA4GHVisaSummary[];
  /** Best-known affiliation. `null` when nothing higher than self-declared is available. */
  affiliation: RequesterAffiliation | null;
  /** Email-domain category (#116). Drives the EMAIL_DOMAIN_VERIFIED lift. */
  emailDomainCategory: EmailDomainCategory;
  /** Click-wrap policy acceptances (#118). Empty until that PR lands. */
  acceptedPolicies: { policyUrl: string; sha256: string; iat: number }[];
}

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
  /**
   * Identity assurance tier (#115). `OPEN` by default — see
   * `AccessTierSchema` for the semantics. Decoupled from `visibility`.
   */
  accessTier: AccessTierSchema.default('OPEN'),
  /**
   * Commercial-use terms (#119). The catalog list shows a small badge
   * derived from this so AI builders can scan for compatible datasets
   * at a glance. `CASE_BY_CASE` is the conservative default.
   */
  commercialUseTerms: CommercialUseTermsSchema.default('CASE_BY_CASE'),
  /**
   * Modality labels denormalised from the Croissant manifest on publish
   * (#247). Extracted from BIOCroissant's `bio:imagingModality` /
   * `bio:dataModality` / matching free-text. Empty when the host
   * hasn't declared structured modality metadata.
   *
   * Drives the campaign-create form's task-kind constraint
   * (`allowedTaskKindsForModalities`). Authoritative source remains the
   * manifest; this array is a read-cache the same way `duoTerms` is.
   */
  modalities: z.array(z.string()).default([]),
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
  /**
   * Identity of the dataset host (UUID). Surfaces here so the web side
   * can detect "viewer is the host of this dataset" and suppress
   * affordances that don't apply (PR L.1, #91 — refines the access-CTA
   * gate from PR L.3 which had to fall back to admin-only). Soft FK
   * onto `identity.users.id`.
   */
  hostId: z.string().uuid(),
  /**
   * Optional host-specified commercial-use clauses (#119). Surfaced on
   * the detail page when commercial terms need nuance (e.g. "OK with
   * royalty-free LMIC public-sector deployment"). `null` when the
   * `commercialUseTerms` band is sufficient.
   */
  commercialClauses: z.string().nullable().default(null),
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

/**
 * Sort options for the catalog list (PR L.1, #91 / search work).
 *
 * `recent` (default) — newest updates first; surface fresh content.
 * `name`            — alphabetical by dataset name.
 * `oldest`          — useful for "what's been around long enough to
 *                     have downstream work cite it?"
 */
export const ListDatasetsSortSchema = z.enum(['recent', 'name', 'oldest']);
export type ListDatasetsSort = z.infer<typeof ListDatasetsSortSchema>;

/**
 * Faceted query params for `GET /v2/catalog/datasets` (PR L.1).
 *
 * The classic `q` (full-text) is preserved. New facets ANDs with `q`
 * — a researcher can search "pneumonia" AND filter to chest x-rays
 * AND limit to non-commercial datasets. Each facet is repeatable
 * (`?modality=X-ray&modality=CT`). Empty arrays are treated as "no
 * filter" rather than "match nothing".
 *
 * **Pagination**. Two surfaces:
 *   - `?page=N` (1-indexed) — the catalog list UI uses this. Offset
 *     + total count so the user sees "page 3 of 12" and can jump.
 *   - `?cursor=…` — preserved for federation / API clients that
 *     prefer cursor-based pagination at scale. Both are accepted;
 *     `cursor` wins when both are present.
 */
export const ListDatasetsQuerySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  visibility: DatasetVisibilitySchema.optional(),
  status: DatasetStatusSchema.optional(),
  hostId: z.string().uuid().optional(),
  source: DatasetSourceSchema.default('local'),

  // Faceted filters — case-insensitive substring match against the
  // BioCroissant fields. Multiple values OR within a facet; facets AND
  // across each other.
  modality: z.union([z.string(), z.array(z.string())]).optional(),
  bodyRegion: z.union([z.string(), z.array(z.string())]).optional(),
  condition: z.union([z.string(), z.array(z.string())]).optional(),
  /**
   * Anonymisation level filter. `any` (default) drops the filter.
   */
  anonymizationLevel: z.enum(['ANONYMIZED', 'PSEUDONYMIZED', 'IDENTIFIED']).optional(),
  /**
   * License filter — substring match against `manifest.license`. The
   * web UI surfaces a small known-set picker; the API stays open
   * because real-world licence strings vary.
   */
  license: z.union([z.string(), z.array(z.string())]).optional(),
  /**
   * DUO permission term ids (PR J.1). Multi-value; ORs within. A
   * dataset matches if ANY of its `duoTerms` is in the requested set.
   */
  duoTerms: z.union([DuoTermIdSchema, z.array(DuoTermIdSchema)]).optional(),
  /**
   * Commercial-use facet (#119). Single-value enum filter — matches
   * `Dataset.commercialUseTerms`. Drives the "Commercial use" filter
   * on `/catalog` so AI builders can scan to fitting datasets.
   */
  commercialUseTerms: CommercialUseTermsSchema.optional(),

  sort: ListDatasetsSortSchema.default('recent'),

  /** 1-indexed page. Used by the web UI; the API still honours cursor. */
  page: z.coerce.number().int().min(1).max(10_000).optional(),
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
  /**
   * Page-aware fields (PR L.1, #91). Populated when the request used
   * `?page=N`. The web UI uses these to render "page X of Y" + jump.
   * `null` when the caller used cursor-based pagination instead.
   */
  page: z.number().int().nullable(),
  pageSize: z.number().int().nullable(),
  totalPages: z.number().int().nullable(),
});
export type ListDatasetsResponse = z.infer<typeof ListDatasetsResponseSchema>;

/** `POST /v2/catalog/datasets` — host create. */
export const CreateDatasetRequestSchema = z.object({
  slug: DatasetSlugSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  visibility: DatasetVisibilitySchema.default('PRIVATE'),
  /**
   * Optional commercial-use band (#119). Defaults at the DB level to
   * `CASE_BY_CASE`. Set explicitly when the host knows up-front (the
   * GI-AI4H curated-dataset seeder passes `OK`). Hosts can also adjust
   * later via the publish-page form (host-config UI lands as a
   * follow-up on top of this PR).
   */
  commercialUseTerms: CommercialUseTermsSchema.optional(),
  /** Optional commercial-clauses free-text (#119). Surfaced verbatim on the detail page. */
  commercialClauses: z.string().max(4000).nullable().optional(),
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

// ==== Manifest wizard (PR K, #90) =========================================
//
// Hosts who don't want to write JSON-LD by hand fill a stepped form; the
// platform generates a Croissant 1.1 manifest from their structured input
// and submits it through the same `PublishDatasetVersionRequest` flow as
// hand-written manifests. The wizard is the default path for new dataset
// versions; the paste-form escape hatch stays for power users with their
// own manifest tooling.
//
// `ManifestWizardInputSchema` is the wizard's contract. `@oci/croissant`
// exposes `manifestWizardInputToCroissant(input)` — a pure function that
// maps the input to the JSON-LD shape the validator accepts. The web
// side validates with this schema on each step transition; the API
// never sees the wizard payload (it sees the generated manifest).

export const ManifestCroissantConformsToSchema = z.enum([
  'http://mlcommons.org/croissant/1.1',
  'http://mlcommons.org/croissant/1.0',
]);
export type ManifestCroissantConformsTo = z.infer<typeof ManifestCroissantConformsToSchema>;

export const ManifestWizardCreatorSchema = z.object({
  type: z.enum(['Person', 'Organization']),
  name: z.string().min(1).max(200),
});
export type ManifestWizardCreator = z.infer<typeof ManifestWizardCreatorSchema>;

/**
 * Anonymisation level (BioCroissant). Mirrors the small canonical set
 * the validator recognises today; the wizard is intentionally narrower
 * than what a hand-written manifest can carry.
 */
export const ManifestWizardAnonymizationLevelSchema = z.enum([
  'ANONYMIZED',
  'PSEUDONYMIZED',
  'IDENTIFIED',
]);
export type ManifestWizardAnonymizationLevel = z.infer<
  typeof ManifestWizardAnonymizationLevelSchema
>;

/**
 * One distribution (a file) in the wizard's flat shape. The Croissant
 * builder turns this into a `sc:FileObject` with the right `@id` and
 * `contentUrl`. The host can later upload bytes via the publish page's
 * Upload card and paste the resulting platform-hosted contentUrl here.
 */
export const ManifestWizardDistributionSchema = z.object({
  /** Croissant `@id` of the FileObject. URL-safe; stable across versions when content is stable. */
  croissantId: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  /** MIME type; Croissant `encodingFormat`. */
  encodingFormat: z.string().min(1).max(200),
  /**
   * Either an upstream URL or a platform-hosted relative path
   * (`/v2/catalog/datasets/<slug>/distributions/<id>/download`). Both
   * are accepted; the catalog publish flow detects + adopts the
   * platform-hosted shape.
   */
  contentUrl: z.string().min(1).max(2000),
});
export type ManifestWizardDistribution = z.infer<typeof ManifestWizardDistributionSchema>;

/**
 * Step 1–5 + review shape. The form's React state matches this 1:1 so
 * `safeParse` on each step boundary returns issues keyed to the
 * offending field. ML semantics (RecordSets / Fields) are deliberately
 * out of scope — power users with that level of detail use the
 * paste-form escape hatch.
 */
export const ManifestWizardInputSchema = z.object({
  conformsTo: ManifestCroissantConformsToSchema.default('http://mlcommons.org/croissant/1.1'),

  // Step 1 — Identification
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(4000),
  /** SPDX URL or licence name. The validator accepts strings; a future iteration will pin to SPDX. */
  license: z.string().min(1).max(500),
  /** Homepage URL. Croissant 1.0 makes this required at the top level. */
  homepage: z.string().min(1).max(2000),
  citeAs: z.string().max(2000).optional(),
  version: z
    .string()
    .min(1)
    .max(40)
    // Same regex the publish endpoint enforces server-side.
    // eslint-disable-next-line security/detect-unsafe-regex
    .regex(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, 'expected semver MAJOR.MINOR.PATCH'),
  datePublished: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected ISO date YYYY-MM-DD'),

  // Step 2 — Creators (at least one)
  creators: z.array(ManifestWizardCreatorSchema).min(1).max(50),

  // Step 3 — Biomedical context (BioCroissant) — all optional
  imagingModality: z.array(z.string().min(1).max(200)).max(20).default([]),
  bodyRegion: z.array(z.string().min(1).max(200)).max(20).default([]),
  diseaseCondition: z.array(z.string().min(1).max(200)).max(20).default([]),
  anonymizationLevel: ManifestWizardAnonymizationLevelSchema.optional(),

  // Step 4 — Data use (DUO) — required for non-PUBLIC datasets per
  // publish-time fail-closed (J.1 decision #2). The wizard nudges the
  // host to pick at least one for every visibility level except PUBLIC.
  duoTerms: z.array(DuoTermIdSchema).max(20).default([]),

  // Step 5 — Distributions
  distributions: z.array(ManifestWizardDistributionSchema).max(100).default([]),

  // Notes — pass-through to the publish action's `notes` field; not
  // serialised into the manifest.
  notes: z.string().max(4000).optional(),
});
export type ManifestWizardInput = z.infer<typeof ManifestWizardInputSchema>;

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
 * Access-request audience (#120, ADR-0003 Decision 8). RESEARCHER flows
 * assume publication-as-output; BUILDER flows assume product-as-output
 * (regulated medical device, deployed AI service). Both share the same
 * state machine and Visa issuance.
 */
export const AccessRequestAudienceSchema = z.enum(['RESEARCHER', 'BUILDER']);
export type AccessRequestAudience = z.infer<typeof AccessRequestAudienceSchema>;

/**
 * Regulatory pathway the AI-builder is targeting (#120). Open list to
 * cover non-US/EU pathways (national health-tech regulators emerging
 * in LMIC) — the matcher doesn't gate on the value, the host reviewer
 * eyeballs it. Free-text-with-suggested-vocabulary in the form.
 */
export const RegulatoryPathwaySchema = z.enum([
  'FDA_510K',
  'FDA_DE_NOVO',
  'FDA_PMA',
  'EU_MDR_CLASS_I',
  'EU_MDR_CLASS_IIA',
  'EU_MDR_CLASS_IIB',
  'EU_MDR_CLASS_III',
  'EU_IVDR',
  'NATIONAL_LMIC',
  'NONE_RESEARCH_ONLY',
  'OTHER',
]);
export type RegulatoryPathway = z.infer<typeof RegulatoryPathwaySchema>;

/**
 * Post-market data-flow declaration (#120). What does the deployed
 * product *do* with the data it sees in production? GDPR Art. 22 +
 * proposed EU AI Act both anchor on this. Free vocabulary; values
 * surfaced verbatim to the host.
 */
export const PostMarketDataFlowSchema = z.enum([
  'NO_PERSISTENCE', // inference-only; nothing retained
  'AGGREGATE_STATS', // counts / metrics retained
  'PSEUDONYMISED_RETAINED', // de-identified individual rows
  'IDENTIFIED_RETAINED', // identifiable rows (rare; high scrutiny)
]);
export type PostMarketDataFlow = z.infer<typeof PostMarketDataFlowSchema>;

/**
 * AI-builder-specific context (#120). Populated only when the
 * requester selects a BUILDER audience. Persisted on
 * `AccessRequest.builderContext` (JSONB).
 *
 * Tuned for the OCI mission per ADR-0003: GI-AI4H is mandated to
 * enable AI solutions for WHO public-health priorities, especially in
 * LMICs. Fields like `whoPriorityAlignment` and `accreditations` (for
 * WHO Innovation Hub / national-MoH endorsement) directly serve that
 * mission — peers like Synapse don't ask these because their model
 * defaults academic-non-commercial.
 */
export const BuilderContextSchema = z.object({
  /** Legal entity that will hold the licence — full company name + jurisdiction. */
  legalEntity: z
    .object({
      name: z.string().min(1).max(200),
      /** ISO 3166-1 alpha-2 country code where the entity is registered. */
      jurisdictionCountry: z.string().regex(/^[A-Z]{2}$/, 'expected ISO 3166-1 alpha-2'),
    })
    .strict(),
  /**
   * Countries where the AI builder intends to deploy — ISO alpha-2.
   * Drives jurisdiction-specific DUA clauses (LMIC royalty-free terms,
   * US FDA pre-market, EU MDR conformity).
   */
  deploymentCountries: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .min(1)
    .max(50),
  regulatoryPathway: RegulatoryPathwaySchema,
  /**
   * Optional: which WHO priority area does the deployment address?
   * Free-text; recommended values are tuberculosis, maternal health,
   * NCDs, antimicrobial resistance, etc. Empty for non-mission-aligned
   * builders — still allowed; the field is signal, not a gate.
   */
  whoPriorityAlignment: z.string().max(500).nullable().optional(),
  /**
   * Recognised accreditations the builder holds (WHO Innovation Hub,
   * national MoH innovation programme, ISO 13485, IEC 62304, etc.).
   * Free-text per entry; ADR-0003 Decision 10 envisions pre-grants
   * for accredited LMIC actors, this field surfaces the evidence.
   */
  accreditations: z.array(z.string().min(1).max(200)).max(20).default([]),
  /**
   * Royalty / commercialisation plan summary. Free-text up to 4000
   * chars. Hosts may negotiate clauses (LMIC royalty-free, HIC
   * tiered split) bilaterally.
   */
  royaltyPlan: z.string().max(4000).nullable().optional(),
  postMarketDataFlow: PostMarketDataFlowSchema,
});
export type BuilderContext = z.infer<typeof BuilderContextSchema>;

/**
 * AI-tool disclosure (#115). Optional structured declaration of which
 * AI / ML tools the requester used (or will use) in the project. Drives
 * the "AI tool transparency" badge in the host inbox and a future
 * audit-trail surfacing requirement (LMIC regulatory fits often demand
 * such a declaration). Empty `tools[]` is the default; populating UI
 * lands with #120 (builder/researcher form variants).
 */
export const AiToolDisclosureSchema = z
  .object({
    tools: z
      .array(
        z.object({
          /** Tool name, e.g. "GPT-4", "GitHub Copilot", "Claude Sonnet". */
          name: z.string().min(1).max(200),
          /** How the tool was used — analysis, code generation, drafting, etc. */
          usage: z.string().min(1).max(1000),
        }),
      )
      .max(20)
      .default([]),
    /** Free-text addendum to capture context the structured fields don't. */
    notes: z.string().max(4000).nullable().optional(),
  })
  .strict();
export type AiToolDisclosure = z.infer<typeof AiToolDisclosureSchema>;

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
   * later. `accessTier` (#115) is also snapshotted so a tier upgrade
   * by the host doesn't invalidate the matcher's reasoning.
   */
  dataset: {
    id: string;
    slug: DatasetSlug;
    name: string;
    duoTerms: DuoTermId[];
    accessTier: AccessTier;
  };
  /** Requester identity — sub from Cognito (UUID-shaped). */
  requesterId: string;
  /** Optional: requester's display name (email or username). Null when not surfaced. */
  requesterDisplayName: string | null;
  /**
   * Free-text justification. Retained for backwards-compat with the
   * v0 form; v1 mirrors `attestations.projectDescription` here so
   * legacy code paths keep rendering. New consumers should read from
   * `iduStatement` (#115) or `attestations`.
   */
  justification: string;
  /**
   * Intended Data Use statement (#115, ADR-0003 Decision 2). Replaces
   * `justification` as the canonical free-text rationale; populated on
   * write by the API (mirrored from `attestations.projectDescription`
   * during the transition). Backfilled from `justification` on
   * existing rows.
   */
  iduStatement: string | null;
  /**
   * Optional AI-tool transparency declaration (#115). `null` until #120
   * adds the form input; populated rows describe which tools the
   * project relies on so the host can flag policy concerns up front.
   */
  aiToolDisclosure: AiToolDisclosure | null;
  /**
   * Email of the Signing Official / PI who must countersign the request
   * (CONTROLLED+ tiers, future PR). `null` when the tier doesn't require
   * countersign.
   */
  signingOfficialEmail: string | null;
  /**
   * Timestamp when the requester accepted the data-use pledge / click-wrap
   * (#118). `null` until that PR ships and the form starts capturing it.
   */
  pledgeAcceptedAt: string | null;
  /**
   * Computed identity-assurance score (#115). Reflects what the platform
   * could verify about the requester at create time (email-domain category,
   * later: ORCID, quiz pass, Passport visas). Persisted on the row so
   * the host inbox surfaces "what we know about this person" without a
   * recomputation per render.
   */
  requesterIdentityScore: RequesterIdentityScore;
  /**
   * Audience classification (#120). Derived at create time from
   * `attestations.intendedUseCategory`. Drives which form template the
   * host inbox shows (researcher detail vs. builder detail).
   */
  audience: AccessRequestAudience;
  /**
   * AI-builder-specific context (#120). Populated for `BUILDER`
   * audience rows; null for `RESEARCHER`.
   */
  builderContext: BuilderContext | null;
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
export const CreateAccessRequestRequestSchema = z
  .object({
    attestations: AccessRequestAttestationsSchema,
    /**
     * AI-builder-specific context (#120). Required when the
     * requester's intended use is `COMMERCIAL_RESEARCH` or
     * `CLINICAL_CARE` (BUILDER audience), forbidden otherwise. The
     * service derives `audience` server-side from
     * `attestations.intendedUseCategory` and validates the
     * builderContext against this requirement.
     */
    builderContext: BuilderContextSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const isBuilderIntent =
      value.attestations.intendedUseCategory === 'COMMERCIAL_RESEARCH' ||
      value.attestations.intendedUseCategory === 'CLINICAL_CARE';
    if (isBuilderIntent && !value.builderContext) {
      ctx.addIssue({
        code: 'custom',
        path: ['builderContext'],
        message:
          'builderContext is required for COMMERCIAL_RESEARCH or CLINICAL_CARE intent (BUILDER audience)',
      });
    }
    if (!isBuilderIntent && value.builderContext) {
      ctx.addIssue({
        code: 'custom',
        path: ['builderContext'],
        message:
          'builderContext is only accepted for COMMERCIAL_RESEARCH or CLINICAL_CARE intent (RESEARCHER audience requests must omit it)',
      });
    }
  });
export type CreateAccessRequestRequest = z.infer<typeof CreateAccessRequestRequestSchema>;

/**
 * Derive the audience from the requester's intended-use category. Pure
 * helper; the service uses this to compute the persisted `audience`
 * field, and the form uses it to swap between researcher and builder
 * field templates.
 */
export function audienceFromIntendedUse(
  intendedUseCategory: IntendedUseCategory,
): AccessRequestAudience {
  return intendedUseCategory === 'COMMERCIAL_RESEARCH' || intendedUseCategory === 'CLINICAL_CARE'
    ? 'BUILDER'
    : 'RESEARCHER';
}

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

// ==== User UI preferences (identity package, PR M) =======================

/** Light / dark / 'system' (follow OS preference). */
export const DarkModeSchema = z.enum(['system', 'light', 'dark']);
export type DarkMode = z.infer<typeof DarkModeSchema>;

/** UI density. */
export const DensitySchema = z.enum(['comfortable', 'compact']);
export type Density = z.infer<typeof DensitySchema>;

/**
 * BCP-47 language tag. Loose by design — the API accepts anything that
 * looks like a tag; canonical resolution against the supported-locales
 * list happens at render time so adding a new locale doesn't require a
 * shared-types bump.
 */
export const LocaleSchema = z
  .string()
  .min(2)
  .max(35)
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded by .max(35); BCP-47 segments are 2-8 chars, no realistic ReDoS surface
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
export type Locale = z.infer<typeof LocaleSchema>;

export interface UserPreferences {
  darkMode: DarkMode;
  locale: Locale | null;
  density: Density;
  updatedAt: string;
}

/**
 * `PUT /v2/preferences/me` — partial update. All fields optional;
 * unset fields are left unchanged. `locale: null` explicitly clears it
 * (revert to "use the browser default").
 */
export const UpdateUserPreferencesRequestSchema = z
  .object({
    darkMode: DarkModeSchema.optional(),
    locale: LocaleSchema.nullable().optional(),
    density: DensitySchema.optional(),
  })
  .strict();
export type UpdateUserPreferencesRequest = z.infer<typeof UpdateUserPreferencesRequestSchema>;

// ==== Certification quiz (#117, ADR-0003 Phase 1) =========================
//
// Required to reach the CONTROLLED access tier (#115). The quiz is
// served from a hardcoded bank in the API; this file only carries the
// shapes the web side reads (the questions list — minus the correct
// answers) and writes (the submission payload).

/** A single quiz question, with the correct answer omitted for the wire. */
export interface QuizQuestionPublic {
  id: string;
  prompt: string;
  /** 4 string choices in canonical order — the index is the answer key. */
  choices: readonly [string, string, string, string];
  topic: 'ethics' | 'reidentification' | 'dua' | 'irb';
}

/**
 * `GET /v2/certification/quizzes/:type` — fetch the quiz to render.
 * Public structure; never includes correct answers.
 */
export interface QuizDefinitionPublic {
  certificationType: string;
  title: string;
  passMarkPercent: number;
  validityDays: number;
  questions: QuizQuestionPublic[];
}

/** `POST /v2/certification/quizzes/:type/attempts` — start a new attempt. */
export interface StartQuizAttemptResponse {
  attemptId: string;
  startedAt: string;
}

/** `POST /v2/certification/quizzes/:type/attempts/:id/submit` — submit answers. */
export const SubmitQuizAttemptRequestSchema = z.object({
  /**
   * Answers in question-order; one entry per question. The server
   * grades against the question bank by `questionId`, not by index,
   * so a client that skipped a question can still submit (the
   * skipped one will count as wrong).
   */
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(64),
        choiceIndex: z.number().int().min(0).max(3),
      }),
    )
    .min(1)
    .max(50),
});
export type SubmitQuizAttemptRequest = z.infer<typeof SubmitQuizAttemptRequestSchema>;

/** Outcome of a submission. The wrong-answer detail is intentionally omitted. */
export interface QuizAttemptResult {
  attemptId: string;
  certificationType: string;
  /** 0–100. */
  score: number;
  passed: boolean;
  passMarkPercent: number;
  submittedAt: string;
  /** ISO-8601; populated only when passed. */
  expiresAt: string | null;
}

/**
 * `GET /v2/me/certifications` — caller's certification summary +
 * recent attempt history. The active certification is the most
 * recent passed attempt within `validityDays`; `null` when no active
 * cert exists. History is the last 20 attempts (newest first), used
 * by the UI to surface "you have 2 prior attempts; this is attempt 3".
 */
export interface UserCertificationStatus {
  certificationType: string;
  /** Has an unexpired pass right now. */
  active: boolean;
  /** Date the active certification (if any) was passed. */
  passedAt: string | null;
  /** Date the active certification expires; null when not active. */
  expiresAt: string | null;
  /** Recent attempt summaries (most recent first). */
  history: Array<{
    attemptId: string;
    submittedAt: string;
    score: number;
    passed: boolean;
  }>;
}

// ==== ORCID iD link (#125, ADR-0003 Phase 2) ==============================
//
// Verified scholarly identifier. The OAuth dance is started on the API
// (`GET /v2/identity/orcid/authorize`) and finishes via the web's
// `/orcid/callback` route, which posts the code back to the API. The
// platform stores a thin link summary; tokens aren't persisted because
// we use `/authenticate` scope only.

/**
 * Canonical ORCID iD format — 16 digits in groups of 4 separated by
 * hyphens. The 16th character may also be 'X' (a checksum digit).
 * Validated server-side; the form-side only renders / displays.
 */
export const OrcidIdSchema = z
  .string()
  .regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, 'expected ORCID iD format 0000-0000-0000-0000');
export type OrcidId = z.infer<typeof OrcidIdSchema>;

/** `GET /v2/identity/orcid/authorize` response — where to redirect the user. */
export interface OrcidAuthorizeResponse {
  /** Full ORCID OAuth authorize URL (with client_id, scope, redirect_uri, state). */
  authorizeUrl: string;
  /** Opaque state value the API expects on the callback. The web stores it briefly to validate the redirect. */
  state: string;
}

/** `POST /v2/identity/orcid/callback` request body. */
export const OrcidCallbackRequestSchema = z.object({
  /** OAuth authorization code from the ORCID redirect. */
  code: z.string().min(1).max(2000),
  /** Opaque state echoed back by ORCID; must match the one issued on authorize. */
  state: z.string().min(1).max(200),
});
export type OrcidCallbackRequest = z.infer<typeof OrcidCallbackRequestSchema>;

/**
 * Public summary of a user's linked ORCID. `GET /v2/me/orcid` returns
 * this (or null when not linked). Surfaced on /settings.
 */
export interface OrcidLinkSummary {
  orcidId: OrcidId;
  fullName: string | null;
  primaryEmail: string | null;
  affiliation: string | null;
  /** ISO-8601 timestamp the link was first established or last refreshed. */
  verifiedAt: string;
  /** Convenience — `https://orcid.org/<orcidId>`. */
  publicUrl: string;
}

// ==== GA4GH Passport relying party (#126, ADR-0003 Phase 2) ===============
//
// The platform ingests Visa JWTs from trusted issuers (ELIXIR AAI, NIH
// RAS, Sage broker — admin-managed allowlist). A verified Visa lifts
// the requester score in identity-context (`ResearcherStatus` →
// `PASSPORT_VERIFIED`, top of the ladder) and surfaces on the host
// inbox as "ResearcherStatus from <issuer>".
//
// Spec: https://ga4gh.github.io/data-security/ga4gh-passport
// Visa JWT shape: standard JOSE-signed JWT with a `ga4gh_visa_v1`
// claim carrying `{ type, asserted, value, source, by? }`.

/**
 * GA4GH Visa types we recognise. Open enum — the Passport spec
 * permits issuer-defined types, but the platform only acts on the
 * ones below. Other types are stored verbatim but ignored for
 * identity-score lifts.
 *
 *   - `ResearcherStatus`        bona-fide researcher status — the score-lifting one
 *   - `AffiliationAndRole`      institutional affiliation evidence
 *   - `AcceptedTermsAndPolicies` consent / terms acknowledgement
 *   - `ControlledAccessGrants`  prior controlled-access grants (informational)
 *   - `LinkedIdentities`        identity-binding (e.g. ORCID ↔ Passport sub)
 */
export const GA4GHVisaTypeSchema = z.enum([
  'ResearcherStatus',
  'AffiliationAndRole',
  'AcceptedTermsAndPolicies',
  'ControlledAccessGrants',
  'LinkedIdentities',
]);
export type GA4GHVisaType = z.infer<typeof GA4GHVisaTypeSchema>;

/**
 * `POST /v2/identity/passport/visas` request body. The web (or any
 * downstream client) pushes a Passport JWT here for verification +
 * persistence. The API validates against the trusted-issuer registry,
 * verifies the signature against the issuer's JWKS, and persists on
 * success. Returns the parsed visa summary.
 */
export const IngestPassportVisaRequestSchema = z.object({
  /** Compact-form JWT. Base64url-encoded `header.payload.signature`. */
  jwt: z.string().min(20).max(8000),
});
export type IngestPassportVisaRequest = z.infer<typeof IngestPassportVisaRequestSchema>;

/**
 * Public summary of one verified Visa. Surfaced on /settings/passport
 * and on the host inbox alongside an access request.
 */
export interface PassportVisaSummary {
  id: string;
  /** Decoded visa type — see `GA4GHVisaTypeSchema` for the recognised set. */
  visaType: string;
  /** Issuer URL the JWT was signed by (e.g. https://login.elixir-czech.org/oidc/). */
  issuer: string;
  /** Human label of the issuer from the trusted-issuer registry. */
  issuerDisplayName: string;
  /** ISO-8601 timestamp the issuer asserted the visa. */
  assertedAt: string;
  /** ISO-8601 timestamp the visa expires. */
  expiresAt: string;
  /** ISO-8601 timestamp the platform verified + ingested. */
  verifiedAt: string;
  /** Decoded `ga4gh_visa_v1.value` — issuer-defined; for ResearcherStatus typically a URL or scope. */
  value: string | null;
  /** Decoded `ga4gh_visa_v1.source` — the asserting org. */
  source: string | null;
}

/** `GET /v2/me/passport/visas` response. */
export interface ListPassportVisasResponse {
  items: PassportVisaSummary[];
}

/** Public view of a trusted issuer for admin UI / docs. */
export interface PassportTrustedIssuerSummary {
  id: string;
  issuer: string;
  displayName: string;
  jwksUri: string | null;
  active: boolean;
}

// ==== OCI as Passport issuer (#127, ADR-0003 Phase 2) =====================
//
// Counterpart to the relying-party module: the platform also signs
// its own GA4GH Passport Visas for internal events:
//   - quiz pass            → ResearcherStatus
//   - click-wrap acceptance → AcceptedTermsAndPolicies
//   - access approval      → ControlledAccessGrants
//
// Visa JWTs are minted on demand (we don't persist the signed JWT —
// re-signing from the row is cheap and lets us rotate keys without
// re-issuing every visa). Public keys live at /.well-known/jwks.json.

/** Public-JWK shape published at `/.well-known/jwks.json`. RFC 7517. */
export interface PublicJwk {
  kty: 'RSA' | 'EC';
  alg: string;
  kid: string;
  use: 'sig';
  /** RSA modulus (base64url). Present when `kty === 'RSA'`. */
  n?: string;
  /** RSA exponent (base64url). Present when `kty === 'RSA'`. */
  e?: string;
  /** EC curve name. Present when `kty === 'EC'`. */
  crv?: string;
  /** EC X coordinate (base64url). Present when `kty === 'EC'`. */
  x?: string;
  /** EC Y coordinate (base64url). Present when `kty === 'EC'`. */
  y?: string;
}

/** `GET /.well-known/jwks.json` response. RFC 7517 §5. */
export interface JwksResponse {
  keys: PublicJwk[];
}

/**
 * Public summary of one OCI-issued visa held by the caller.
 * `GET /v2/me/passport/issued` returns these. The signed JWT is
 * regenerated on demand at `GET /v2/me/passport/issued/:id/jwt` so
 * verifiers can be handed a fresh, currently-valid token.
 */
export interface IssuedPassportVisaSummary {
  id: string;
  visaType: string;
  value: string;
  source: string;
  jti: string;
  /** ISO-8601 timestamps. */
  assertedAt: string;
  expiresAt: string;
  /** True when not revoked and not yet expired. */
  active: boolean;
  contextType: string | null;
  contextRef: string | null;
}

/** `GET /v2/me/passport/issued` response. */
export interface ListIssuedPassportVisasResponse {
  items: IssuedPassportVisaSummary[];
}

/**
 * `GET /v2/me/passport/issued/:id/jwt` response — a freshly-signed
 * JWT for the row. The JWT is short-lived (matches `expiresAt` on
 * the row) so the caller can present it to an external verifier.
 */
export interface IssuedPassportVisaJwt {
  jwt: string;
}

// ==== DUA template engine (#129, ADR-0003 Decision 8) ====================
//
// Produces the prose of a Data Use Agreement that the host and
// requester will sign (via DocuSeal — #128). The engine is pure:
// inputs (audience, dataset DUO terms, host institution, intended
// use, LMIC toggle) → text. Two base templates:
//   - `RESEARCHER` — publication-as-output. Default for academic /
//     non-commercial requesters.
//   - `BUILDER` — product-as-output. AI builders / commercial use.
//     Includes regulatory-pathway, deployment-country, royalty-terms,
//     and post-market-data-flow clauses.
//
// An LMIC addendum is appended when the host has marked the dataset
// as royalty-free for LMIC public-sector deployment.

/** Which DUA template variant to render. Drives clauses + tone. */
export const DuaTemplateAudienceSchema = z.enum(['RESEARCHER', 'BUILDER']);
export type DuaTemplateAudience = z.infer<typeof DuaTemplateAudienceSchema>;

/**
 * `POST /v2/dua/preview` body. The host or requester can call this
 * during the access-request flow to preview the DUA before signing
 * — the same inputs the AR creation flow would feed at sign time.
 */
export const PreviewDuaRequestSchema = z.object({
  /** Slug of the target dataset (canonical id resolves host institution + DUO terms). */
  datasetSlug: DatasetSlugSchema,
  /** Researcher vs builder variant — drives clauses + signature lines. */
  audience: DuaTemplateAudienceSchema,
  /** Plain-text rationale that lands in the "Statement of Use" section. */
  intendedUse: z.string().min(20).max(4000),
  /** Requester's institution / organisation. Falls back to "Independent". */
  requesterInstitution: z.string().min(1).max(200).optional(),
  /** Requester's full name (will be filled in by DocuSeal at sign time). */
  requesterName: z.string().min(1).max(200).optional(),
  /** Builder-only — regulatory pathway (e.g. "CE marking", "FDA 510(k)"). */
  regulatoryPathway: z.string().max(200).optional(),
  /** Builder-only — primary deployment country (ISO 3166-1 alpha-2). */
  deploymentCountry: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/, 'expected ISO 3166-1 alpha-2 country code')
    .optional(),
  /** Forces the LMIC addendum even when the dataset isn't marked royalty-free (preview only). */
  forceLmicAddendum: z.boolean().optional(),
});
export type PreviewDuaRequest = z.infer<typeof PreviewDuaRequestSchema>;

/** `POST /v2/dua/preview` response. */
export interface PreviewDuaResponse {
  /** Selected template variant id (`dua-researcher`, `dua-builder`). */
  templateId: string;
  /** Whether the LMIC addendum was appended. */
  lmicAddendumIncluded: boolean;
  /** Rendered DUA body — Markdown. The PDF/DOCX rendering is downstream (DocuSeal). */
  markdown: string;
}

// ==== AdES DUA signing via DocuSeal (#128, ADR-0003 Decision 5) ===========
//
// One step up from click-wrap (#118 / SES). Required for `CONTROLLED`
// access tier per the matrix. The flow:
//
//   1. Host approves an AR for a CONTROLLED-tier dataset →
//      `POST /v2/dua/sign-requests` (called by the AR service or by
//      the requester explicitly).
//   2. Server renders the DUA via the template engine (#129), hashes
//      it, persists the row, calls DocuSeal to create the signing
//      envelope, stores the submission id + signer URL.
//   3. Requester follows the signer URL, signs, DocuSeal POSTs back
//      to `/v2/dua/webhook/docuseal`.
//   4. Webhook handler stamps `SIGNED`, mints an
//      `AcceptedTermsAndPolicies` GA4GH visa with the DUA URL.
//
// Activation: env `OCI_DOCUSEAL_BASE_URL` + `OCI_DOCUSEAL_API_TOKEN`
// + `OCI_DOCUSEAL_WEBHOOK_SECRET`. When unset, the signing endpoints
// return 503; everything else (template preview, click-wrap) still
// works.

export const DuaSignatureStatusSchema = z.enum(['PENDING', 'SIGNED', 'DECLINED', 'EXPIRED']);
export type DuaSignatureStatus = z.infer<typeof DuaSignatureStatusSchema>;

/**
 * `POST /v2/dua/sign-requests` body. The caller asks the platform to
 * mint a signing envelope for the given access-request id. Auth
 * required; only the requester or the dataset host can create one
 * (admin override allowed).
 */
export const CreateDuaSigningRequestSchema = z.object({
  /** UUID of the AccessRequest this DUA applies to. */
  accessRequestId: z.string().uuid(),
  /** Researcher vs builder template variant. Drives clause selection. */
  audience: DuaTemplateAudienceSchema,
  /**
   * Signer email — required by DocuSeal to send the signing link.
   * The platform doesn't always have the requester's email on hand
   * (Cognito access tokens omit it in production), so the form
   * collects it explicitly.
   */
  signerEmail: z.string().email(),
  /** Signer display name shown on the signing page + audit. */
  signerName: z.string().min(1).max(200),
});
export type CreateDuaSigningRequest = z.infer<typeof CreateDuaSigningRequestSchema>;

/** Public summary of one DUA signature row. */
export interface DuaSignatureSummary {
  id: string;
  accessRequestId: string;
  status: DuaSignatureStatus;
  /** SHA-256 of the rendered DUA body the requester saw. */
  documentSha256: string;
  /** URL the signer follows to complete signing. Null after signed/declined. */
  signerUrl: string | null;
  /** DocuSeal-hosted PDF after completion. Null until signed. */
  signedPdfUrl: string | null;
  /** ISO-8601 timestamps. */
  createdAt: string;
  signedAt: string | null;
  declinedAt: string | null;
}

/** `POST /v2/dua/sign-requests` response. */
export interface CreateDuaSigningRequestResponse {
  signature: DuaSignatureSummary;
}

/** `GET /v2/me/dua-signatures` response. */
export interface ListDuaSignaturesResponse {
  items: DuaSignatureSummary[];
}

/**
 * DocuSeal webhook payload — `POST /v2/dua/webhook/docuseal`.
 *
 * The actual DocuSeal hook envelope is richer (audit metadata,
 * signer details, IP). We narrow to the fields the platform acts on
 * + carry the rest opaquely for the audit trail.
 *
 * The HMAC signature header (`X-Docuseal-Signature`) is validated
 * before the body is parsed; this schema is post-validation.
 */
export const DocusealWebhookEventSchema = z.object({
  /** `form.completed` | `form.declined` | `form.expired`. */
  event_type: z.string(),
  /** The submission whose state changed. */
  data: z.object({
    id: z.union([z.string(), z.number()]),
    /** ISO-8601 completion timestamp. Present on completed/declined. */
    completed_at: z.string().nullable().optional(),
    /** DocuSeal-hosted PDF URL of the completed envelope. */
    documents: z
      .array(
        z.object({
          name: z.string().optional(),
          url: z.string().optional(),
        }),
      )
      .optional(),
  }),
});
export type DocusealWebhookEvent = z.infer<typeof DocusealWebhookEventSchema>;

// ==== Click-wrap policy acceptance (#118, ADR-0003 Decision 4) ============
//
// SES-grade evidence for OPEN/REGISTERED tier flows. The API records
// the policy text + its SHA-256 hash + (when KMS is configured) a
// signed receipt. Legally binding under US ESIGN/UETA + EU eIDAS for
// click-wrap; CONTROLLED/SENSITIVE tiers will use AdES (DocuSeal) /
// QES (Yousign) on top of this primitive in future PRs.

/**
 * Optional context attached to an acceptance — links the click-wrap
 * event to the workflow that triggered it. Open list; the most common
 * values today are `access_request` (a request-access click-through)
 * and `dataset_publish` (a host accepting the contributor agreement).
 */
export const PolicyAcceptanceContextTypeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'context type must be lower_snake_case');
export type PolicyAcceptanceContextType = z.infer<typeof PolicyAcceptanceContextTypeSchema>;

/** `POST /v2/identity/policy-acceptances` — record a click-through. */
export const RecordPolicyAcceptanceRequestSchema = z.object({
  /** Canonical URL for the policy doc — surfaced in the audit trail. */
  policyUrl: z.string().url().max(2000),
  /** Version slug (e.g. "v1.0", "2026-05") shown in the policy header. */
  policyVersion: z.string().min(1).max(64),
  /**
   * Verbatim policy text the user clicked to accept. Stored on the row
   * so the binding survives canonical-doc rotation. Capped at 1 MB
   * (typical policy: a few KB; we leave headroom for long DUAs).
   */
  policyText: z.string().min(1).max(1_048_576),
  /** Optional `(contextType, contextRef)` binding — see schema docs. */
  contextType: PolicyAcceptanceContextTypeSchema.nullable().optional(),
  /**
   * Free-text reference, typically a UUID or slug pointing back to
   * the workflow that triggered the click-through. Bounded.
   */
  contextRef: z.string().min(1).max(200).nullable().optional(),
});
export type RecordPolicyAcceptanceRequest = z.infer<typeof RecordPolicyAcceptanceRequestSchema>;

/**
 * Acceptance receipt returned to the caller. The `textSha256` is the
 * canonical binding artifact — clients can persist it as proof. When
 * KMS is configured at the API, `signature` carries a base64-encoded
 * detached signature over `{id, userId, policyUrl, policyVersion,
 * textSha256, acceptedAt}`; verifiers recompute that JSON and call
 * KMS Verify. Null when KMS wasn't configured at acceptance time —
 * the hash alone is still legally sufficient for SES.
 */
export interface PolicyAcceptanceReceipt {
  id: string;
  userId: string;
  policyUrl: string;
  policyVersion: string;
  textSha256: string;
  acceptedAt: string; // ISO 8601
  contextType: PolicyAcceptanceContextType | null;
  contextRef: string | null;
  /** Base64 KMS signature; null when KMS signing wasn't configured. */
  signature: string | null;
  /** KMS key id used to sign; null when `signature` is null. */
  signatureKeyId: string | null;
}

export interface ListPolicyAcceptancesResponse {
  items: PolicyAcceptanceReceipt[];
}

// =============================================================================
// Annotation module — Phase B.A.1 (ADR-0006..0012)
// =============================================================================

/**
 * Campaign slug rules — same shape as DatasetSlugSchema. Lower-case
 * alphanumerics + single hyphens, 3-80 chars. Campaign URLs share the
 * ergonomic shape with the rest of the platform.
 */
export const CampaignSlugSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(
    /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9]))*$/,
    'slug must be lower-case alphanumerics with single hyphens, 3-80 chars',
  );
export type CampaignSlug = z.infer<typeof CampaignSlugSchema>;

/**
 * Campaign lifecycle states (ADR-0006 Decision 1). DRAFT → READY →
 * RUNNING → COMPLETED → ARCHIVED. Phase B.A.1 only writes DRAFT; the
 * full state machine is the E3 workflow engine (#215).
 */
export const CampaignStatusSchema = z.enum(['DRAFT', 'READY', 'RUNNING', 'COMPLETED', 'ARCHIVED']);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

/**
 * Task kinds per ADR-0006. Future kinds (multimodal sub-variants, video,
 * audio) land as the platform's modality coverage expands per ADR-0008.
 */
export const CampaignTaskKindSchema = z.enum([
  'CLASSIFICATION',
  'DETECTION',
  'SEGMENTATION',
  'LOCALIZATION',
  'MULTI_MODAL',
]);
export type CampaignTaskKind = z.infer<typeof CampaignTaskKindSchema>;

/**
 * Output license per ADR-0012. SPDX identifier or `custom-restricted`.
 * Per-tier defaults: OPEN/REGISTERED → CC-BY-4.0; CONTROLLED →
 * CC-BY-NC-4.0; SENSITIVE → custom-restricted (must be explicitly
 * specified). Immutable once campaign starts running.
 */
export const CampaignOutputLicenseSchema = z.enum([
  'CC-BY-4.0',
  'CC-BY-NC-4.0',
  'CC-BY-SA-4.0',
  'CC0-1.0',
  'custom-restricted',
]);
export type CampaignOutputLicense = z.infer<typeof CampaignOutputLicenseSchema>;

/**
 * Workflow configuration (ADR-0009 Decisions 2 + 4). Phase B.A.1 only
 * surfaces `nAnnotators`; IRR thresholds + gate config + experience-
 * model knobs land as #216 (E4) ships.
 */
export const CampaignWorkflowConfigSchema = z.object({
  /**
   * Number of independent annotators at gate 1. Default 3; range [1,12]
   * per ADR-0009 Decision 2. Values 8-12 require campaign-manager
   * justification (recorded on the campaign — UI-side enforcement
   * lands with #222).
   */
  nAnnotators: z.number().int().min(1).max(12).default(3),
});
export type CampaignWorkflowConfig = z.infer<typeof CampaignWorkflowConfigSchema>;

/**
 * Reference to the annotation-tool adapter the campaign uses. Phase
 * B.A.1 ships a minimal `AnnotationToolIntegration` registry with
 * seeded stub rows; the full contract + capability matrix lands as
 * sub-epic #214 (ADR-0007).
 */
export const AnnotationToolIntegrationSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  vendor: z.string(),
  /** Latest available version string (semver per ADR-0007). */
  version: z.string(),
  /**
   * Task kinds this tool can handle. Drives the tool-picker filter on
   * `/annotation/campaigns/new`. The full per-task capability matrix
   * lands with #214; this minimal slice is enough for the form to be
   * safe today.
   */
  supportedTaskKinds: z.array(CampaignTaskKindSchema),
});
export type AnnotationToolIntegrationSummary = z.infer<
  typeof AnnotationToolIntegrationSummarySchema
>;

/** Summary row returned by `GET /v2/annotation/campaigns`. */
export const CampaignSummarySchema = z.object({
  id: z.string().uuid(),
  slug: CampaignSlugSchema,
  name: z.string(),
  description: z.string().nullable(),
  status: CampaignStatusSchema,
  taskKind: CampaignTaskKindSchema,
  /** FK to catalog.datasets.id — set at creation, immutable per ADR-0006. */
  datasetId: z.string().uuid(),
  /** FK to annotation_tool_integrations.id — immutable once campaign runs. */
  toolIntegrationId: z.string().uuid(),
  /** Output license declared at creation (ADR-0012). */
  outputLicense: CampaignOutputLicenseSchema,
  createdAt: z.string(), // ISO 8601
  updatedAt: z.string(),
  /** ISO 8601 timestamp set when the campaign transitions to RUNNING. */
  startedAt: z.string().nullable(),
  /** ISO 8601 timestamp set when the campaign transitions to COMPLETED. */
  completedAt: z.string().nullable(),
});
export type CampaignSummary = z.infer<typeof CampaignSummarySchema>;

/** Full detail returned by `GET /v2/annotation/campaigns/:slug`. */
export const CampaignDetailSchema = CampaignSummarySchema.extend({
  workflowConfig: CampaignWorkflowConfigSchema,
  /** Joined tool-integration summary for display. */
  toolIntegration: AnnotationToolIntegrationSummarySchema,
  /** Manager id (FK identity.users.id). The user who created the campaign. */
  createdById: z.string().uuid(),
});
export type CampaignDetail = z.infer<typeof CampaignDetailSchema>;

/** `POST /v2/annotation/campaigns` — campaign-manager create. */
export const CreateCampaignRequestSchema = z.object({
  slug: CampaignSlugSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  datasetId: z.string().uuid(),
  toolIntegrationId: z.string().uuid(),
  taskKind: CampaignTaskKindSchema,
  workflowConfig: CampaignWorkflowConfigSchema.optional(),
  /**
   * Optional. When unset, the API derives the default from the
   * dataset's access tier per ADR-0012 Decision 3 (OPEN/REGISTERED →
   * CC-BY-4.0; CONTROLLED → CC-BY-NC-4.0; SENSITIVE → operator must
   * specify, so this field becomes required at the API layer for
   * SENSITIVE-tier datasets).
   */
  outputLicense: CampaignOutputLicenseSchema.optional(),
});
export type CreateCampaignRequest = z.infer<typeof CreateCampaignRequestSchema>;

export const ListCampaignsResponseSchema = z.object({
  items: z.array(CampaignSummarySchema),
  /** Opaque cursor; absent when no more pages. Phase B.A.2 paginates. */
  nextCursor: z.string().nullable(),
  totalEstimate: z.number().int(),
});
export type ListCampaignsResponse = z.infer<typeof ListCampaignsResponseSchema>;

// ---------------------------------------------------------------------------
// Campaign lifecycle state machine (#215, slice 1).
//
// Allowed transitions per ADR-0006 Decision 1:
//   DRAFT      --mark-ready--->   READY        (pre-flight pass)
//   READY      --revert-to-draft->DRAFT        (reason required; manager mistake recovery)
//   READY      --start---------->  RUNNING      (sets startedAt; locks dataset / tool)
//   RUNNING    --complete------->  COMPLETED    (sets completedAt; tasks all done in slice ≥ 2)
//   RUNNING    --archive-------->  ARCHIVED     (reason required; emergency stop)
//   COMPLETED  --archive-------->  ARCHIVED     (no reason needed; tidy-up of old work)
//
// Slice 1 of #215 implements the action-vocabulary + service-layer state
// guard + denormalised `startedAt` / `completedAt` columns. Task
// generation, queue routing, and the per-task gate state machine arrive
// in slice 2 of the same issue.
// ---------------------------------------------------------------------------

export const CampaignTransitionActionSchema = z.enum([
  'mark-ready',
  'revert-to-draft',
  'start',
  'complete',
  'archive',
]);
export type CampaignTransitionAction = z.infer<typeof CampaignTransitionActionSchema>;

export const TransitionCampaignRequestSchema = z.object({
  action: CampaignTransitionActionSchema,
  /**
   * Operator-supplied reason; required for `revert-to-draft` and for
   * `archive` from the RUNNING state. Stored on the campaign row for
   * audit / display until the dedicated transition-history table lands
   * in slice 2.
   */
  reason: z.string().max(500).optional(),
});
export type TransitionCampaignRequest = z.infer<typeof TransitionCampaignRequestSchema>;

/**
 * Lookup table of legal transitions per source status. Shared between
 * the API (state-machine guard) and the web (button visibility +
 * reason-required prompts). Keep in sync with the Mermaid diagram in
 * `docs/for-developers/annotation-module.md`.
 */
const CAMPAIGN_TRANSITIONS: Record<
  CampaignStatus,
  ReadonlyArray<{ action: CampaignTransitionAction; reasonRequired: boolean }>
> = {
  DRAFT: [{ action: 'mark-ready', reasonRequired: false }],
  READY: [
    { action: 'revert-to-draft', reasonRequired: true },
    { action: 'start', reasonRequired: false },
  ],
  RUNNING: [
    { action: 'complete', reasonRequired: false },
    { action: 'archive', reasonRequired: true },
  ],
  COMPLETED: [{ action: 'archive', reasonRequired: false }],
  ARCHIVED: [],
};

/** Actions legal from the given status — drives UI button visibility. */
export function availableCampaignActions(
  status: CampaignStatus,
): ReadonlyArray<CampaignTransitionAction> {
  // eslint-disable-next-line security/detect-object-injection -- typed enum keys
  return (CAMPAIGN_TRANSITIONS[status] ?? []).map((r) => r.action);
}

/** True when the given action from the given status requires a reason. */
export function campaignActionRequiresReason(
  status: CampaignStatus,
  action: CampaignTransitionAction,
): boolean {
  // eslint-disable-next-line security/detect-object-injection -- typed enum keys
  const rules = CAMPAIGN_TRANSITIONS[status] ?? [];
  return rules.find((r) => r.action === action)?.reasonRequired ?? false;
}

// ---------------------------------------------------------------------------
// Admin — Cognito group management (#241).
//
// PlatformGroup is the curated set of Cognito groups the operator UI
// surfaces. Cognito itself is the source of truth (the API never
// enforces this enum at the IAM layer); this list is what the
// `/admin/users` checkboxes render, so adding a new role to the
// platform means adding it here AND creating it as a Cognito group via
// CDK / console.
// ---------------------------------------------------------------------------

export const PlatformGroupSchema = z.enum([
  'admin',
  'host',
  'campaign-manager',
  'task-supervisor',
  'reviewer',
  'arbitration-annotator',
  'expert-reviewer',
  'annotator',
  'supervisor',
  'regulator',
  'participant',
]);
export type PlatformGroup = z.infer<typeof PlatformGroupSchema>;

/** Cognito's enumerated user-status values, plus an UNKNOWN fallback. */
export const CognitoUserStatusSchema = z.enum([
  'CONFIRMED',
  'UNCONFIRMED',
  'ARCHIVED',
  'COMPROMISED',
  'UNKNOWN',
  'RESET_REQUIRED',
  'FORCE_CHANGE_PASSWORD',
  'EXTERNAL_PROVIDER',
]);
export type CognitoUserStatus = z.infer<typeof CognitoUserStatusSchema>;

export interface AdminUserSummary {
  /** Cognito `sub` (UUID for native pool, opaque for federated IdPs). */
  sub: string;
  /** Cognito username — typically the email locally, opaque for federated. */
  username: string;
  email: string | null;
  emailVerified: boolean;
  status: CognitoUserStatus;
  groups: PlatformGroup[];
  /** ISO timestamp of pool-level user creation. */
  createdAt: string;
  /**
   * Best-effort last-modified marker. Cognito does not surface a true
   * "last login" timestamp; this mirrors `UserLastModifiedDate` which
   * changes on attribute updates + group changes too. Useful as a
   * coarse activity signal; do not treat as authoritative.
   */
  lastSeen: string | null;
}

export interface ListAdminUsersResponse {
  items: AdminUserSummary[];
  /** Cognito-issued opaque pagination token; null when last page. */
  nextCursor: string | null;
}

export const GrantGroupRequestSchema = z.object({
  group: PlatformGroupSchema,
});
export type GrantGroupRequest = z.infer<typeof GrantGroupRequestSchema>;

export interface AdminGroupAuditEntry {
  id: string;
  actorSub: string;
  actorUsername: string;
  targetSub: string;
  targetUsername: string;
  action: 'grant' | 'revoke';
  group: PlatformGroup;
  /** ISO timestamp. */
  timestamp: string;
}

export interface AdminUserDetail extends AdminUserSummary {
  /** Last 20 group-change events targeting this user, newest first. */
  recentAuditEvents: AdminGroupAuditEntry[];
}

// ---------------------------------------------------------------------------
// Admin — platform settings (#242).
//
// Single-row settings store. The MVP exposes only a maintenance
// banner; subsequent issues (#214 tool registry, #235 phase 2 tier-
// aware license defaults) will extend this shape.
// ---------------------------------------------------------------------------

export const MaintenanceBannerToneSchema = z.enum(['info', 'warning', 'danger']);
export type MaintenanceBannerTone = z.infer<typeof MaintenanceBannerToneSchema>;

export const MaintenanceBannerSchema = z.object({
  /** Plain-text message rendered above the site header. <= 280 chars. */
  message: z.string().min(1).max(280),
  tone: MaintenanceBannerToneSchema,
  /** ISO timestamp the banner becomes visible. */
  visibleFrom: z.string().datetime(),
  /**
   * ISO timestamp the banner stops being visible. Must be strictly
   * after `visibleFrom`. The public `/banner` endpoint hides the
   * banner once `now > visibleUntil`.
   */
  visibleUntil: z.string().datetime(),
});
export type MaintenanceBanner = z.infer<typeof MaintenanceBannerSchema>;

export const PlatformSettingsSchema = z.object({
  maintenanceBanner: MaintenanceBannerSchema.nullable(),
});
export type PlatformSettings = z.infer<typeof PlatformSettingsSchema>;

export interface PlatformSettingsResponse extends PlatformSettings {
  /** ISO timestamp of the last update. Null when settings are at default. */
  updatedAt: string | null;
  /** Cognito username of the admin who applied the most recent change. */
  updatedBy: string | null;
}

/** Public-facing banner payload exposed by `/v2/platform-settings/banner`. */
export interface PublicBannerResponse {
  banner: MaintenanceBanner | null;
}

export const tokens = {
  /** Phase B.A.1 added: Campaign, AnnotationToolIntegration (stub registry). */
  /** Phase B.A.2 will add: Task, TaskAssignment, Annotation, gate decisions. */
  /** Phase C will add: Challenge, Submission, Phase, Leaderboard */
  /** Phase D will add: Report, ReportTemplate, AuditEvent */
  /** Phase E will add: DMXP transaction envelope, FederatedConnector */
  /** PR E.2 will add: RemoteDataset, ListDatasetsQuery.source */
};

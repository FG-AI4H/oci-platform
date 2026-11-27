import { z } from 'zod';
import type { EmailDomainCategory } from './email-domain.js';
import { RouteReviewStatusSchema, ScoreAttributionSchema } from './evaluation-route.js';
import { IntendedUseStatementSchema as EvidenceIntendedUseSchema } from './intended-use.js';
import {
  ModelCardStatusSchema as EvidenceModelCardStatusSchema,
  SubmissionModelCardSchema,
} from './model-card.js';
import { RegulatoryPathwaySchema } from './regulatory-pathway.js';
import { DatasetSlugSchema } from './slug.js';
import type { DatasetSlug } from './slug.js';
import { MAX_PREDICTION_ROWS, PredictionRowSchema } from './predictions-file.js';
import { EvaluationTaskSlugSchema, SubmissionModeSchema } from './submission-validation.js';
import {
  DicomSeriesSampleSchema as DicomSeriesSampleSchemaLocal,
  DicomViewSchema as DicomViewSchemaLocal,
} from './dicom.js';
import {
  SubgroupDeclarationSchema,
  SubgroupFieldKeySchema,
  SubgroupFieldSchema,
  SubgroupValueCodeSchema,
  subgroupDeclarationIssues,
} from './evaluation-subgroups.js';

// Subgroup fields of an evaluation task and their validation (#410, ADR-0030).
export {
  MAX_SUBGROUP_FIELDS,
  MAX_SUBGROUP_VALUES,
  MIN_SUBGROUP_CELL_SIZE,
  SubgroupDeclarationSchema,
  SubgroupFieldKeySchema,
  SubgroupFieldSchema,
  SubgroupFieldsSchema,
  SubgroupItemValuesSchema,
  SubgroupValueCodeSchema,
  SubgroupValueSchema,
  subgroupDeclarationIssues,
} from './evaluation-subgroups.js';
export type {
  SubgroupDeclaration,
  SubgroupField,
  SubgroupItemValues,
  SubgroupValue,
} from './evaluation-subgroups.js';

export { RegulatoryPathwaySchema } from './regulatory-pathway.js';
export { DatasetSlugSchema } from './slug.js';
export type { DatasetSlug } from './slug.js';

// Toolsets: a fourth catalogue, listed by reference (ADR-0031, #830).
export {
  ChangeToolsetStatusRequestSchema,
  CreateToolsetRequestSchema,
  ListToolsetsQuerySchema,
  MAX_TOOLSET_LINKS,
  RESERVED_TOOLSET_SLUGS,
  ToolsetKindSchema,
  ToolsetSlugSchema,
  ToolsetStatusSchema,
  UpdateToolsetRequestSchema,
  canEditToolset,
  toolsetMovesFor,
  toolsetVisibleTo,
} from './toolset.js';
export type {
  ChangeToolsetStatusRequest,
  CreateToolsetRequest,
  ListMyToolsetsResponse,
  ListToolsetsQuery,
  ListToolsetsResponse,
  ToolsetActor,
  ToolsetKind,
  ToolsetResponse,
  ToolsetSlug,
  ToolsetStatus,
  ToolsetSummary,
  UpdateToolsetRequest,
} from './toolset.js';
export {
  SubmissionModeSchema,
  EvaluationTaskSlugSchema,
  SubmissionValidationCheckNameSchema,
  SubmissionValidationCheckSchema,
  SubmissionValidationItemIdSummarySchema,
  SubmissionValidationReportSchema,
} from './submission-validation.js';
export type {
  SubmissionMode,
  EvaluationTaskSlug,
  SubmissionValidationCheckName,
  SubmissionValidationCheck,
  SubmissionValidationItemIdSummary,
  SubmissionValidationReport,
} from './submission-validation.js';
export type { RegulatoryPathway } from './regulatory-pathway.js';

// Agreement between readers and the export of a campaign's annotations (#648).
export {
  AGREEMENT_MIN_TASKS,
  ANNOTATION_EXPORT_COLUMNS,
  AgreementCoefficientStatusSchema,
  AnnotationExportRowSchema,
  AnnotationExportSchema,
  CampaignAgreementSchema,
  ExportGateSchema,
  ExportTaskStatusSchema,
  KappaIntervalSchema,
  PairwiseAgreementSchema,
  ReaderLabelCountsSchema,
  ReaderPseudonymSchema,
} from './campaign-agreement.js';
export type {
  AgreementCoefficientStatus,
  AnnotationExport,
  AnnotationExportRow,
  CampaignAgreement,
  ExportGate,
  ExportTaskStatus,
  KappaInterval,
  PairwiseAgreement,
  ReaderLabelCounts,
  ReaderPseudonym,
} from './campaign-agreement.js';

// Predictions files as a participant uploads them in the browser (#645): the
// CSV / JSON reader and the template a task hands out.
export {
  MAX_ITEM_ID_LENGTH,
  MAX_PREDICTION_LABEL,
  MAX_PREDICTION_ROWS,
  MAX_REPORTED_FILE_ISSUES,
  PREDICTIONS_CSV_DELIMITERS,
  PREDICTIONS_CSV_HEADER,
  PREDICTIONS_CSV_HEADER_WITH_SCORE,
  PredictionRowSchema,
  parsePredictionsFile,
  predictionsTemplateCsv,
} from './predictions-file.js';
export type {
  PredictionRow,
  PredictionsCsvDelimiter,
  PredictionsFileFormat,
  PredictionsFileIssue,
  PredictionsFileOptions,
  PredictionsFileParseResult,
} from './predictions-file.js';

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

// Request body limits of the API (#741): enforced by the API, checked by the
// scripts that call it.
export {
  DEFAULT_REQUEST_BODY_LIMIT_BYTES,
  MANIFEST_PUBLISH_BODY_LIMIT_BYTES,
  PREDICTIONS_SUBMISSION_BODY_LIMIT_BYTES,
  formatByteLimit,
} from './request-limits.js';

// DICOM series read endpoints (#674, ADR-0026).
export {
  DicomFindingRefSchema,
  DicomSeriesDetailSchema,
  DicomSeriesInstanceSchema,
  DicomSeriesListSchema,
  DicomSeriesSummarySchema,
  DicomSeriesVersionQuerySchema,
  DicomSeriesSampleSchema,
  DicomViewSchema,
  RecordDicomFindingDecisionRequestSchema,
  answerViewProblems,
  dicomSeriesSampleRef,
  parseDicomSeriesSampleRef,
} from './dicom.js';
export type {
  DicomFindingDecisionResult,
  DicomFindingDecisionSummary,
  DicomFindingRef,
  DicomFindingsReview,
  DicomHeldDatasetList,
  DicomHeldDatasetSummary,
  DicomSeriesDetail,
  DicomSeriesInstance,
  DicomSeriesList,
  DicomSeriesSummary,
  DicomUndecidedFinding,
  DicomSeriesSample,
  DicomSeriesTaskCandidate,
  DicomView,
  DicomViewerSeries,
  RecordDicomFindingDecisionRequest,
} from './dicom.js';

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

// Evaluation task-kind + model-class — extensibility door-openers locked
// by ADR-0015. Separate from the closed-by-design annotation
// `CampaignTaskKind`: evaluation is open (LMM door open), annotation is
// closed (routing invariants in ADR-0009).
export {
  KNOWN_EVALUATION_TASK_KINDS,
  VENDOR_TASK_KIND_PATTERN,
  EvaluationTaskKindSchema,
  ModelClassSchema,
  isKnownEvaluationTaskKind,
  isLmmTaskKind,
  requiresLmmGovernance,
} from './evaluation-task-kind.js';
export type {
  KnownEvaluationTaskKind,
  EvaluationTaskKind,
  ModelClass,
} from './evaluation-task-kind.js';

// Intended-Use Statement + IMDRF risk-tier derivation (ADR-0013).
// Single source of truth — the BIOCroissant manifest schema imports
// this module rather than redefining the shape.
export {
  RiskTierSchema,
  RISK_TIER_RANK,
  MedicalPurposeSchema,
  ClinicalPathwaySchema,
  OperatingEnvironmentSchema,
  IntendedUserRoleSchema,
  TargetPopulationSchema,
  IntendedUseStatementSchema,
  RiskTierReasonSchema,
  deriveRiskTier,
  explainRiskTier,
  overrideRequiresJustification,
} from './intended-use.js';

// Model Card — AI-submission carrier; the IUS attaches here (#260, ADR-0013/0015).
export {
  CreateModelCardRequestSchema,
  ModelCardResponseSchema,
  ModelCardStatusSchema,
  ChangeModelCardStatusRequestSchema,
  PublicModelCardSchema,
  ModelCardSlugSchema,
  ListModelCardsQuerySchema,
  ListModelCardsSortSchema,
  RegulatoryApprovalSchema,
  UpdateModelCardRequestSchema,
  MODEL_CARD_REVIEWER_GROUPS,
  RESERVED_MODEL_CARD_SLUGS,
  allowedTransitionsFrom,
  canTransition,
  canEditModelCard,
  isModelCardReviewerGroups,
  mayMoveModelCard,
  modelCardMovesFor,
  modelCardVisibleTo,
  modelCardLinkRefusal,
  SubmissionModelCardSchema,
  LinkSubmissionModelCardRequestSchema,
  LinkSubmissionModelCardResponseSchema,
} from './model-card.js';
export type {
  CreateModelCardRequest,
  ModelCardResponse,
  ModelCardStatus,
  ChangeModelCardStatusRequest,
  RegulatoryApproval,
  PublicModelCard,
  ModelCardSlug,
  ListModelCardsQuery,
  ListModelCardsSort,
  ModelCardSummary,
  ListModelCardsResponse,
  UpdateModelCardRequest,
  ModelCardActor,
  MyModelCardSummary,
  ListMyModelCardsResponse,
  ModelCardLinkRefusal,
  SubmissionModelCard,
  LinkSubmissionModelCardRequest,
  LinkSubmissionModelCardResponse,
} from './model-card.js';

// EvaluationRoute — privacy-preserving evaluation solutions (WP5, #412, ADR-0018).
export {
  RoutePartySchema,
  ThreatModelSchema,
  DisclosureProfileSchema,
  OperationalEnvelopeSchema,
  RouteReviewStatusSchema,
  PUBLISHABLE_REVIEW_STATUSES,
  RETRACTING_REVIEW_STATUSES,
  allowedReviewTransitionsFrom,
  canReviewTransition,
  declarationsAreFrozen,
  REVIEW_STATUSES_REQUIRING_RATIONALE,
  reviewNeedsRationale,
  RESERVED_ROUTE_SLUGS,
  CreateEvaluationRouteRequestSchema,
  CreateRouteVersionRequestSchema,
  ReviewRouteVersionRequestSchema,
  RouteReviewBarSchema,
  RoutePermissionsResponseSchema,
  RouteVersionResponseSchema,
  EvaluationRouteResponseSchema,
  ScoreAttributionSchema,
  LEGACY_ATTRIBUTION_NOTE,
  NO_METHOD_VERSION_CODE,
  NoMethodVersionReasonSchema,
  NoMethodVersionRefusalSchema,
} from './evaluation-route.js';
export type {
  RouteParty,
  ThreatModel,
  DisclosureProfile,
  OperationalEnvelope,
  RouteReviewStatus,
  CreateEvaluationRouteRequest,
  CreateRouteVersionRequest,
  ReviewRouteVersionRequest,
  RouteReviewBar,
  RoutePermissionsResponse,
  RouteVersionResponse,
  EvaluationRouteResponse,
  ScoreAttribution,
  NoMethodVersionReason,
  NoMethodVersionRefusal,
} from './evaluation-route.js';

// Capability document (#590) — `/.well-known/oci-capabilities.json`, grouped
// by the AI for Good Sandbox's Discover / Publish / Trust / Operate verbs.
export {
  CapabilityVerbSchema,
  CapabilityAuthSchema,
  CapabilityEntrySchema,
  CapabilityGroupSchema,
  CapabilityStandardSchema,
  OciCapabilitiesDocumentSchema,
} from './capabilities.js';
export type {
  CapabilityVerb,
  CapabilityAuth,
  CapabilityEntry,
  CapabilityGroup,
  CapabilityStandard,
  OciCapabilitiesDocument,
} from './capabilities.js';

// EvalAI seam intake (WP4, #408).
export {
  SeamPredictionSchema,
  SeamIntakeRequestSchema,
  SeamIntakeResponseSchema,
  intentForPhase,
} from './evalai-seam.js';
export type { SeamIntakeRequest, SeamIntakeResponse } from './evalai-seam.js';

// Model Facts Label (#261) — a WHO Fig. 7 rendering of the canonical ModelCard.
export {
  ModelFactsLabelSchema,
  ModelFactsPerformanceEntrySchema,
  ModelFactsStandingSchema,
} from './model-facts-label.js';
export type {
  ModelFactsLabel,
  ModelFactsPerformanceEntry,
  ModelFactsStanding,
} from './model-facts-label.js';

// Audit trail reader (#653, ADR-0014).
export {
  AUDIT_EXPORT_MAX,
  AUDIT_PAGE_DEFAULT,
  AUDIT_PAGE_MAX,
  AUDIT_PSEUDONYM_PATTERN,
  AuditActorFilterSchema,
  AuditEventFiltersSchema,
  AuditEventsQuerySchema,
  AuditVerifyQuerySchema,
} from './audit.js';
export type {
  AuditActor,
  AuditActorView,
  AuditChainBreakKind,
  AuditChainVerification,
  AuditEventFilters,
  AuditEventPage,
  AuditEventView,
  AuditEventsExport,
  AuditEventsQuery,
  AuditVerifyQuery,
} from './audit.js';
export type {
  RiskTier,
  MedicalPurpose,
  ClinicalPathway,
  OperatingEnvironment,
  IntendedUserRole,
  TargetPopulation,
  IntendedUseStatement,
  RiskTierInput,
  RiskTierReason,
} from './intended-use.js';

// ==== Identity ============================================================

export const RoleSchema = z.enum([
  'admin',
  'host',
  'participant',
  'annotator',
  'reviewer',
  'evaluation-reviewer',
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
 * A user identity as the API serialises it: `identity.users.id`, derived
 * from the Cognito subject by `cognitoSubAsUuid` (an 8-4-4-4-12 hex
 * string passes through, anything else is hashed to a v5 UUID). Cognito
 * subjects are not RFC 9562 UUIDs: the variant nibble is whatever the
 * pool mints (`e3b418e2-f0a1-70fd-524a-8a6c453745c2` has a `5` where the
 * RFC wants 8–b), so `z.uuid()` rejects real accounts. Validate the
 * shape, not the version bits.
 */
export const UserIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'expected a user id (8-4-4-4-12 hex)',
  );
export type UserId = z.infer<typeof UserIdSchema>;

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
  /**
   * Human-readable filename, derived server-side — there is no
   * `filename` column on the row, so this can never drift from the
   * bytes. Basename of `s3Key` for platform-hosted rows, else the
   * basename of `contentUrl`'s path when that reads as a filename,
   * else `null`. Always a single path segment: no separators, no
   * leading dot, never `..`.
   *
   * The detail page renders this instead of `croissantId`, which for
   * uploaded rows is a bare UUID.
   */
  filename: z.string().nullable(),
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
  hostId: UserIdSchema,
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
/**
 * Anonymisation level of a dataset — the four-level HIPAA-aligned scale
 * BIOCroissant v0.1 uses for `bio:anonymizationLevel` (IDENTIFIED →
 * LIMITED → DEIDENTIFIED → ANONYMIZED). Shared by the catalogue list
 * filter, the publish wizard and the API so no surface can offer a value
 * a valid manifest cannot carry (#509; the old three-value set had
 * `PSEUDONYMIZED`, which the validator rejects — `DEIDENTIFIED` is the
 * BIOCroissant spelling for pseudonymised data).
 */
export const AnonymizationLevelSchema = z.enum([
  'IDENTIFIED',
  'LIMITED',
  'DEIDENTIFIED',
  'ANONYMIZED',
]);
export type AnonymizationLevel = z.infer<typeof AnonymizationLevelSchema>;

export const ListDatasetsQuerySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  visibility: DatasetVisibilitySchema.optional(),
  status: DatasetStatusSchema.optional(),
  hostId: UserIdSchema.optional(),
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
  anonymizationLevel: AnonymizationLevelSchema.optional(),
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
  /**
   * Catalogue access tier (ADR-0003 Decision 2): the identity level a
   * requester needs. The host decides it, like visibility. Omitted → the
   * DB default `OPEN`.
   */
  accessTier: AccessTierSchema.optional(),
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
 * Anonymisation level (BioCroissant). The four-level HIPAA-aligned scale
 * the validator's `bio:anonymizationLevel` accepts — the same set the
 * `bio-prov` de-identification activity's `resultingLevel` must equal
 * (#496). The previous three-value set carried `PSEUDONYMIZED`, which
 * the validator rejects; `DEIDENTIFIED` is the BIOCroissant spelling.
 */
export const ManifestWizardAnonymizationLevelSchema = AnonymizationLevelSchema;
export type ManifestWizardAnonymizationLevel = z.infer<
  typeof ManifestWizardAnonymizationLevelSchema
>;

// ---- Provenance step (bio-prov v0.1, #496) ---------------------------------
//
// Dataset-level answers to the first four questions of the profile
// (`docs/standards/bio-prov-v0.1.md`, section 1): where the data came
// from, what was done to it, under what authority, how the ground truth
// was produced. This schema checks *shape* only (lengths, date and
// country formats, integer counts). Which blocks a dataset MUST fill
// depends on its access tier and is decided by the `provenance`
// validator layer of `@oci/croissant`, not here — so every field
// accepts the empty string and the builder omits what is blank.

const isoDateOrBlank = (v: string): boolean => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);
const countryOrBlank = (v: string): boolean => v === '' || /^[A-Z]{2}$/.test(v);

/** A calendar date (`YYYY-MM-DD`) or blank. */
const WizardDateSchema = z.string().max(10).refine(isoDateOrBlank, 'expected ISO date YYYY-MM-DD');

/** H4 — the pass that produced the declared anonymisation level. */
export const ManifestWizardDeidentificationMethodSchema = z.enum([
  'SAFE_HARBOR',
  'EXPERT_DETERMINATION',
  'PSEUDONYMISATION',
  'SYNTHETIC',
  'NONE',
]);
export type ManifestWizardDeidentificationMethod = z.infer<
  typeof ManifestWizardDeidentificationMethodSchema
>;

/** H1 — one contributing site. `country` is ISO 3166-1 alpha-2. */
export const ManifestWizardSourceSiteSchema = z.object({
  name: z.string().max(200),
  country: z.string().max(2).refine(countryOrBlank, 'expected an ISO 3166-1 alpha-2 country code'),
});
export type ManifestWizardSourceSite = z.infer<typeof ManifestWizardSourceSiteSchema>;

export const ManifestWizardProvenanceSchema = z.object({
  /** P1 — `prov:wasAttributedTo` a `prov:Organization`. `id` is a ROR / GRID / institution URL. */
  sourceOrganization: z.object({
    name: z.string().max(200),
    id: z.string().max(2000),
  }),
  /**
   * P2 / P4 — the dated collection (or derivation) activity and the agent
   * that ran it. A blank `agentName` falls back to the source organisation.
   */
  collection: z.object({
    name: z.string().max(500),
    startedAt: WizardDateSchema,
    endedAt: WizardDateSchema,
    agentName: z.string().max(200),
    /** When true the agent is emitted as a `prov:SoftwareAgent` acting on behalf of the source organisation. */
    agentIsSoftware: z.boolean(),
  }),
  /** P3 — IRI (a DOI is preferred) of the upstream dataset, when this one is derived. */
  derivedFrom: z.string().max(2000),
  /** H1 */
  sites: z.array(ManifestWizardSourceSiteSchema).max(50),
  /** H2 — `rai:dataCollectionTimeframe`, the human account of when data was collected. */
  collectionTimeframe: z.string().max(500),
  /** H3 — a device class term (DICOM modality, GMDN) and/or the acquisition equipment. */
  deviceClass: z.string().max(200),
  equipment: z.object({
    manufacturer: z.string().max(200),
    model: z.string().max(200),
    softwareVersion: z.string().max(100),
  }),
  /** H4 — `resultingLevel` is kept equal to `anonymizationLevel` by the builder. */
  deidentification: z.object({
    method: z.union([ManifestWizardDeidentificationMethodSchema, z.literal('')]),
    endedAt: WizardDateSchema,
    /** `tool@version` of the de-identification software, when one ran. */
    toolName: z.string().max(200),
  }),
  /** H5 — `bio:irbApproval`. */
  ethics: z.object({
    approvingBody: z.string().max(300),
    approvalNumber: z.string().max(200),
    approvalDate: WizardDateSchema,
    /** Whether the approval covers evaluation of third-party AI models (spec H5). */
    approvalScope: z.string().max(2000),
  }),
  /** H6 — `bio:labelProtocol`. */
  labelProtocol: z.object({
    version: z.string().max(200),
    labelScale: z.string().max(500),
    gradersPerItem: z.number().int().min(1).max(1000).optional(),
    graderQualification: z.string().max(500),
    adjudication: z.string().max(500),
    interRaterAgreement: z.object({
      metric: z.string().max(100),
      value: z.number().optional(),
    }),
    perRaterLabelsRetained: z.boolean().optional(),
  }),
});
export type ManifestWizardProvenance = z.infer<typeof ManifestWizardProvenanceSchema>;

/** The provenance step's initial state: every field blank. */
export function emptyManifestWizardProvenance(): ManifestWizardProvenance {
  return {
    sourceOrganization: { name: '', id: '' },
    collection: { name: '', startedAt: '', endedAt: '', agentName: '', agentIsSoftware: false },
    derivedFrom: '',
    sites: [],
    collectionTimeframe: '',
    deviceClass: '',
    equipment: { manufacturer: '', model: '', softwareVersion: '' },
    deidentification: { method: '', endedAt: '', toolName: '' },
    ethics: { approvingBody: '', approvalNumber: '', approvalDate: '', approvalScope: '' },
    labelProtocol: {
      version: '',
      labelScale: '',
      gradersPerItem: undefined,
      graderQualification: '',
      adjudication: '',
      interRaterAgreement: { metric: '', value: undefined },
      perRaterLabelsRetained: undefined,
    },
  };
}

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

  // Step 4 — Provenance (bio-prov v0.1, #496). Present whenever the host
  // went through the guided flow; the builder then emits the profile
  // marker and whichever blocks were filled. Absent for callers that
  // predate the step.
  provenance: ManifestWizardProvenanceSchema.optional(),

  // Step 5 — Data use (DUO) — required for non-PUBLIC datasets per
  // publish-time fail-closed (J.1 decision #2). The wizard nudges the
  // host to pick at least one for every visibility level except PUBLIC.
  duoTerms: z.array(DuoTermIdSchema).max(20).default([]),

  // Step 6 — Distributions
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
  /**
   * Outcome of the header check when the file is DICOM (ADR-0026), null
   * when it is not. `HELD` and `UNREADABLE` mean the file is visible to
   * its host and to platform operators only, until an operator decides.
   * Optional so that responses recorded before the check still parse.
   */
  dicomCheckStatus?: DicomCheckStatus | null;
}

/** See `UploadedDistribution.dicomCheckStatus`. */
export type DicomCheckStatus = 'CLEAR' | 'HELD' | 'RELEASED' | 'UNREADABLE';

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

// RegulatoryPathwaySchema moved to ./regulatory-pathway.js (#432) — re-exported
// from the import block at the top of this file so its public API is unchanged.

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
 * Submission-completeness enforcement mode (#231). Determines what
 * happens when an annotator submits a structurally-valid payload
 * that's semantically incomplete (e.g. bbox without a label,
 * segmentation mask with zero pixels marked).
 *
 *   - `soft-warn` (default): API records the submission, supervisor
 *     inbox flags it for review; the gate-1 / arbitration flow
 *     still progresses.
 *   - `hard-block`: API rejects the submission with 422 + structured
 *     reasons; the annotator must fix and resubmit.
 */
export const CampaignCompletenessModeSchema = z.enum(['soft-warn', 'hard-block']);
export type CampaignCompletenessMode = z.infer<typeof CampaignCompletenessModeSchema>;

/**
 * Per-tier default output license (#235, ADR-0012 Decision 3).
 *
 *   OPEN / REGISTERED → CC-BY-4.0     (permissive; matches the
 *                                      datasets these tiers serve)
 *   CONTROLLED        → CC-BY-NC-4.0  (non-commercial — matches the
 *                                      access-control rationale of
 *                                      the tier)
 *   SENSITIVE         → custom-restricted  (the manager MUST attach a
 *                                          clause set; SENSITIVE is
 *                                          never a one-click default)
 *
 * Pure function — shared with the campaign-create UI so the form's
 * license picker pre-selects the right value once the manager picks
 * a dataset.
 */
export function defaultOutputLicenseForTier(tier: AccessTier): CampaignOutputLicense {
  if (tier === 'OPEN' || tier === 'REGISTERED') return 'CC-BY-4.0';
  if (tier === 'CONTROLLED') return 'CC-BY-NC-4.0';
  return 'custom-restricted';
}

/**
 * Validate a chosen output license against the dataset's
 * commercial-use terms (#235, ADR-0012 Decision 3). Returns null
 * when the combination is allowed; a reason string when it isn't.
 *
 * Rule: a `NON_COMMERCIAL_ONLY` dataset can only produce outputs
 * that disallow commercial use. The OCI shortlist of NCU-compatible
 * licenses today is `CC-BY-NC-4.0` and `custom-restricted` (the
 * `custom-restricted` shape lets the campaign manager write the
 * NCU restriction explicitly). `CC-BY-SA-4.0` would inherit the
 * NCU constraint to downstream users only if every downstream
 * derived work also forbids commercial use — too brittle to rely
 * on, so we reject. `OK` and `CASE_BY_CASE` accept any license;
 * `CASE_BY_CASE` is a soft signal that requires host review
 * downstream (the access-request matcher handles that).
 */
export function outputLicenseAllowedForTerms(
  license: CampaignOutputLicense,
  terms: CommercialUseTerms,
): string | null {
  if (terms !== 'NON_COMMERCIAL_ONLY') return null;
  if (license === 'CC-BY-NC-4.0' || license === 'custom-restricted') return null;
  return (
    `Dataset terms are NON_COMMERCIAL_ONLY; the campaign output license '${license}' would ` +
    `permit commercial reuse downstream. Pick 'CC-BY-NC-4.0' or 'custom-restricted' with an ` +
    `explicit NCU clause set.`
  );
}

/** Bounds on `nAnnotators` (ADR-0009 Decision 2), shared with the campaign-create form. */
export const N_ANNOTATORS_MIN = 1;
export const N_ANNOTATORS_MAX = 12;

/**
 * The "cannot assess" answer a CLASSIFICATION campaign may offer (#646).
 * Reserved: no declared label may use this value.
 */
export const CANNOT_ASSESS_LABEL = 'cannot-assess';

/** One answer a reader can give on a CLASSIFICATION campaign (#646). */
export const ClassificationLabelSchema = z.object({
  /** Stored in the submission as `label`. Lower-case, digits, `-` and `_`. */
  value: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'use lower-case letters, digits, "-" or "_"')
    .refine((v) => v !== CANNOT_ASSESS_LABEL, `"${CANNOT_ASSESS_LABEL}" is reserved`),
  /** What the reader sees. */
  display: z.string().trim().min(1).max(120),
});
export type ClassificationLabel = z.infer<typeof ClassificationLabelSchema>;

/**
 * The answers a CLASSIFICATION campaign offers, declared at creation
 * (#646). The order is the order readers see, and the number key that
 * picks each one.
 */
export const ClassificationLabelsConfigSchema = z
  .object({
    labels: z.array(ClassificationLabelSchema).min(2).max(9),
    /** Offer "Cannot assess" after the labels. */
    cannotAssess: z.boolean().default(false),
    /** Let readers add a free-text comment. */
    allowComment: z.boolean().default(false),
  })
  .refine((c) => new Set(c.labels.map((l) => l.value)).size === c.labels.length, {
    message: 'label values must be unique',
    path: ['labels'],
  });
export type ClassificationLabelsConfig = z.infer<typeof ClassificationLabelsConfigSchema>;

/** Longest comment a reader may attach to a label. */
export const LABEL_COMMENT_MAX = 2000;

/**
 * Check a `{ label, comment, view? }` submission against the campaign's
 * declared labels (#646). `view` is optional: a DICOM answer stores what
 * the viewer had on screen (`DicomViewSchema`); an image answer leaves
 * it out. Returns the reasons it is refused; empty when
 * it is accepted. Shared by the API (which refuses) and the web form.
 *
 * At arbitration the arbiter must also say why they chose the final
 * label: pass `reasonRequired` and the submission must carry a
 * non-empty `reason`. Readers never send one.
 */
export function labelSubmissionProblems(
  config: ClassificationLabelsConfig,
  submission: Record<string, unknown>,
  options: { reasonRequired?: boolean } = {},
): string[] {
  const problems: string[] = [];
  const reasonRequired = options.reasonRequired ?? false;
  const allowed = new Set(config.labels.map((l) => l.value));
  if (config.cannotAssess) allowed.add(CANNOT_ASSESS_LABEL);
  const label = submission.label;
  if (typeof label !== 'string' || !allowed.has(label)) {
    problems.push(`label must be one of: ${[...allowed].join(', ')}`);
  }
  const comment = submission.comment;
  if (comment !== undefined && comment !== null && comment !== '') {
    if (!config.allowComment) problems.push('this campaign does not take comments');
    else if (typeof comment !== 'string') problems.push('comment must be text');
    else if (comment.length > LABEL_COMMENT_MAX) {
      problems.push(`comment must be at most ${LABEL_COMMENT_MAX} characters`);
    }
  }
  if (reasonRequired) {
    const reason = submission.reason;
    if (typeof reason !== 'string' || reason.trim() === '') {
      problems.push('give the reason for the final label');
    } else if (reason.length > LABEL_COMMENT_MAX) {
      problems.push(`reason must be at most ${LABEL_COMMENT_MAX} characters`);
    }
  }
  // What the screen showed when the reader answered (#674): kept for the
  // record and for reviewing a disagreement; agreement ignores it.
  if (submission.view !== undefined && !DicomViewSchemaLocal.safeParse(submission.view).success) {
    problems.push('view is not a valid record of the screen');
  }
  const fields = new Set(['label', 'comment', 'view', ...(reasonRequired ? ['reason'] : [])]);
  for (const key of Object.keys(submission)) {
    if (!fields.has(key)) problems.push(`unexpected field "${key}"`);
  }
  return problems;
}

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
  nAnnotators: z.number().int().min(N_ANNOTATORS_MIN).max(N_ANNOTATORS_MAX).default(3),
  /**
   * Per-campaign abandonment timeout (#229). An assignment that stays
   * PENDING / IN_PROGRESS past `assignedAt + taskTimeoutHours` is
   * auto-expired by the background sweeper so the slot frees up for
   * the next annotator. Default 24 h; range [1 h, 168 h = 7 d] per
   * the issue. Genuine work-life interruptions are common — no
   * penalty applies to the original assignee (calibrationStatus +
   * IRR untouched per the issue's "Decisions to make" section).
   */
  taskTimeoutHours: z.number().int().min(1).max(168).default(24),
  /**
   * Submission-completeness enforcement mode (#231). Defaults to
   * `soft-warn` — manager opts into `hard-block` on regulated
   * workflows where incomplete annotations are a liability.
   */
  completenessMode: CampaignCompletenessModeSchema.default('soft-warn'),
  /**
   * The answers a CLASSIFICATION campaign offers (#646). Required when
   * a CLASSIFICATION campaign is created; absent on other kinds and on
   * campaigns created before #646, which keep the free-form JSON form.
   */
  classificationLabels: ClassificationLabelsConfigSchema.optional(),
});
export type CampaignWorkflowConfig = z.infer<typeof CampaignWorkflowConfigSchema>;

/**
 * Smallest `nAnnotators` at which the campaign-create form shows the
 * cost estimate (ADR-0009 Decision 2: "when N > 5"). Distinct from the
 * 8–12 justification threshold (#222).
 */
export const COST_ESTIMATE_MIN_N = 6;

/**
 * Whether the campaign-create form shows the cost estimate for this N:
 * a finite N inside [N_ANNOTATORS_MIN, N_ANNOTATORS_MAX] and at least
 * COST_ESTIMATE_MIN_N. An out-of-range N shows the range error instead.
 */
export function shouldShowCostEstimate(n: number): boolean {
  return (
    Number.isFinite(n) && n >= N_ANNOTATORS_MIN && n <= N_ANNOTATORS_MAX && n >= COST_ESTIMATE_MIN_N
  );
}

export interface CampaignEventsEstimateInput {
  nAnnotators: number;
  /** Expected number of samples. Not persisted; the form asks for it only to feed the estimate. */
  sampleCount: number;
}

export interface CampaignEventsEstimate {
  /** Exactly N × samples: every gate-1 annotator labels every sample. */
  gate1Events: number;
  /** At most one arbitration per sample (gate 2 runs only when gate 1 disagrees). */
  maxArbitrationEvents: number;
  /** At most one expert review per sample (gate 3 runs only when arbitration escalates). */
  maxExpertEvents: number;
  /** Worst case, every sample disagreeing: gate 1 plus the gate-2 and gate-3 maxima. */
  totalProjectedEvents: number;
}

/**
 * Projected annotation events for a campaign under the 3-gate SOP
 * (#311, ADR-0009 Decision 2). Event counts, not money: OCI has no
 * per-event rate. Gates 2 and 3 are upper bounds because there is no
 * disagreement rate to project with; for N = 1 (single-rater shortcut)
 * they never run. A missing, negative or non-finite sample count
 * yields zero events.
 */
export function estimateCampaignEvents({
  nAnnotators,
  sampleCount,
}: CampaignEventsEstimateInput): CampaignEventsEstimate {
  const n = Number.isFinite(nAnnotators) ? Math.max(0, Math.trunc(nAnnotators)) : 0;
  const samples = Number.isFinite(sampleCount) ? Math.max(0, Math.trunc(sampleCount)) : 0;
  const gate1Events = n * samples;
  const laterGatesRun = n > 1;
  const maxArbitrationEvents = laterGatesRun ? samples : 0;
  const maxExpertEvents = laterGatesRun ? samples : 0;
  return {
    gate1Events,
    maxArbitrationEvents,
    maxExpertEvents,
    totalProjectedEvents: gate1Events + maxArbitrationEvents + maxExpertEvents,
  };
}

/**
 * Per-task-kind completeness predicate (#231).
 *
 * Pure function shared with the annotator UI so the same warnings
 * surface client- and server-side. Rules are intentionally generous
 * today — they fire only on obviously-incomplete submissions
 * (missing label, empty array). The #214 tool-integration registry
 * will eventually let task definitions ship richer `schemaProfile`
 * Zod schemas; until then this is the cross-task minimum.
 *
 * A submission with `noFindings: true` is always complete — that's
 * the explicit "this sample has nothing to annotate" path that
 * differentiates a deliberate empty annotation from an oversight.
 */
export interface CompletenessResult {
  complete: boolean;
  reasons: string[];
}

export function evaluateCompleteness(
  taskKind: CampaignTaskKind,
  submission: Record<string, unknown>,
): CompletenessResult {
  if (submission.noFindings === true) {
    return { complete: true, reasons: [] };
  }
  const reasons: string[] = [];
  switch (taskKind) {
    case 'CLASSIFICATION':
    case 'MULTI_MODAL': {
      const label = submission.label;
      if (typeof label !== 'string' || label.trim().length === 0) {
        reasons.push('expected a non-empty `label` string (or `noFindings: true`)');
      }
      break;
    }
    case 'DETECTION':
    case 'LOCALIZATION': {
      const boxes = submission.boxes;
      if (!Array.isArray(boxes) || boxes.length === 0) {
        reasons.push(
          'expected a non-empty `boxes` array of detected regions (or `noFindings: true`)',
        );
      }
      break;
    }
    case 'SEGMENTATION': {
      // Until the tool-integration registry (#214) gives us real
      // mask payloads, treat `maskUrl` as the carrier. The
      // mask-pixel check is deferred — when bytes / a NIfTI URL
      // arrive, slice-3 follow-up can read them.
      const maskUrl = submission.maskUrl;
      if (typeof maskUrl !== 'string' || maskUrl.trim().length === 0) {
        reasons.push('expected a non-empty `maskUrl` (or `noFindings: true`)');
      }
      break;
    }
  }
  return { complete: reasons.length === 0, reasons };
}

/**
 * Quality config (#216, ADR-0008): per-campaign IRR metric +
 * agreement threshold consumed by the workflow engine at the gate-1
 * decision-box. If `IRR ≥ threshold` across the N independent
 * submissions, the task skips arbitration and auto-completes;
 * otherwise it escalates to AWAITING_ARBITRATION (per ADR-0008
 * gate-1 → gate-2 semantics).
 *
 * First cut surfaces three metrics — the set slice 3 actually
 * consumes. Krippendorff α (#289), Hausdorff / ICC / Euclidean
 * (#290), gold-standard sample handling (#291), and calibration-
 * drift detection (#292) extend this enum as they ship.
 */
export const AnnotationQualityMetricSchema = z.enum([
  'cohens-kappa',
  'fleiss-kappa',
  'dice',
  /** Krippendorff's α with the nominal δ² (#289). Reduces to Fleiss-like behaviour on full-coverage data. */
  'krippendorff-alpha-nominal',
  /** Krippendorff's α with the ordinal δ² (#289). Closer-but-not-equal disagreements weighted less. */
  'krippendorff-alpha-ordinal',
  /** Krippendorff's α with the interval δ² (#289). Numeric scales — δ² = (a-b)². */
  'krippendorff-alpha-interval',
  /** Hausdorff (strict) — worst-case boundary mismatch for segmentation contours (#290). */
  'hausdorff',
  /** Hausdorff at the 95th percentile — outlier-robust variant of the above (#290). */
  'hausdorff-95',
  /** ICC(2,1) absolute-agreement for continuous ratings (#290). */
  'icc-2-1',
  /** Euclidean-distance-based agreement score in [0, 1] for vector outputs (#290). */
  'euclidean-agreement',
]);
export type AnnotationQualityMetric = z.infer<typeof AnnotationQualityMetricSchema>;

export const CampaignQualityConfigSchema = z.object({
  /**
   * IRR metric used at gate 1. Defaults match ADR-0008:
   * `fleiss-kappa` for categorical tasks, `dice` for segmentation —
   * but the workflow engine never relies on the default, it always
   * reads the row.
   */
  metric: AnnotationQualityMetricSchema.default('fleiss-kappa'),
  /**
   * Agreement threshold in [0, 1]. ADR-0008 leaves the floor to
   * campaign managers — 0.6 ("substantial" per Landis & Koch) is a
   * common starting point but no value is mandated.
   */
  threshold: z.number().min(0).max(1).default(0.6),
});
export type CampaignQualityConfig = z.infer<typeof CampaignQualityConfigSchema>;

// ---------------------------------------------------------------------------
// Metadata-exposure + blinding engine (ADR-0010 Decisions 1 + 2 + 4).
//
// Four buckets decide what an annotator sees, per field, per gate:
//   required — always shipped (modality, body part, view, slice index…)
//   optional — hidden at gate 1; shown at gate 2/3 (age bin, sex, site…)
//   hidden   — hidden by default; the manager may promote individual
//              fields per gate (prior diagnoses, radiology reports,
//              peer labels, scanner make, demographic facets…)
//   never    — PHI / direct identifiers; SERVER-SIDE FILTERED regardless
//              of campaign config (the 18 HIPAA Safe-Harbor identifiers)
//
// `never` is a hard floor: if the OCI default table or the dataset's
// Croissant `oci:annotationVisibility` tag classifies a field `never`,
// no campaign-manager override can ever expose it. Default-hide is the
// stance for unknown fields — priming bias is real and the burden is
// flipped onto opting fields *in*, not out.
// ---------------------------------------------------------------------------

export const MetadataVisibilityBucketSchema = z.enum(['required', 'optional', 'hidden', 'never']);
export type MetadataVisibilityBucket = z.infer<typeof MetadataVisibilityBucketSchema>;

/**
 * Gate-progressive unblinding (ADR-0010 Decision 2). The deeper the
 * review, the more context the reviewer needs. Mapped from the
 * `AnnotationGateState` machine: INDEPENDENT → independent,
 * AWAITING_ARBITRATION → arbitration, AWAITING_EXPERT → expert.
 */
export const MetadataVisibilityGateSchema = z.enum(['independent', 'arbitration', 'expert']);
export type MetadataVisibilityGate = z.infer<typeof MetadataVisibilityGateSchema>;

/**
 * Map an `AnnotationGateState` value to the visibility gate that
 * governs what the annotator sees while working it. COMPLETED /
 * SKIPPED (and any unknown value) have no live annotator view, so they
 * resolve to the most conservative gate (`independent`) — a stray
 * handoff can never widen exposure.
 */
export function visibilityGateForGateState(gateState: string): MetadataVisibilityGate {
  switch (gateState) {
    case 'AWAITING_ARBITRATION':
      return 'arbitration';
    case 'AWAITING_EXPERT':
      return 'expert';
    default:
      return 'independent';
  }
}

/**
 * Per-field campaign-manager rule (ADR-0010 Decision 1, source-of-truth
 * priority 1). `rationale` is required by the UI when a manager
 * promotes a field out of `hidden`; `promotedAtGates` lists the gates
 * at which an `optional`/`hidden` field becomes visible beyond the
 * gate defaults (e.g. an expert seeing prior diagnoses at gate 3).
 */
export const FieldVisibilityRuleSchema = z.object({
  bucket: MetadataVisibilityBucketSchema,
  rationale: z.string().max(500).optional(),
  promotedAtGates: z.array(MetadataVisibilityGateSchema).default([]),
});
export type FieldVisibilityRule = z.infer<typeof FieldVisibilityRuleSchema>;

/**
 * Campaign metadata-visibility config (ADR-0010 Decisions 1 + 2).
 * Stored as JSONB on the campaign, versioned by content hash (same
 * pattern as the workflow config). `fieldOverrides` maps a metadata
 * field name to a manager rule; fields absent here fall through to the
 * Croissant tag, then the OCI default table. `trainingGrade` lets
 * calibration-only campaigns promote more fields at gate 1.
 */
export const CampaignVisibilityConfigSchema = z.object({
  version: z.string().min(1),
  fieldOverrides: z.record(z.string(), FieldVisibilityRuleSchema).default({}),
  trainingGrade: z.boolean().default(false),
});
export type CampaignVisibilityConfig = z.infer<typeof CampaignVisibilityConfigSchema>;

/**
 * Per-annotation audit record (ADR-0010 Decision 4) — exactly what was
 * delivered to one annotator-sample pair. `visibilityConfigHash` ties
 * the row to an immutable record of the policy in effect;
 * `deliveredFields` is the concrete field list shipped to the UI
 * (`optional` fields may have been suppressed per-sample).
 */
export const MetadataExposureProfileSchema = z.object({
  visibilityConfigHash: z.string(),
  visibilityConfigVersion: z.string(),
  deliveredFields: z.array(z.string()),
});
export type MetadataExposureProfile = z.infer<typeof MetadataExposureProfileSchema>;

/**
 * Handoff metadata bundle (ADR-0010 amendment to ADR-0007). Only
 * `required` + gate-permitted `optional` fields ever appear; nothing
 * from `hidden` or `never` is included. Ships alongside the presigned
 * sample URL.
 */
export const MetadataBundleSchema = z.object({
  required: z.record(z.string(), z.unknown()).default({}),
  optional: z.record(z.string(), z.unknown()).default({}),
});
export type MetadataBundle = z.infer<typeof MetadataBundleSchema>;

/**
 * Resolve the effective bucket for a single field (ADR-0010 Decision 1
 * source-of-truth priority). `never` is a hard floor — a field the OCI
 * default table or the Croissant tag marks `never` (PHI / direct
 * identifier) can never be promoted by a campaign-manager override.
 * Otherwise: manager override → Croissant tag → OCI default → fallback
 * `hidden` (default-hide is the ADR's whole stance).
 */
export function resolveFieldBucket(sources: {
  managerBucket?: MetadataVisibilityBucket;
  croissantBucket?: MetadataVisibilityBucket;
  defaultBucket?: MetadataVisibilityBucket;
}): MetadataVisibilityBucket {
  if (sources.defaultBucket === 'never' || sources.croissantBucket === 'never') return 'never';
  return sources.managerBucket ?? sources.croissantBucket ?? sources.defaultBucket ?? 'hidden';
}

/**
 * Whether a field in a given bucket is visible to the annotator at a
 * given gate (ADR-0010 Decision 2 gate matrix):
 *   gate 1 (independent): required only
 *   gate 2 (arbitration): required + optional
 *   gate 3 (expert):      required + optional + manager-promoted hidden
 * `trainingGrade` campaigns may promote optional/hidden at gate 1;
 * `promotedAtGates` widens an individual field beyond the defaults.
 */
export function isFieldVisibleAtGate(
  bucket: MetadataVisibilityBucket,
  gate: MetadataVisibilityGate,
  opts: { promotedAtGates?: MetadataVisibilityGate[]; trainingGrade?: boolean } = {},
): boolean {
  if (bucket === 'never') return false;
  if (bucket === 'required') return true;
  const promoted = opts.promotedAtGates?.includes(gate) ?? false;
  if (bucket === 'optional') {
    if (gate === 'arbitration' || gate === 'expert') return true;
    return promoted || (opts.trainingGrade ?? false);
  }
  // hidden — only ever surfaced by an explicit per-field promotion
  if (gate === 'expert' && promoted) return true;
  if (gate === 'independent' && (opts.trainingGrade ?? false) && promoted) return true;
  return false;
}

/**
 * Prototype-pollution-safe dynamic-property helpers for the
 * metadata-visibility functions below, which key plain objects by
 * *external* metadata field names. `security/detect-object-injection`
 * flags every computed member access; these centralise the guard so the
 * disable lives in one audited place. `__proto__`/`constructor`/
 * `prototype` keys are dropped — they are never valid metadata fields.
 */
const PROTO_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function readFieldValue(record: Record<string, unknown>, key: string): unknown {
  if (PROTO_POLLUTION_KEYS.has(key) || !Object.hasOwn(record, key)) return undefined;
  // eslint-disable-next-line security/detect-object-injection -- key screened against prototype-pollution keys and verified own-property above
  return record[key];
}
function writeFieldValue(target: Record<string, unknown>, key: string, value: unknown): void {
  if (PROTO_POLLUTION_KEYS.has(key)) return;
  // eslint-disable-next-line security/detect-object-injection -- key screened against prototype-pollution keys above; target is a fresh local record
  target[key] = value;
}

/**
 * Compose the handoff metadata bundle + delivered-field list for one
 * sample at one gate (ADR-0010 Decisions 1 + 2). The caller supplies a
 * `resolve` closure (wiring in the manager override / Croissant tag /
 * OCI default) so this stays pure + table-agnostic. Fields landing in
 * `never`/`hidden` (or not gate-permitted) are dropped — they never
 * reach the annotator UI. Field order is sorted for deterministic
 * `deliveredFields`.
 */
export function composeMetadataBundle(
  sampleMetadata: Record<string, unknown>,
  gate: MetadataVisibilityGate,
  resolve: (field: string) => {
    bucket: MetadataVisibilityBucket;
    promotedAtGates?: MetadataVisibilityGate[];
  },
  opts: { trainingGrade?: boolean } = {},
): { bundle: MetadataBundle; deliveredFields: string[] } {
  const bundle: MetadataBundle = { required: {}, optional: {} };
  const deliveredFields: string[] = [];
  for (const field of Object.keys(sampleMetadata).sort()) {
    const { bucket, promotedAtGates } = resolve(field);
    if (
      !isFieldVisibleAtGate(bucket, gate, { promotedAtGates, trainingGrade: opts.trainingGrade })
    ) {
      continue;
    }
    const value = readFieldValue(sampleMetadata, field);
    if (bucket === 'required') writeFieldValue(bundle.required, field, value);
    else writeFieldValue(bundle.optional, field, value);
    deliveredFields.push(field);
  }
  return { bundle, deliveredFields };
}

/**
 * Deterministic JSON serialisation of a visibility config for hashing
 * (ADR-0010 Decision 4 `visibilityConfigHash`). Recursively sorts
 * object keys so structurally-identical configs always hash the same
 * regardless of key insertion order. Scoped to the JSON shapes a
 * `CampaignVisibilityConfig` contains — not a general stable-stringify.
 */
export function canonicalVisibilityConfigString(config: CampaignVisibilityConfig): string {
  const sortValue = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortValue);
    if (v !== null && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          writeFieldValue(acc, k, sortValue(readFieldValue(obj, k)));
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(sortValue(config));
}

// ---------------------------------------------------------------------------
// Annotator calibration drift detection (#292, ADR-0009 Decision 4 + 5).
//
// Two transitions:
//   - SKILL — `vs-gold` or `vs-peers` below `publishableFloor`
//     → auto-suspend pending supervisor review
//   - DRIFT — `vs-self` below `fatigueFloor` while peer/gold scores
//     are OK → schedule recalibration window
//
// The scheduler runs every 6h by default; thresholds are per-campaign
// settings (with platform defaults). The supervisor inbox API surfaces
// only ACTIVE flags.
// ---------------------------------------------------------------------------

export const CalibrationFlagTypeSchema = z.enum(['SKILL', 'DRIFT']);
export type CalibrationFlagType = z.infer<typeof CalibrationFlagTypeSchema>;

export const CalibrationMetricKindSchema = z.enum(['vs-gold', 'vs-peers', 'vs-self']);
export type CalibrationMetricKind = z.infer<typeof CalibrationMetricKindSchema>;

export const CalibrationFlagStatusSchema = z.enum(['ACTIVE', 'CLEARED']);
export type CalibrationFlagStatus = z.infer<typeof CalibrationFlagStatusSchema>;

export const CalibrationThresholdsSchema = z.object({
  /**
   * Floor on `vs-gold` / `vs-peers`. Falling below raises a SKILL flag
   * → annotator auto-suspended. Default 0.6 (substantial agreement per
   * Landis & Koch).
   */
  publishableFloor: z.number().min(0).max(1).default(0.6),
  /**
   * Floor on `vs-self` (test-retest on duplicate samples). Falling
   * below despite acceptable peer / gold scores raises a DRIFT flag →
   * recalibration window scheduled. Default 0.7 (higher than the peer
   * floor because intra-rater agreement is reflexive).
   */
  fatigueFloor: z.number().min(0).max(1).default(0.7),
  /** Minimum submissions in the rolling window before metrics are computed. */
  minSampleSize: z.number().int().min(1).default(10),
});
export type CalibrationThresholds = z.infer<typeof CalibrationThresholdsSchema>;

/** Single annotator's calibration metrics over the recompute window. */
export interface CalibrationAnnotatorInput {
  annotatorUserId: string;
  sampleSize: number;
  /** κ / Dice vs gold-standard samples in the window. Null when no gold seen. */
  vsGold: number | null;
  /** κ / Dice vs peer annotators on shared samples. Null when no overlap. */
  vsPeers: number | null;
  /** κ / Dice vs duplicate same-sample submissions from this annotator. Null when no duplicates. */
  vsSelf: number | null;
}

export interface CalibrationFlagDecision {
  annotatorUserId: string;
  flagType: CalibrationFlagType;
  metric: CalibrationMetricKind;
  score: number;
  threshold: number;
  sampleSize: number;
}

/**
 * Pure evaluator: classify each annotator against the thresholds and
 * return the flags that should be ACTIVE. Caller diffs against the
 * persisted state to decide which rows to raise / clear / leave alone.
 *
 * Rule precedence (per ADR-0009 Decision 5):
 *   1. If `vs-gold` is set AND < publishableFloor → SKILL flag (vs-gold)
 *   2. Else if `vs-peers` is set AND < publishableFloor → SKILL flag (vs-peers)
 *   3. Else if `vs-self` is set AND < fatigueFloor AND
 *      both vs-gold (when present) and vs-peers (when present) are above
 *      publishableFloor → DRIFT flag (vs-self)
 *
 * Annotators with `sampleSize < minSampleSize` are skipped — too few
 * submissions for the metrics to be stable.
 */
export function evaluateCalibrationFlags(
  inputs: readonly CalibrationAnnotatorInput[],
  thresholds: CalibrationThresholds,
): CalibrationFlagDecision[] {
  const out: CalibrationFlagDecision[] = [];
  for (const row of inputs) {
    if (row.sampleSize < thresholds.minSampleSize) continue;
    if (row.vsGold !== null && row.vsGold < thresholds.publishableFloor) {
      out.push({
        annotatorUserId: row.annotatorUserId,
        flagType: 'SKILL',
        metric: 'vs-gold',
        score: row.vsGold,
        threshold: thresholds.publishableFloor,
        sampleSize: row.sampleSize,
      });
      continue;
    }
    if (row.vsPeers !== null && row.vsPeers < thresholds.publishableFloor) {
      out.push({
        annotatorUserId: row.annotatorUserId,
        flagType: 'SKILL',
        metric: 'vs-peers',
        score: row.vsPeers,
        threshold: thresholds.publishableFloor,
        sampleSize: row.sampleSize,
      });
      continue;
    }
    if (row.vsSelf !== null && row.vsSelf < thresholds.fatigueFloor) {
      // DRIFT requires that peer/gold are *acceptable* — otherwise the
      // root cause is skill, not fatigue, and the SKILL branch above
      // would have fired (we get here precisely because they're either
      // null or ≥ publishableFloor). No extra check needed.
      out.push({
        annotatorUserId: row.annotatorUserId,
        flagType: 'DRIFT',
        metric: 'vs-self',
        score: row.vsSelf,
        threshold: thresholds.fatigueFloor,
        sampleSize: row.sampleSize,
      });
    }
  }
  return out;
}

export const CalibrationFlagSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  annotatorUserId: UserIdSchema,
  flagType: CalibrationFlagTypeSchema,
  metric: CalibrationMetricKindSchema,
  score: z.number(),
  threshold: z.number(),
  sampleSize: z.number().int(),
  status: CalibrationFlagStatusSchema,
  createdAt: z.string().datetime(),
  clearedAt: z.string().datetime().nullable(),
});
export type CalibrationFlag = z.infer<typeof CalibrationFlagSchema>;

export const ListCalibrationFlagsResponseSchema = z.object({
  /** ACTIVE flags only by default; the controller filters status. */
  items: z.array(CalibrationFlagSchema),
});
export type ListCalibrationFlagsResponse = z.infer<typeof ListCalibrationFlagsResponseSchema>;

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
  /** FK to catalog.dataset_versions.id (ADR-0016 Decision 1). The pinned
   * Croissant manifest version; null on pre-#320 campaigns. */
  manifestVersionId: z.string().uuid().nullable(),
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
  createdById: UserIdSchema,
  /**
   * Pointer to the currently-published instructions version (#230).
   * Null when no instructions are attached yet.
   */
  currentInstructionsVersion: z.string().nullable(),
});
export type CampaignDetail = z.infer<typeof CampaignDetailSchema>;

/** `POST /v2/annotation/campaigns` — campaign-manager create. */
export const CreateCampaignRequestSchema = z.object({
  slug: CampaignSlugSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  datasetId: z.string().uuid(),
  /** Optional pinned manifest version (ADR-0016 Decision 1). When omitted,
   * the API pins the dataset's latest published version. Immutable once
   * status = RUNNING. */
  manifestVersionId: z.string().uuid().optional(),
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
// Annotation tasks + gate state machine (#215 slice 2).
//
// Each campaign's work is broken into AnnotationTasks (one per sample).
// Tasks move through the 3-gate SOP via the state machine below. Slice 2
// implements the minimum surface ADR-0009 Decision 1 requires: routing
// by role (predicate 1) + FIFO tiebreaker (predicate 6). Experience-
// weighted ranking, bias-prevention, stratification, and the
// calibration loop land in slice 3.
// ---------------------------------------------------------------------------

export const AnnotationGateStateSchema = z.enum([
  'INDEPENDENT',
  'AWAITING_ARBITRATION',
  'AWAITING_EXPERT',
  'COMPLETED',
  'SKIPPED',
]);
export type AnnotationGateState = z.infer<typeof AnnotationGateStateSchema>;

export const AnnotationAssignmentStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'SUBMITTED',
  'EXPIRED',
  'RELEASED',
]);
export type AnnotationAssignmentStatus = z.infer<typeof AnnotationAssignmentStatusSchema>;

// ---------------------------------------------------------------------------
// Annotation tool-integration contract (ADR-0007, #214)
// ---------------------------------------------------------------------------

/** Auth posture for a tool adapter (ADR-0007 §"Auth modes"). `RFC8693`
 * is preferred for all new adapters; the live token-exchange wiring is a
 * security-boundary follow-up. */
export const AnnotationToolAuthModeSchema = z.enum(['RFC8693', 'API_KEY', 'IFRAME_POSTMESSAGE']);
export type AnnotationToolAuthMode = z.infer<typeof AnnotationToolAuthModeSchema>;

/** How the tool is launched for the annotator (ADR-0007). */
export const AnnotationToolLaunchModeSchema = z.enum([
  'REDIRECT',
  'IFRAME',
  'POPUP',
  'DESKTOP_HANDOFF',
]);
export type AnnotationToolLaunchMode = z.infer<typeof AnnotationToolLaunchModeSchema>;

/** Sample modalities a tool can edit (ADR-0007 capability matrix). */
export const ToolModalitySchema = z.enum([
  'image-2d',
  'image-3d',
  'video',
  'audio',
  'text',
  'multimodal',
]);
export type ToolModality = z.infer<typeof ToolModalitySchema>;

/** Annotation primitive types a tool can produce (ADR-0007). */
export const ToolAnnotationTypeSchema = z.enum([
  'classification',
  'bbox',
  'polygon',
  'polyline',
  'mask',
  'keypoint',
  'segmentation',
  '3d-roi',
]);
export type ToolAnnotationType = z.infer<typeof ToolAnnotationTypeSchema>;

/** Output formats a tool version can emit (ADR-0007). */
export const ToolOutputFormatSchema = z.enum([
  'dicom-sr',
  'fhir-observation',
  'coco',
  'jsonl-custom',
]);
export type ToolOutputFormat = z.infer<typeof ToolOutputFormatSchema>;

/** Semver string for adapter versions (ADR-0007 §"Versioning"). */
export const ToolSemVerSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'must be a semver string like 1.2.0');

/** Typed capability matrix for an adapter (ADR-0007 Decision). */
export const ToolCapabilityMatrixSchema = z.object({
  modalities: z.array(ToolModalitySchema),
  annotationTypes: z.array(ToolAnnotationTypeSchema),
  taskKinds: z.array(CampaignTaskKindSchema),
  supportsPreAnnotation: z.boolean().default(false),
  supportsActiveLearning: z.boolean().default(false),
});
export type ToolCapabilityMatrix = z.infer<typeof ToolCapabilityMatrixSchema>;

/** A versioned adapter contract row (ADR-0007 §"Versioning"). */
export const ToolIntegrationVersionSchema = z.object({
  id: z.string().uuid(),
  integrationId: z.string().uuid(),
  version: ToolSemVerSchema,
  /** Zod schema id in the annotation module's schema-profile registry. */
  schemaProfile: z.string().min(1),
  launchUrlTemplate: z.string().min(1),
  callbackUrlPath: z.string().startsWith('/'),
  outputFormats: z.array(ToolOutputFormatSchema),
  releaseNotes: z.string().nullable(),
  isCurrent: z.boolean(),
  createdAt: z.string(), // ISO 8601
});
export type ToolIntegrationVersion = z.infer<typeof ToolIntegrationVersionSchema>;

/** Full integration detail with capability matrix + versions (ADR-0007). */
export const ToolIntegrationDetailSchema = AnnotationToolIntegrationSummarySchema.extend({
  homepageUrl: z.string().nullable(),
  capabilities: ToolCapabilityMatrixSchema,
  authMode: AnnotationToolAuthModeSchema,
  launchMode: AnnotationToolLaunchModeSchema,
  versions: z.array(ToolIntegrationVersionSchema),
});
export type ToolIntegrationDetail = z.infer<typeof ToolIntegrationDetailSchema>;

/** `POST /v2/annotation/integrations/:id/handoff` request. */
export const ToolHandoffRequestSchema = z.object({
  assignmentId: z.string().uuid(),
});
export type ToolHandoffRequest = z.infer<typeof ToolHandoffRequestSchema>;

/**
 * Handoff descriptor returned to the annotator UI (ADR-0007 §"Handoff
 * protocol"). The RFC 8693 exchanged `launchToken` and the presigned
 * `sampleUrl` are added by the security-boundary follow-up; in this
 * slice they are `null`. The `metadataBundle` is server-side filtered
 * per ADR-0010 — `hidden`/`never` fields never appear.
 */
export const ToolHandoffDescriptorSchema = z.object({
  integrationId: z.string().uuid(),
  integrationSlug: z.string(),
  version: ToolSemVerSchema,
  schemaProfile: z.string().min(1),
  launchUrlTemplate: z.string().min(1),
  callbackUrlPath: z.string().startsWith('/'),
  authMode: AnnotationToolAuthModeSchema,
  launchMode: AnnotationToolLaunchModeSchema,
  assignmentId: z.string().uuid(),
  taskId: z.string().uuid(),
  gate: AnnotationGateStateSchema,
  metadataBundle: MetadataBundleSchema,
  /** RFC 8693 exchanged token — null until the security follow-up. */
  launchToken: z.string().nullable(),
  /** Presigned S3 URL for sample bytes — null until the security follow-up. */
  sampleUrl: z.string().nullable(),
});
export type ToolHandoffDescriptor = z.infer<typeof ToolHandoffDescriptorSchema>;

/**
 * `POST /v2/annotation/integrations/:id/callback` envelope (ADR-0007
 * §"Submission contract"). The inner `payload` is validated against the
 * pinned version's `schemaProfile` by the service, not here.
 */
export const ToolCallbackRequestSchema = z.object({
  assignmentId: z.string().uuid(),
  versionId: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
});
export type ToolCallbackRequest = z.infer<typeof ToolCallbackRequestSchema>;

/** Callback result. `accepted` on first processing, `duplicate` on an
 * idempotent replay with the same key + body. */
export const ToolCallbackResponseSchema = z.object({
  status: z.enum(['accepted', 'duplicate']),
  receiptId: z.string().uuid(),
  assignmentId: z.string().uuid(),
});
export type ToolCallbackResponse = z.infer<typeof ToolCallbackResponseSchema>;

/**
 * Cognito groups eligible for annotation work at each gate. The router
 * (`apps/api/src/modules/annotation/task.service.ts`) matches the
 * caller's groups against the required role for the task's current
 * gate; a caller with multiple eligible groups receives tasks for the
 * earliest gate in the chain they qualify for.
 */
export const ANNOTATION_GATE_ROLES = {
  INDEPENDENT: 'annotator',
  AWAITING_ARBITRATION: 'arbitration-annotator',
  AWAITING_EXPERT: 'expert-reviewer',
} as const satisfies Partial<Record<AnnotationGateState, string>>;

/**
 * One entry in the seed request — either a plain ref string (the
 * legacy shape, treated as a non-gold sample) OR an object with the
 * gold-standard label attached (#291, ADR-0009 Decision 4).
 *
 * Manager workflows that want to load a campaign with a mix of
 * regular + gold samples can send the object form; the bulk paste-
 * a-list-of-strings UX keeps working unchanged.
 */
export const SeedTaskItemSchema = z.union([
  z.string().min(1).max(500),
  z.object({
    sampleRef: z.string().min(1).max(500),
    isGoldStandard: z.boolean().default(false),
    /**
     * Expected submission for a gold sample. Same JSON shape as the
     * annotator's submission payload — the supervisor `irrAgainstGold`
     * computation compares them like-for-like. Required when
     * `isGoldStandard` is true; the API rejects gold rows with no
     * label.
     */
    goldStandardLabel: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type SeedTaskItem = z.infer<typeof SeedTaskItemSchema>;

export const SeedTasksRequestSchema = z.object({
  /** Stable per-sample identifiers; one task created per entry. */
  sampleRefs: z.array(SeedTaskItemSchema).min(1).max(10_000),
});
export type SeedTasksRequest = z.infer<typeof SeedTasksRequestSchema>;

/**
 * Request body for `POST .../metadata-visibility/preview` (ADR-0010).
 * Given a sample's full metadata set + a gate, returns the
 * server-side-filtered handoff bundle + exposure profile — the same
 * filtering the real handoff applies (#214). `croissantTags` carries
 * the dataset's per-field `oci:annotationVisibility` tags when known.
 */
export const MetadataVisibilityPreviewRequestSchema = z.object({
  sampleMetadata: z.record(z.string(), z.unknown()),
  gateState: AnnotationGateStateSchema.default('INDEPENDENT'),
  croissantTags: z.record(z.string(), MetadataVisibilityBucketSchema).default({}),
});
export type MetadataVisibilityPreviewRequest = z.infer<
  typeof MetadataVisibilityPreviewRequestSchema
>;

/**
 * Request body for `POST .../metadata-visibility/resolve` — the
 * campaign-create checklist (#222). For each field name, returns the
 * resolved bucket, the winning source, and whether it's visible at the
 * requested gate.
 */
export const MetadataVisibilityResolveRequestSchema = z.object({
  fields: z.array(z.string().min(1)).min(1).max(2000),
  gateState: AnnotationGateStateSchema.default('INDEPENDENT'),
  croissantTags: z.record(z.string(), MetadataVisibilityBucketSchema).default({}),
});
export type MetadataVisibilityResolveRequest = z.infer<
  typeof MetadataVisibilityResolveRequestSchema
>;

/**
 * `POST /v2/annotation/campaigns/:slug/tasks/from-dataset` (#646): one
 * task per platform-hosted PNG / JPEG file, and one per DICOM series
 * (#674), of the campaign's pinned dataset version. Idempotent: samples
 * that already have a task count as `skipped`. A series with a held
 * image (ADR-0026) is never made into a task and counts as `held`.
 */
export const SeedTasksFromDatasetRequestSchema = z.object({
  /**
   * Only image files whose name starts with this. A series has no file
   * name of its own, so a prefix leaves series out.
   */
  prefix: z.string().max(200).optional(),
  /** At most this many samples: image files in file-name order, then series. */
  limit: z.number().int().min(1).max(10_000).optional(),
  /** Count what would be created without creating anything. */
  dryRun: z.boolean().default(false),
});
export type SeedTasksFromDatasetRequest = z.infer<typeof SeedTasksFromDatasetRequestSchema>;

export const SeedTasksFromDatasetResponseSchema = z.object({
  /** Samples that matched: image files and series. */
  matched: z.number().int().nonnegative(),
  /** Tasks created (on a dry run: that would be created). */
  created: z.number().int().nonnegative(),
  /** Matched samples that already have a task. */
  skipped: z.number().int().nonnegative(),
  /** Series left out because an image of theirs is held (ADR-0026). Not in `matched`. */
  held: z.number().int().nonnegative(),
  dryRun: z.boolean(),
});
export type SeedTasksFromDatasetResponse = z.infer<typeof SeedTasksFromDatasetResponseSchema>;

// ==== How a task points at its sample (#646, #674) ======================
//
// A typed platform id, never a storage key: the reference goes into the
// append-only audit trail, the calibration grouping and exports (#648),
// and a key carries the file name as uploaded.
//
//   file:<distribution id>     an image file, this module
//   dicom-series:<series id>   a DICOM series (`dicomSeriesSampleRef`)
//
// Both resolve against the campaign's pinned dataset version.

const FILE_SAMPLE_PREFIX = 'file:';

/** The sample reference of a task on one hosted file. */
export function fileSampleRef(distributionId: string): string {
  return `${FILE_SAMPLE_PREFIX}${distributionId}`;
}

/** The distribution id of a `file:` reference, or null for any other. */
export function parseFileSampleRef(sampleRef: string): string | null {
  if (!sampleRef.startsWith(FILE_SAMPLE_PREFIX)) return null;
  const id = sampleRef.slice(FILE_SAMPLE_PREFIX.length);
  return z.string().uuid().safeParse(id).success ? id : null;
}

/**
 * The `image` answer of a task's sample address: one PNG or JPEG behind
 * a short-lived address. Nothing else about the sample travels with it
 * (ADR-0010 blinding).
 */
export const ImageSampleSchema = z
  .object({
    kind: z.literal('image'),
    url: z.string().url(),
    contentType: z.string(),
    /** The address works at least until then. */
    expiresAt: z.string().datetime(),
  })
  .strict();
export type ImageSample = z.infer<typeof ImageSampleSchema>;

/**
 * `GET /v2/annotation/assignments/:id/sample` (#646): the sample of an
 * assignment, tagged by `kind`. The annotate and arbitration screens
 * pick the viewer by it: the image viewer, or the DICOM viewer (#674).
 */
export const AssignmentSampleResponseSchema = z.discriminatedUnion('kind', [
  ImageSampleSchema,
  DicomSeriesSampleSchemaLocal,
]);
export type AssignmentSampleResponse = z.infer<typeof AssignmentSampleResponseSchema>;

/**
 * `GET /v2/annotation/assignments/:id/readings` (#646): what the
 * independent readers answered on an arbitration task, each label with
 * its comment, without who gave them. Sorted by label, so the order
 * says nothing about who read first.
 *
 * On a DICOM series each reading also says what the reader had on
 * screen when they answered (#674): the image, by its place in the
 * series, and the window. The arbiter can show it. Null on an image.
 */
export const AssignmentReadingSchema = z.object({
  label: z.string(),
  comment: z.string().nullable(),
  view: DicomViewSchemaLocal.nullable(),
});
export type AssignmentReading = z.infer<typeof AssignmentReadingSchema>;

export const AssignmentReadingsResponseSchema = z.object({
  readings: z.array(AssignmentReadingSchema),
});
export type AssignmentReadingsResponse = z.infer<typeof AssignmentReadingsResponseSchema>;

export const SeedTasksResponseSchema = z.object({
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type SeedTasksResponse = z.infer<typeof SeedTasksResponseSchema>;

/**
 * Per-annotator quality summary computed against gold-standard samples
 * (#291, ADR-0009 Decision 4 — `irrAgainstGold`). Supervisor inbox
 * reads this to decide which annotators are calibrated and which
 * should be auto-flagged. Per-modality + per-task-kind decomposition
 * is the slice-3 follow-up under #292.
 */
export const AnnotatorQualitySummarySchema = z.object({
  annotatorUserId: UserIdSchema,
  /** Number of gold samples this annotator has submitted on. */
  goldSamplesScored: z.number().int().nonnegative(),
  /** Total gold samples in the campaign (not yet attempted ≤ total). */
  goldSamplesTotal: z.number().int().nonnegative(),
  /** Mean IRR-vs-gold score in [0, 1]. Null when no gold samples scored yet. */
  irrAgainstGold: z.number().min(0).max(1).nullable(),
  /** Metric the score was computed with — matches CampaignQualityConfig.metric. */
  metric: AnnotationQualityMetricSchema,
  /** Threshold the campaign manager set. */
  threshold: z.number().min(0).max(1),
});
export type AnnotatorQualitySummary = z.infer<typeof AnnotatorQualitySummarySchema>;

export const TaskSummarySchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  sampleRef: z.string(),
  /** Gold-standard flag (#291). Drives the supervisor inbox + IRR-vs-gold scoring. */
  isGoldStandard: z.boolean(),
  gateState: AnnotationGateStateSchema,
  nAnnotatorsRequired: z.number().int().min(1),
  /**
   * Number of `SUBMITTED` assignments at the task's CURRENT gate.
   * Surfaces "1/3 submitted" progress to the manager view (#215
   * slice-2 web). When the task has advanced past INDEPENDENT the
   * count resets — this is the count at the gate the task is in now,
   * not a lifetime total.
   */
  submittedCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const AssignmentSummarySchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  sampleRef: z.string(),
  gateAtAssignment: AnnotationGateStateSchema,
  assigneeRole: z.string(),
  status: AnnotationAssignmentStatusSchema,
  assignedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
});
export type AssignmentSummary = z.infer<typeof AssignmentSummarySchema>;

export const PullNextResponseSchema = z.object({
  /** `null` when the caller has no eligible task in flight or queued. */
  assignment: AssignmentSummarySchema.nullable(),
});
export type PullNextResponse = z.infer<typeof PullNextResponseSchema>;

export const ReleaseAssignmentResponseSchema = z.object({
  assignmentId: z.string().uuid(),
  taskId: z.string().uuid(),
  releasedAt: z.string().datetime(),
});
export type ReleaseAssignmentResponse = z.infer<typeof ReleaseAssignmentResponseSchema>;

export const SubmitAssignmentRequestSchema = z.object({
  /**
   * Free-form per-task submission shape. The tool-integration's
   * declared schemaProfile (ADR-0007 / #214) will validate this server-
   * side once the registry lands; slice 2 stores the JSON verbatim.
   */
  submission: z.record(z.string(), z.unknown()),
  /**
   * Version of the campaign instructions the annotator acknowledged
   * before submitting (#230). Required when the campaign has
   * instructions published; the API rejects mismatches with 409 so
   * mid-campaign updates force a re-acknowledge on the next pull.
   */
  acknowledgedInstructionsVersion: z.string().min(1).max(64).optional(),
});
export type SubmitAssignmentRequest = z.infer<typeof SubmitAssignmentRequestSchema>;

export const SubmitAssignmentResponseSchema = z.object({
  assignmentId: z.string().uuid(),
  taskId: z.string().uuid(),
  /** `null` when the gate did not advance on this submission. */
  newGateState: AnnotationGateStateSchema.nullable(),
});
export type SubmitAssignmentResponse = z.infer<typeof SubmitAssignmentResponseSchema>;

export const SkipTaskRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type SkipTaskRequest = z.infer<typeof SkipTaskRequestSchema>;

/**
 * Gate-state transition vocabulary. The state machine in
 * `apps/api/src/modules/annotation/gate-state-machine.ts` is the
 * authoritative source for the `(from, action) → to` matrix; this
 * enum is shared with the UI for button visibility.
 */
export const GateTransitionActionSchema = z.enum([
  /** Annotator persisted an independent submission. */
  'independent-submitted',
  /** Arbitration annotator persisted their resolution. */
  'arbitration-submitted',
  /** Arbitration could not resolve; escalate to expert review. */
  'escalate-to-expert',
  /** Expert reviewer persisted the final decision (per ADR-0008). */
  'expert-submitted',
  /** Operator override (reason required) — exits the SOP entirely. */
  'skip',
]);
export type GateTransitionAction = z.infer<typeof GateTransitionActionSchema>;

// ---------------------------------------------------------------------------
// Per-campaign annotation instructions (#230).
//
// Versioned by sha256 of the markdown body so identical content does not
// produce a new row. The annotator UI captures the acknowledged version
// on the assignment and the submit endpoint rejects mismatches; this
// gives the auditor a per-annotation record of *which* instructions were
// in effect when the annotator submitted (extends ADR-0008's tool /
// schema version pattern).
// ---------------------------------------------------------------------------

/** Embedded media reference inside instructions markdown. */
export const InstructionsMediaRefSchema = z.object({
  /**
   * https only. The web renders this straight into `<img src>` /
   * `<video src>`, outside react-markdown's `urlTransform`, so
   * `javascript:`, `data:`, `file:` and plain `http:` are refused here.
   */
  url: z.url({ protocol: /^https$/, error: 'Media URLs must start with https://' }),
  kind: z.enum(['image', 'video']),
  caption: z.string().max(200).optional(),
});
export type InstructionsMediaRef = z.infer<typeof InstructionsMediaRefSchema>;

/** Cap on raw markdown body — 64 KB. */
export const INSTRUCTIONS_MARKDOWN_MAX_BYTES = 64 * 1024;

export const CampaignInstructionsSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  /** Short hex slice of the sha256 of `markdownBody` (16 chars). */
  version: z.string().min(1).max(64),
  markdownBody: z.string(),
  mediaUrls: z.array(InstructionsMediaRefSchema),
  createdById: UserIdSchema,
  createdAt: z.string().datetime(),
  /** True when this row's version matches the campaign's pointer. */
  isCurrent: z.boolean(),
});
export type CampaignInstructions = z.infer<typeof CampaignInstructionsSchema>;

/** `PUT /v2/annotation/campaigns/:slug/instructions` — manager publish. */
/**
 * UTF-8 byte length without depending on `TextEncoder` (the shared-
 * types package targets ES2022 + no DOM lib). Counts each code-point
 * by its UTF-8 expansion: < 0x80 → 1, < 0x800 → 2, < 0x10000 → 3,
 * surrogate-paired code points → 4. Matches `Buffer.byteLength(s, 'utf8')`.
 */
function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

export const PublishInstructionsRequestSchema = z.object({
  markdownBody: z
    .string()
    .min(1)
    .refine(
      (s) => utf8ByteLength(s) <= INSTRUCTIONS_MARKDOWN_MAX_BYTES,
      `markdownBody must be ≤ ${INSTRUCTIONS_MARKDOWN_MAX_BYTES} bytes`,
    ),
  mediaUrls: z.array(InstructionsMediaRefSchema).max(20).default([]),
  /**
   * The version the editor was based on (`null` when nothing was
   * published yet). When sent, the API returns 409 if the campaign's
   * current version has moved on since, so a stale editor can't
   * silently replace someone else's publish. Omit to skip the check.
   */
  baseVersion: z.string().min(1).max(64).nullable().optional(),
});
export type PublishInstructionsRequest = z.infer<typeof PublishInstructionsRequestSchema>;

/** Response from publish: the new (or existing identical-hash) version. */
export const PublishInstructionsResponseSchema = z.object({
  instructions: CampaignInstructionsSchema,
  /** True when this publish call created a new row (false on no-op idempotent re-publish). */
  created: z.boolean(),
});
export type PublishInstructionsResponse = z.infer<typeof PublishInstructionsResponseSchema>;

/** `GET /v2/annotation/campaigns/:slug/instructions` — annotator / manager fetch. */
export const FetchInstructionsResponseSchema = z.object({
  /** Null when the campaign has no instructions published yet. */
  current: CampaignInstructionsSchema.nullable(),
  /** Past versions in `createdAt` desc order. Slice 1 caps at 20 entries. */
  history: z.array(CampaignInstructionsSchema),
});
export type FetchInstructionsResponse = z.infer<typeof FetchInstructionsResponseSchema>;

/**
 * Compute the canonical short-version slug for an instructions
 * markdown body. Shared FE/BE so the manager-side editor can show
 * "version abc12345 will be published" before the API roundtrip.
 *
 * Implementation: lowercase hex slice of sha256(markdownBody).
 * The hashing is delegated to the caller's host environment via a
 * `hash` injection so this module remains pure / runtime-agnostic.
 */
export function shortVersionFromHash(hashHex: string): string {
  return hashHex.toLowerCase().slice(0, 16);
}

/** `PATCH /v2/annotation/tasks/:taskId/instructions-note` — manager per-task override (#230 §per-task). */
export const SetTaskInstructionsNoteRequestSchema = z.object({
  /** Free-form markdown shown alongside campaign-level instructions; null clears the override. */
  note: z.string().max(4000).nullable(),
});
export type SetTaskInstructionsNoteRequest = z.infer<typeof SetTaskInstructionsNoteRequestSchema>;

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
  'evaluation-reviewer',
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

// ---------------------------------------------------------------------------
// Dataset consent records (ADR-0012 Decision 2 + 5, #224)
// ---------------------------------------------------------------------------

export const ConsentTypeSchema = z.enum(['ANNOTATION_USE', 'REDISTRIBUTION', 'SENSITIVE_FACETS']);
export type ConsentType = z.infer<typeof ConsentTypeSchema>;

export const ConsentStatusSchema = z.enum(['ACTIVE', 'REVOKED', 'EXPIRED']);
export type ConsentStatus = z.infer<typeof ConsentStatusSchema>;

/** `POST /v2/consent` — record a dataset consent (grant). */
export const CreateConsentRequestSchema = z.object({
  datasetId: z.string().uuid(),
  consentType: ConsentTypeSchema,
  /** Free-form coverage terms (purposes, sub-populations, expiry notes). */
  scope: z.record(z.string(), z.unknown()),
  /** Verbatim consent-disclosure text the consenter agreed to. */
  disclosureText: z.string().min(1),
  validUntil: z.string().datetime().nullable().optional(),
  /** Optional: the consenter's platform user id when not the caller. */
  consenterUserId: z.string().uuid().nullable().optional(),
});
export type CreateConsentRequest = z.infer<typeof CreateConsentRequestSchema>;

/** `POST /v2/consent/:id/revoke` — revoke a consent (GDPR Art. 17). */
export const RevokeConsentRequestSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type RevokeConsentRequest = z.infer<typeof RevokeConsentRequestSchema>;

/** Consent record + receipt returned by the API (full audit shape). */
export const ConsentRecordResponseSchema = z.object({
  id: z.string().uuid(),
  datasetId: z.string().uuid(),
  consenterSub: z.string(),
  consenterUserId: z.string().uuid().nullable(),
  consentType: ConsentTypeSchema,
  status: ConsentStatusSchema,
  scope: z.record(z.string(), z.unknown()),
  /** SHA-256 of the disclosure text — the binding receipt artifact. */
  textSha256: z.string(),
  validFrom: z.string(),
  validUntil: z.string().nullable(),
  /** Present only when KMS signing was configured at grant time. */
  signatureKeyId: z.string().nullable(),
  signed: z.boolean(),
  revokedAt: z.string().nullable(),
  revocationReason: z.string().nullable(),
  createdAt: z.string(),
});
export type ConsentRecordResponse = z.infer<typeof ConsentRecordResponseSchema>;

/** Per-dataset audit-trail response (full grant + revocation history). */
export const DatasetConsentHistorySchema = z.object({
  datasetId: z.string().uuid(),
  /** True when no ACTIVE consent is blocked by a revocation — the gate
   * predicate the annotation workflow reads. */
  annotationAllowed: z.boolean(),
  records: z.array(ConsentRecordResponseSchema),
});
export type DatasetConsentHistory = z.infer<typeof DatasetConsentHistorySchema>;

// ==== Evaluation surface (EP package, Phase C-lite / ADR-0017) ============
//
// Model-to-data scoring. An `EvaluationTask` binds a dataset slug + task
// kind + metric config + the HIDDEN ground-truth labels; a `Submission` is
// one scored (or failed) run against it. Ground truth is NEVER part of any
// DTO in this section — it lives server-side only and is stripped from
// every read response. ADR-0017 ships Mode 1 (predictions file, scored
// in-process) only; the mode enum carries the Mode 2 (sealed container)
// door.
//
// Note: the DB-backed evaluation *task kind* here is a CLOSED enum
// (`GRADING` only) and is deliberately distinct from the OPEN
// model-submission `EvaluationTaskKind` vocabulary above (ADR-0015) — a
// different concept in a different layer.

/** Slug rules for an evaluation task — same shape as `DatasetSlug`. */

/**
 * Scoring family (DB-backed closed enum).
 *
 *   - `GRADING` — ordinal grades; distance between labels is meaningful, so
 *     quadratic-weighted kappa is the headline metric (ADR-0017).
 *   - `CLASSIFICATION` — nominal categories; every confusion is equally wrong,
 *     so per-class precision/recall and balanced accuracy lead (#428, WP10).
 *   - `BINARY_DIAGNOSTIC` — one finding, present (1) or absent (0); reported as
 *     sensitivity, specificity and predictive values with Wilson 95% intervals,
 *     and AUC when every scored item carries a score (#650).
 *
 * Extend additively only, with a matching Prisma migration. Adding a value
 * here without a registered scorer is a runtime error, not a silent default:
 * see `scoring-registry.ts` in the API's evaluation module.
 */
export const EvaluationTaskKindDbSchema = z.enum([
  'GRADING',
  'CLASSIFICATION',
  'BINARY_DIAGNOSTIC',
]);
export type EvaluationTaskKindDb = z.infer<typeof EvaluationTaskKindDbSchema>;

/** How a submission delivered predictions. `PREDICTIONS` = Mode 1 (shipped);
 *  `CONTAINER` = Mode 2 (reserved, no execution path yet). */

/** Submission lifecycle. `PENDING` on insert; `SCORED` once scores are
 *  written; `FAILED` with a populated `error`. */
export const SubmissionStatusSchema = z.enum(['PENDING', 'SCORED', 'FAILED']);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

/**
 * What a submission is FOR (WP6). Orthogonal to `SubmissionMode`, which says
 * only HOW predictions are delivered — either intent is expressible in either
 * mode:
 *
 *   - `SCORED` — a competition entry. Scored against the task's hidden ground
 *     truth, listed among the task's results, and counted against the
 *     per-participant quota. Requires an identified participant.
 *   - `VALIDATION` — an interface check. Unlimited, never scored, never listed
 *     among a task's results, never counted against the quota, and open to
 *     anonymous callers. It answers "would this submission have been parseable
 *     / dispatchable at all" — the only question a participant can debug in a
 *     model-to-data challenge where they never see the data.
 *
 * There is deliberately NO `Submission.intent` column: a validation submission
 * writes no row at all, so there is nothing to mark and nothing to filter back
 * out of a leaderboard. See `SubmissionValidationReportSchema`.
 */
export const SubmissionIntentSchema = z.enum(['SCORED', 'VALIDATION']);
export type SubmissionIntent = z.infer<typeof SubmissionIntentSchema>;

/**
 * Computed metrics for a scored submission (each rounded to 4 decimals).
 * Structural mirror of the pure scoring service's output shape.
 */
export const EvaluationScoresSchema = z.object({
  /** Quadratic-weighted kappa over the matched set. */
  qwk: z.number(),
  /** Exact-match accuracy over the matched set. */
  accuracy: z.number(),
  /** Sensitivity for the referable class (label ≥ threshold). */
  referableSensitivity: z.number(),
  /** Specificity for the non-referable class (label < threshold). */
  referableSpecificity: z.number(),
  /** matched / |groundTruth| — fraction of the GT set predicted. */
  coverage: z.number(),
});
export type EvaluationScores = z.infer<typeof EvaluationScoresSchema>;

/** Alias: `EvaluationScores` is the `GRADING` metric set specifically. */
export const GradingScoresSchema = EvaluationScoresSchema;
export type GradingScores = EvaluationScores;

/** Per-class precision / recall / F1 and ground-truth support. */
export const ClassMetricsSchema = z.object({
  /** Class label (0..numClasses-1). */
  label: z.number().int().nonnegative(),
  precision: z.number(),
  recall: z.number(),
  f1: z.number(),
  /** Matched items whose ground-truth label is this class. */
  support: z.number().int().nonnegative(),
});
export type ClassMetrics = z.infer<typeof ClassMetricsSchema>;

/**
 * Metrics for a nominal multi-class task (#428, ADR-0020). Deliberately has no
 * quadratic-weighted kappa: labels are categories, not points on a scale, so an
 * ordinal agreement metric would reward a "near-miss" class that is simply
 * wrong.
 */
export const ClassificationScoresSchema = z.object({
  accuracy: z.number(),
  /** Mean per-class recall over classes with support > 0. */
  balancedAccuracy: z.number(),
  /** Mean per-class F1 over classes with support > 0. */
  macroF1: z.number(),
  /** Pooled F1. Arithmetically equal to accuracy for single-label tasks. */
  microF1: z.number(),
  perClass: z.array(ClassMetricsSchema),
  coverage: z.number(),
});
export type ClassificationScores = z.infer<typeof ClassificationScoresSchema>;

/** A proportion with its Wilson score 95% interval (#650). */
export const ProportionEstimateSchema = z.object({
  /** numerator / denominator, rounded to 4 decimals. */
  estimate: z.number(),
  /** Lower bound of the Wilson 95% interval. */
  lower: z.number(),
  /** Upper bound of the Wilson 95% interval. */
  upper: z.number(),
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().positive(),
});
export type ProportionEstimate = z.infer<typeof ProportionEstimateSchema>;

/** AUC with its bootstrap 95% interval and how the interval was made (#650). */
export const AucEstimateSchema = z.object({
  estimate: z.number(),
  lower: z.number(),
  upper: z.number(),
  /** Bootstrap resamples (stratified by reference class, percentile interval). */
  resamples: z.number().int().positive(),
  /** Seed of the bootstrap's generator: same file, same interval. */
  seed: z.number().int(),
});
export type AucEstimate = z.infer<typeof AucEstimateSchema>;

/**
 * Diagnostic-accuracy metrics for one binary finding (#650, ADR-0020). Label 1
 * is the task's positive class (named in `positiveClassName`). A proportion is
 * `null` when its denominator is zero: not estimable, which is not 0%.
 */
export const BinaryDiagnosticScoresSchema = z.object({
  truePositives: z.number().int().nonnegative(),
  falsePositives: z.number().int().nonnegative(),
  trueNegatives: z.number().int().nonnegative(),
  falseNegatives: z.number().int().nonnegative(),
  prevalence: ProportionEstimateSchema.nullable(),
  sensitivity: ProportionEstimateSchema.nullable(),
  specificity: ProportionEstimateSchema.nullable(),
  positivePredictiveValue: ProportionEstimateSchema.nullable(),
  negativePredictiveValue: ProportionEstimateSchema.nullable(),
  accuracy: ProportionEstimateSchema.nullable(),
  /**
   * Mean of sensitivity and specificity; the number results are ordered by.
   * `null` when either rate is not estimable.
   */
  balancedAccuracy: z.number().nullable(),
  /** Present only when every scored item carried a score. */
  auc: AucEstimateSchema.nullable(),
  coverage: z.number(),
});
export type BinaryDiagnosticScores = z.infer<typeof BinaryDiagnosticScoresSchema>;

/**
 * A scored submission's metrics, tagged with the scoring family that produced
 * them (ADR-0020).
 *
 * The envelope exists because the metric sets are not union-compatible and must
 * not be flattened into one mostly-null object: a reader has to know which
 * family a number came from before it means anything. Consumers discriminate on
 * `kind` before reading `metrics`.
 *
 * Rows written before ADR-0020 stored the bare `GRADING` object with no `kind`.
 * The API coerces those to `{ kind: 'GRADING', metrics }` on read, so the wire
 * shape is uniform even though the stored history is not.
 */
export const TaskKindScoresSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('GRADING'), metrics: GradingScoresSchema }),
  z.object({ kind: z.literal('CLASSIFICATION'), metrics: ClassificationScoresSchema }),
  z.object({ kind: z.literal('BINARY_DIAGNOSTIC'), metrics: BinaryDiagnosticScoresSchema }),
]);
export type TaskKindScores = z.infer<typeof TaskKindScoresSchema>;

// ---- Results by subgroup (#410, ADR-0030) ----------------------------------
//
// Computed at scoring time by the task kind's own scorer, run on the items of
// one subgroup, and stored with the submission AFTER suppression: a withheld
// group is stored with its value and label and nothing else, so there is no
// stored figure a later bug could publish.
//
// Within a group only the headline figures are published. Per-class tables and
// confusion counts are not: inside one subgroup they are counts of patients
// by demographic AND condition, the small cells suppression exists to keep out.

/**
 * `GRADING` headline figures for one group. The referable rates are `null`
 * when withheld (`ratesWithheld`) or when no scored item of the group falls in
 * their denominator.
 */
export const GradingSubgroupMetricsSchema = z
  .object({
    kind: z.literal('GRADING'),
    qwk: z.number(),
    accuracy: z.number(),
    referableSensitivity: z.number().nullable(),
    referableSpecificity: z.number().nullable(),
    /**
     * True when the referable rates are withheld: their denominators (the
     * group's referable and non-referable items) include a count from 1 to
     * 10, or would let one be worked out.
     */
    ratesWithheld: z.boolean(),
  })
  .strict();

/** `CLASSIFICATION` headline figures for one group. No per-class table. */
export const ClassificationSubgroupMetricsSchema = z
  .object({
    kind: z.literal('CLASSIFICATION'),
    accuracy: z.number(),
    balancedAccuracy: z.number(),
    macroF1: z.number(),
  })
  .strict();

/**
 * `BINARY_DIAGNOSTIC` figures for one group, with their Wilson intervals,
 * which are wider than the overall ones because they rest on fewer items.
 * Accuracy rests on the group's scored items and is always present. The other
 * rates are withheld together when any of their denominators (positive and
 * negative reference items, positive and negative file labels) is from 1 to
 * 10, or would let one be worked out: published together, the four rates and
 * their bases give the whole two-by-two table.
 */
export const BinaryDiagnosticSubgroupMetricsSchema = z
  .object({
    kind: z.literal('BINARY_DIAGNOSTIC'),
    accuracy: ProportionEstimateSchema,
    prevalence: ProportionEstimateSchema.nullable(),
    sensitivity: ProportionEstimateSchema.nullable(),
    specificity: ProportionEstimateSchema.nullable(),
    positivePredictiveValue: ProportionEstimateSchema.nullable(),
    negativePredictiveValue: ProportionEstimateSchema.nullable(),
    balancedAccuracy: z.number().nullable(),
    auc: AucEstimateSchema.nullable(),
    ratesWithheld: z.boolean(),
  })
  .strict();

export const SubgroupMetricsSchema = z.discriminatedUnion('kind', [
  GradingSubgroupMetricsSchema,
  ClassificationSubgroupMetricsSchema,
  BinaryDiagnosticSubgroupMetricsSchema,
]);
export type SubgroupMetrics = z.infer<typeof SubgroupMetricsSchema>;

/**
 * One group of one field. `SUPPRESSED` carries no count and no figure, and
 * does not say whether the group was small or was withheld so that a small
 * one could not be worked out from the others: saying which would narrow the
 * small one down.
 */
export const SubgroupCellSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('REPORTED'),
      value: SubgroupValueCodeSchema,
      label: z.string(),
      /** Items of the task in this group. */
      itemCount: z.number().int().nonnegative(),
      /** Of those, the items this submission gave a label for: what the figures rest on. */
      scoredCount: z.number().int().nonnegative(),
      metrics: SubgroupMetricsSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('SUPPRESSED'),
      value: SubgroupValueCodeSchema,
      label: z.string(),
    })
    .strict(),
]);
export type SubgroupCell = z.infer<typeof SubgroupCellSchema>;

export const SubgroupFieldResultSchema = z
  .object({
    key: SubgroupFieldKeySchema,
    label: z.string(),
    /** One per declared value, in the declared order. */
    cells: z.array(SubgroupCellSchema),
  })
  .strict();
export type SubgroupFieldResult = z.infer<typeof SubgroupFieldResultSchema>;

/** A submission's results by subgroup, as stored and as published. */
export const SubgroupResultsSchema = z
  .object({
    /** The threshold applied when these results were computed. */
    minCellSize: z.number().int().positive(),
    fields: z.array(SubgroupFieldResultSchema),
  })
  .strict();
export type SubgroupResults = z.infer<typeof SubgroupResultsSchema>;

/** Summary row for `GET /v2/evaluation/tasks`. NEVER carries groundTruth. */
export const EvaluationTaskSummarySchema = z.object({
  id: z.string().uuid(),
  slug: EvaluationTaskSlugSchema,
  name: z.string(),
  datasetSlug: z.string(),
  taskKind: EvaluationTaskKindDbSchema,
  submissionCount: z.number().int(),
});
export type EvaluationTaskSummary = z.infer<typeof EvaluationTaskSummarySchema>;

/** One submission's public result. NEVER carries predictions or GT. */
export const EvaluationSubmissionResultSchema = z
  .object({
    id: z.string().uuid(),
    methodName: z.string(),
    status: SubmissionStatusSchema,
    /** `null` until SCORED (PENDING) or when FAILED. */
    scores: TaskKindScoresSchema.nullable(),
    /**
     * The route that produced the score (WP5 invariant 3). Null only when
     * `scores` is null — a score without its route is not a meaningful result,
     * and the refinement below makes that unrepresentable rather than merely
     * discouraged.
     */
    attribution: ScoreAttributionSchema.nullable(),
    createdAt: z.string(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.scores !== null && r.attribution === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['attribution'],
        message: 'a score cannot be returned without its route attribution (WP5 invariant 3)',
      });
    }
  });
export type EvaluationSubmissionResult = z.infer<typeof EvaluationSubmissionResultSchema>;

/**
 * Detail for `GET /v2/evaluation/tasks/:slug` — task meta + its submissions'
 * results, ordered best-QWK first. NEVER carries groundTruth.
 *
 * `itemIds` publishes the task's item-ID KEY SET (#441). That is the same set a
 * sealed run already receives as `/input/index.json`, so it discloses nothing a
 * participant was not going to be given — but a Mode 1 participant had no way
 * to reach it, and had to infer the ID convention from the dataset manifest.
 * Getting that wrong scores as coverage 0, which reads as a bad model rather
 * than bad plumbing.
 *
 * The keys are NOT the labels. The boundary is the same one drawn in the API's
 * `submission-validation.ts`: the key set is public, anything derived from a
 * label is not, and the row type the service receives has no field for a label
 * at all.
 */
export const EvaluationTaskDetailSchema = z.object({
  id: z.string().uuid(),
  slug: EvaluationTaskSlugSchema,
  name: z.string(),
  datasetSlug: z.string(),
  taskKind: EvaluationTaskKindDbSchema,
  numClasses: z.number().int(),
  referableThreshold: z.number().int(),
  /**
   * `BINARY_DIAGNOSTIC`: what label 1 means, in words — the positive class the
   * sensitivity and predictive values are about (#650). `null` for the other
   * kinds, and for a binary task created without one.
   */
  positiveClassName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * Every item identifier this task scores against, sorted. Predictions are
   * keyed on these. Missing items are permitted and reported as reduced
   * coverage; unknown identifiers are a validation failure. The set is not
   * necessarily contiguous or densely numbered — read it, do not generate it.
   */
  itemIds: z.array(z.string()),
  /** `itemIds.length`, denormalised so a client can show it without the array. */
  itemCount: z.number().int(),
  /**
   * The fields results are broken down by (#410), with their labels and
   * allowed values; `[]` when none. Which item has which value is NOT
   * published: per item, those values are quasi-identifiers.
   */
  subgroupFields: z.array(SubgroupFieldSchema),
  submissions: z.array(EvaluationSubmissionResultSchema),
});
export type EvaluationTaskDetail = z.infer<typeof EvaluationTaskDetailSchema>;

/**
 * `POST /v2/evaluation/tasks/:slug/submissions` — Mode 1 submit.
 *
 * `grade` is bounded to a non-negative integer with a generous static
 * ceiling here so a malformed payload is rejected at the DTO boundary; the
 * exact `0..(numClasses-1)` range is enforced task-aware in the scoring
 * service (which knows N) and a violation there persists a FAILED
 * submission + returns 4xx.
 *
 * `intent` defaults to `SCORED`, so a body written against the pre-WP6 shape
 * means exactly what it meant before. `intent: 'VALIDATION'` runs the same
 * checks and returns a `SubmissionValidationReport` instead of a score.
 */
export const SubmitPredictionsRequestSchema = z.object({
  methodName: z.string().min(1).max(120),
  intent: SubmissionIntentSchema.default('SCORED'),
  // The row shape and the cap live in `predictions-file.ts`, which reads the
  // same rows out of an uploaded file. One definition, so a file the reader
  // accepts is a body this schema accepts.
  predictions: z.array(PredictionRowSchema).min(1).max(MAX_PREDICTION_ROWS),
  /**
   * The model card this submission scores (#587), from
   * `GET /v2/prediction/model-cards/mine`. The caller must be that card's
   * submitter and the card must not be WITHDRAWN. Ignored with
   * `intent: 'VALIDATION'`, which records nothing.
   */
  modelCardId: z.string().uuid().optional(),
});
export type SubmitPredictionsRequest = z.infer<typeof SubmitPredictionsRequestSchema>;

/** `POST .../submissions` response — the new submission id + its scores. */
export const SubmitPredictionsResponseSchema = z.object({
  id: z.string().uuid(),
  scores: TaskKindScoresSchema,
});
export type SubmitPredictionsResponse = z.infer<typeof SubmitPredictionsResponseSchema>;

/**
 * `POST /v2/evaluation/tasks` — admin/host create a task, including the
 * HIDDEN ground-truth map. This is how a task + labels are created outside
 * of raw SQL. `groundTruth` is validated to be a non-empty `imageId ->
 * integer label` map with every label inside `[0, numClasses-1]`.
 */
export const CreateEvaluationTaskRequestSchema = z
  .object({
    slug: EvaluationTaskSlugSchema,
    name: z.string().min(1).max(200),
    datasetSlug: z.string().min(1).max(200),
    taskKind: EvaluationTaskKindDbSchema.default('GRADING'),
    numClasses: z.number().int().min(2).max(1000).default(5),
    referableThreshold: z.number().int().min(1).default(2),
    /**
     * Required for `BINARY_DIAGNOSTIC`, refused for the other kinds: what label 1
     * means, in words (e.g. "Pneumothorax present"). Published with the task.
     */
    positiveClassName: z.string().trim().min(1).max(200).optional(),
    groundTruth: z.record(z.string().min(1).max(200), z.number().int().min(0)),
    /**
     * Optional (#410): the fields results are broken down by, and each item's
     * value for each of them. Every item of `groundTruth` needs a value for
     * every field, from the values the field declares. The declaration is
     * published with the task; the item map is held like the answer key.
     */
    subgroups: SubgroupDeclarationSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const entries = Object.entries(value.groundTruth);
    if (value.subgroups !== undefined) {
      for (const issue of subgroupDeclarationIssues(
        value.subgroups,
        Object.keys(value.groundTruth),
      )) {
        ctx.addIssue({
          code: 'custom',
          path: ['subgroups', ...issue.path],
          message: issue.message,
        });
      }
    }
    if (value.taskKind === 'BINARY_DIAGNOSTIC') {
      if (value.numClasses !== 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['numClasses'],
          message: 'a BINARY_DIAGNOSTIC task has exactly 2 classes (0 absent, 1 present)',
        });
      }
      if (value.referableThreshold !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['referableThreshold'],
          message: 'a BINARY_DIAGNOSTIC task takes referableThreshold 1 (label 1 is the finding)',
        });
      }
      if (value.positiveClassName === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['positiveClassName'],
          message: 'a BINARY_DIAGNOSTIC task must state its positive class in words',
        });
      }
    } else if (value.positiveClassName !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['positiveClassName'],
        message: 'positiveClassName applies to BINARY_DIAGNOSTIC tasks only',
      });
    }
    if (entries.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['groundTruth'],
        message: 'groundTruth must have at least one entry',
      });
    }
    if (value.referableThreshold > value.numClasses - 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['referableThreshold'],
        message: `referableThreshold must be ≤ numClasses - 1 (${value.numClasses - 1})`,
      });
    }
    for (const [imageId, label] of entries) {
      if (label > value.numClasses - 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['groundTruth', imageId],
          message: `ground-truth label ${label} for "${imageId}" is out of range [0, ${value.numClasses - 1}]`,
        });
      }
    }
  });
export type CreateEvaluationTaskRequest = z.infer<typeof CreateEvaluationTaskRequestSchema>;

// ==== Sealed execution (Mode 2 / CONTAINER) ================================
//
// The wire contract between three components, so all three validate the same
// shape: the API enqueues, `apps/worker-eval` consumes, and the worker POSTs
// back to the outbox. Spec:
// docs/planning/evaluation-challenge-2026-08/sealed-execution-contract.md.
//
// Two guarantees drive every field: the host's data is never disclosed to the
// participant, and the participant's model is executed but never inspected or
// retained. Notably absent from the queue message is anything the container
// could use to phone home or identify the submission — the worker holds the
// callback URL, the container never sees it.
// ===========================================================================

/**
 * A registry reference pinned by digest. Tags are rejected outright: a tag can
 * be repointed after review, which would let a different image run under an
 * approved route (sealed-execution-contract §4, "pull and run by digest").
 */
export const ImageDigestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, 'must be a sha256 digest, e.g. sha256:<64 hex chars>');
export type ImageDigest = z.infer<typeof ImageDigestSchema>;

export const ImageRefSchema = z
  .string()
  .min(1)
  .max(1000)
  .refine((v) => v.includes('@sha256:'), {
    message: 'imageRef must include an @sha256: digest — tags are rejected',
  });
export type ImageRef = z.infer<typeof ImageRefSchema>;

/**
 * Body of a message on `oci-eval-submissions-{env}`. Mirror this as a Pydantic
 * model in the worker; drift between the two is the likeliest source of a
 * silently skipped control.
 *
 * `routeId` / `routeVersion` are the evaluation method version pinned to the
 * submission when it was accepted (#583). Required: the API refuses a
 * submission it cannot pin, so every dispatch carries one, and the outbox
 * refuses a result whose reported `routeVersion` disagrees with it. The
 * worker's model keeps them optional so a message queued before #583 is still
 * consumed.
 */
export const SealedRunMessageSchema = z.object({
  submissionId: z.string().uuid(),
  taskSlug: EvaluationTaskSlugSchema,
  routeId: z.string().uuid(),
  routeVersion: z.string().min(1).max(64),
  imageRef: ImageRefSchema,
  imageDigest: ImageDigestSchema,
  /**
   * Hard wall-clock cap, from the task's operational envelope.
   *
   * Capped at SQS's 43200 s `VisibilityTimeout` ceiling, because the queue's
   * visibility timeout must exceed this value plus pull and outbox time
   * (sealed-execution-contract §2). A larger value here could not be covered
   * by any queue, so it is refused at the contract rather than at synth. The
   * real per-environment cap is `evalRunner.maxRunSeconds`, which the eval
   * stack asserts leaves room for its allowances.
   */
  timeoutSec: z.number().int().min(1).max(43_200),
  /** Absolute outbox URL. Held by the worker; never passed into the container. */
  callbackUrl: z.string().url(),
  /** After this instant the worker abandons rather than starts a run. */
  deadline: z.string().datetime(),
});
export type SealedRunMessage = z.infer<typeof SealedRunMessageSchema>;

/**
 * Classified failure codes. Participant-facing text is derived from the code
 * alone — operator detail stays server-side, because container stdout is an
 * exfiltration channel (sealed-execution-contract §6).
 */
export const SealedRunFailureCodeSchema = z.enum([
  'IMAGE_PULL_FAILED',
  'DIGEST_MISMATCH',
  'STARTUP_FAILED',
  'TIMEOUT',
  'OOM_KILLED',
  'NONZERO_EXIT',
  'NO_OUTPUT',
  'MALFORMED_OUTPUT',
  'UNKNOWN_ITEM_IDS',
  'OUTPUT_TOO_LARGE',
  'NETWORK_ATTEMPT_DETECTED',
  'INTERNAL_ERROR',
]);
export type SealedRunFailureCode = z.infer<typeof SealedRunFailureCodeSchema>;

/**
 * `POST /v2/submissions/:id/result` — the worker's outbox call.
 *
 * Exactly one of `predictions`, `metrics` or `failure` is present. `predictions`
 * is the demo path: the worker returns labels and the API scores them against
 * ground truth it already holds, which keeps ground truth out of the sandbox
 * and `scoring.ts` the single scoring implementation. `metrics` is the
 * genuinely host-resident path, where the API cannot see the data and the
 * worker scored against host-side labels.
 */
export const SealedRunResultSchema = z
  .object({
    routeVersion: z.string().min(1).max(64).optional(),
    durationMs: z.number().int().min(0),
    predictions: z.record(z.string().min(1).max(200), z.number().int().min(0)).optional(),
    metrics: EvaluationScoresSchema.optional(),
    failure: z
      .object({
        code: SealedRunFailureCodeSchema,
        /** Operator-facing. Never echoed to the participant verbatim. */
        detail: z.string().max(4000).optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    const present = [
      value.predictions !== undefined,
      value.metrics !== undefined,
      value.failure !== undefined,
    ].filter(Boolean).length;
    if (present !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'exactly one of predictions, metrics or failure must be present',
      });
    }
  });
export type SealedRunResult = z.infer<typeof SealedRunResultSchema>;

/**
 * `POST .../submissions` with `mode: CONTAINER` — enqueue rather than score.
 * The image must be digest-pinned at submission time; a tag is refused at the
 * boundary rather than at dispatch.
 */
export const SubmitContainerRequestSchema = z.object({
  methodName: z.string().min(1).max(120),
  mode: z.literal('CONTAINER'),
  intent: SubmissionIntentSchema.default('SCORED'),
  imageRef: ImageRefSchema,
  imageDigest: ImageDigestSchema,
  /** Same as on the predictions request (#587). */
  modelCardId: z.string().uuid().optional(),
});
export type SubmitContainerRequest = z.infer<typeof SubmitContainerRequestSchema>;

/** `POST .../submissions` (CONTAINER) response — accepted, not yet scored. */
export const SubmitContainerResponseSchema = z.object({
  id: z.string().uuid(),
  status: SubmissionStatusSchema,
});
export type SubmitContainerResponse = z.infer<typeof SubmitContainerResponseSchema>;

// ==== Validation submissions + scored-submission quota (WP6) ===============
//
// Two halves of the same participant-experience problem. A model-to-data
// challenge hides the data, so a participant cannot debug a broken submission
// by looking at it; and a scored submission against hidden ground truth is an
// oracle query, so scored submissions have to be rationed. Unlimited unscored
// validation is what makes a rationed scored path fair.
//
// GROUND TRUTH: a validation report is derived from the task's item-ID KEY SET
// and never from a label. The reasoning for exactly where that line sits is in
// `apps/api/src/modules/evaluation/submission-validation.ts`, next to the code
// that has to honour it.
// ===========================================================================

/** Which of the two scored-submission limits a quota rejection is about. */
export const ScoredSubmissionQuotaScopeSchema = z.enum(['WEEK', 'TASK_TOTAL']);
export type ScoredSubmissionQuotaScope = z.infer<typeof ScoredSubmissionQuotaScopeSchema>;

/**
 * Machine-readable companion to a `429` quota rejection, so a client can show a
 * countdown without parsing prose.
 *
 * `resetsAt` is `null` for `TASK_TOTAL` and only for `TASK_TOTAL`: the per-task
 * cap is a lifetime cap with no later instant at which it frees up. Reporting a
 * fabricated reset for it would be the exact support email WP6 exists to avoid.
 */
export const ScoredSubmissionQuotaStateSchema = z.object({
  scope: ScoredSubmissionQuotaScopeSchema,
  limit: z.number().int(),
  used: z.number().int(),
  /** ISO-8601 instant, or `null` when the limit does not reset. */
  resetsAt: z.string().nullable(),
});
export type ScoredSubmissionQuotaState = z.infer<typeof ScoredSubmissionQuotaStateSchema>;

/**
 * `GET /v2/evaluation/tasks/:slug/quota` — what the signed-in caller has left on
 * one task (#645), so a page can show it BEFORE the caller spends a slot rather
 * than only in the refusal.
 *
 * Both limits are reported because both bind: `remaining` is the smaller of the
 * two, and a caller with weekly slots left but the task total exhausted has
 * none. `week.resetsAt` is always a real instant (next Monday 00:00 UTC); the
 * total has no reset, which is why it has no such field.
 */
export const ScoredSubmissionQuotaSummarySchema = z.object({
  taskSlug: EvaluationTaskSlugSchema,
  week: z.object({
    limit: z.number().int(),
    used: z.number().int(),
    remaining: z.number().int().nonnegative(),
    /** ISO-8601 instant the weekly allowance frees up. */
    resetsAt: z.string(),
  }),
  total: z.object({
    limit: z.number().int(),
    used: z.number().int(),
    remaining: z.number().int().nonnegative(),
  }),
  /** Scored submissions the caller can still make now: the smaller remainder. */
  remaining: z.number().int().nonnegative(),
});
export type ScoredSubmissionQuotaSummary = z.infer<typeof ScoredSubmissionQuotaSummarySchema>;

/**
 * Why a submission failed, as its submitter (or an administrator) is told.
 *
 * `quotaConsumed` is false for a predictions file refused before scoring: the
 * file was never compared with the reference labels, so it cost the host
 * nothing and told the participant nothing about them. A sealed run that failed
 * did occupy an evaluation slot, and counts.
 */
export const EvaluationSubmissionFailureSchema = z.object({
  /** Participant-facing text. Never a sealed run's operator detail. */
  reason: z.string(),
  quotaConsumed: z.boolean(),
});
export type EvaluationSubmissionFailure = z.infer<typeof EvaluationSubmissionFailureSchema>;

/**
 * `GET /v2/evaluation/tasks/:slug/submissions/:id` — one submission with its
 * full result (#645). NEVER carries predictions or ground truth.
 *
 * WHO SEES WHAT. A SCORED or PENDING submission is as public as the task's
 * result list it already appears in. A FAILED one is returned to its submitter
 * and to administrators only, with the reason; anyone else gets a 404, the same
 * answer as for an id that does not exist.
 *
 * `task` repeats the handful of task fields a reader needs to interpret the
 * numbers (the kind decides which metric set this is; the threshold defines
 * "referable"), so a page showing one submission does not have to load the
 * task's whole result list and item identifiers to print them.
 *
 * The submitter's identity is not part of this shape. `viewerIsSubmitter` says
 * only whether the caller is that person.
 */
export const EvaluationSubmissionDetailSchema = z
  .object({
    id: z.string().uuid(),
    task: z.object({
      slug: EvaluationTaskSlugSchema,
      name: z.string(),
      datasetSlug: z.string(),
      taskKind: EvaluationTaskKindDbSchema,
      numClasses: z.number().int(),
      referableThreshold: z.number().int(),
      /** Same as on the task detail: label 1 in words, binary tasks only. */
      positiveClassName: z.string().nullable(),
    }),
    methodName: z.string(),
    mode: SubmissionModeSchema,
    status: SubmissionStatusSchema,
    /** `null` until SCORED. For CLASSIFICATION, `metrics.perClass` is the per-class breakdown. */
    scores: TaskKindScoresSchema.nullable(),
    /**
     * Results by subgroup (#410), small groups withheld. `null` when the task
     * declares no subgroup field, when the submission is not scored, or when it
     * was scored before the task declared one.
     */
    subgroups: SubgroupResultsSchema.nullable(),
    /** Null only when `scores` is null — same invariant as the list row. */
    attribution: ScoreAttributionSchema.nullable(),
    /** Non-null exactly when `status` is FAILED. */
    failure: EvaluationSubmissionFailureSchema.nullable(),
    /**
     * The model card the submitter linked this submission to (#587). `null`
     * when there is none, or when the reader may not see that card (a DRAFT or
     * SUBMITTED card is visible to its submitter and reviewers only).
     */
    modelCard: SubmissionModelCardSchema.nullable(),
    viewerIsSubmitter: z.boolean(),
    createdAt: z.string(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.scores !== null && r.attribution === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['attribution'],
        message: 'a score cannot be returned without its route attribution (WP5 invariant 3)',
      });
    }
    if ((r.status === 'FAILED') !== (r.failure !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'failure is present exactly when the submission is FAILED',
      });
    }
  });
export type EvaluationSubmissionDetail = z.infer<typeof EvaluationSubmissionDetailSchema>;

// ---- Evidence summary of one evaluated submission (#652) -------------------
//
// `GET /v2/evaluation/submissions/:id/evidence`: what a decision-maker needs
// about one evaluated model, assembled from what the platform already holds,
// in the seven sections of the printable page. Every section can be empty,
// and says why through `gaps` rather than failing. It carries no prediction,
// no reference label and no person: the trace is hashes and event types.

/**
 * Below this many positive reference cases, sensitivity rests on too few
 * patients to be read without its interval, and the summary says so (#652).
 * Stated on the page, so a reader knows the threshold applied.
 */
export const EVIDENCE_MIN_POSITIVE_CASES = 50;

/** At most this many audit events are listed in the trace (#652). */
export const EVIDENCE_MAX_TRACE_EVENTS = 50;

/**
 * What the evidence does not show, one code per gap. The page words each
 * one; a JSON consumer reads the code, its section and its parameters.
 */
export const EvidenceGapCodeSchema = z.enum([
  // 1 · Intended use and risk tier
  'NO_MODEL_CARD',
  'MODEL_CARD_NOT_PUBLISHED',
  'NO_INTENDED_USE',
  // 2 · Data
  'DATASET_NOT_AVAILABLE',
  'SYNTHETIC_DATA',
  'REFERENCE_LABELS_UNDOCUMENTED',
  'SINGLE_READER_LABELS',
  'READER_AGREEMENT_NOT_REPORTED',
  // 3 · Method
  'METHOD_NOT_ATTRIBUTED',
  'METHOD_NOT_APPROVED',
  'METHOD_RETRACTED',
  // 4 · Performance
  'NOT_SCORED',
  'NO_INTERVALS',
  'FEW_POSITIVE_CASES',
  'INCOMPLETE_COVERAGE',
  // 5 · Subgroups
  'NO_SUBGROUP_DATA',
  'SUBGROUPS_WITHHELD',
  // 7 · Trace
  'NO_AUDIT_EVENTS',
  'AUDIT_RESULT_EVENT_MISSING',
]);
export type EvidenceGapCode = z.infer<typeof EvidenceGapCodeSchema>;

export const EvidenceGapSchema = z
  .object({
    code: EvidenceGapCodeSchema,
    /** The page section the gap belongs to, 1 to 7. */
    section: z.number().int().min(1).max(7),
    /** Values the sentence quotes (a status, a count, a share). */
    params: z.record(z.string(), z.union([z.string(), z.number()])),
  })
  .strict();
export type EvidenceGap = z.infer<typeof EvidenceGapSchema>;

/** Section 1, from the model card linked to the submission. */
export const EvidenceModelCardSchema = z
  .object({
    slug: z.string(),
    version: z.string(),
    status: EvidenceModelCardStatusSchema,
    modelDeveloper: z.string().nullable(),
    clinicalSummary: z.string().nullable(),
    /** Null when the stored statement does not read as a valid one. */
    intendedUse: EvidenceIntendedUseSchema.nullable(),
    knownBiases: z.string().nullable(),
  })
  .strict();
export type EvidenceModelCard = z.infer<typeof EvidenceModelCardSchema>;

/** Section 2, the dataset, as its published manifest describes it. */
export const EvidenceDatasetSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    /** Latest published version: the evaluation task names the dataset, not a version. */
    version: z.string().nullable(),
    publishedAt: z.string().nullable(),
    /** sha256 of the published manifest of that version. */
    manifestSha256: z.string().nullable(),
    /** The manifest's `license`, as written (an IRI or an SPDX id). */
    licence: z.string().nullable(),
    /** `bio:synthetic`: the files are generated, not patient data. */
    synthetic: z.boolean(),
    sourceOrganizations: z.array(z.string()),
    derivedFrom: z.array(z.string()),
    /** `rai:dataCollection`, as written. */
    collection: z.string().nullable(),
    collectionTimeframe: z.string().nullable(),
  })
  .strict();
export type EvidenceDataset = z.infer<typeof EvidenceDatasetSchema>;

/** How the reference labels were made, from the manifest's label protocol. */
export const EvidenceReferenceLabelsSchema = z
  .object({
    protocolVersion: z.string().nullable(),
    labelScale: z.string().nullable(),
    readersPerItem: z.number().int().positive().nullable(),
    readerQualification: z.string().nullable(),
    adjudication: z.string().nullable(),
    agreement: z.object({ metric: z.string(), value: z.number() }).strict().nullable(),
    /** `rai:dataAnnotationProtocol`, as written. */
    annotationProtocol: z.string().nullable(),
  })
  .strict();
export type EvidenceReferenceLabels = z.infer<typeof EvidenceReferenceLabelsSchema>;

/** Section 3, the evaluation method version that produced the result. */
export const EvidenceMethodSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('ROUTED'),
      routeSlug: z.string(),
      routeName: z.string(),
      /** Null for the OCI reference implementation. */
      providerName: z.string().nullable(),
      isReference: z.boolean(),
      version: z.string(),
      reviewStatus: RouteReviewStatusSchema,
      reviewedAt: z.string().nullable(),
      /** The reviewer's rationale, published with the decision (ADR-0021). */
      reviewNotes: z.string().nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('NOT_ATTRIBUTED') }).strict(),
]);
export type EvidenceMethod = z.infer<typeof EvidenceMethodSchema>;

/**
 * Where the result stands, by the one rule that decides publication
 * (`attributionFor`, WP5): APPROVED method versions publish, DECLARED and
 * UNDER_REVIEW ones are provisional, REJECTED and WITHDRAWN retract.
 */
export const EvidenceStandingSchema = z.enum([
  'PUBLISHED',
  'PROVISIONAL',
  'RETRACTED',
  'NOT_ATTRIBUTED',
  'NOT_SCORED',
]);
export type EvidenceStanding = z.infer<typeof EvidenceStandingSchema>;

/**
 * Sensitivity, specificity and predictive values of a two-class
 * classification result, with class 1 as the positive class (#652). The four
 * counts are recovered exactly from the stored per-class support and recall,
 * and checked against the stored precision and accuracy; the rates and their
 * Wilson intervals come from the same function as `BINARY_DIAGNOSTIC`
 * scoring. `NOT_RECOVERABLE` when the stored figures do not determine the
 * counts uniquely: nothing is approximated.
 */
export const EvidenceDerivedDiagnosticSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('DERIVED'),
      positiveLabel: z.literal(1),
      truePositives: z.number().int().nonnegative(),
      falsePositives: z.number().int().nonnegative(),
      trueNegatives: z.number().int().nonnegative(),
      falseNegatives: z.number().int().nonnegative(),
      sensitivity: ProportionEstimateSchema.nullable(),
      specificity: ProportionEstimateSchema.nullable(),
      positivePredictiveValue: ProportionEstimateSchema.nullable(),
      negativePredictiveValue: ProportionEstimateSchema.nullable(),
    })
    .strict(),
  z.object({ status: z.literal('NOT_RECOVERABLE') }).strict(),
]);
export type EvidenceDerivedDiagnostic = z.infer<typeof EvidenceDerivedDiagnosticSchema>;

/** One event of the submission's audit trail: what happened, when, and its hashes. */
export const EvidenceTraceEventSchema = z
  .object({
    sequenceNumber: z.string(),
    occurredAt: z.string(),
    eventType: z.string(),
    payloadHash: z.string(),
    previousHash: z.string().nullable(),
    recordHash: z.string(),
  })
  .strict();
export type EvidenceTraceEvent = z.infer<typeof EvidenceTraceEventSchema>;

export const EvidenceSummarySchema = z
  .object({
    format: z.literal('oci-evidence-summary/v1'),
    generatedAt: z.string(),
    submission: z
      .object({
        id: z.string().uuid(),
        methodName: z.string(),
        mode: SubmissionModeSchema,
        status: SubmissionStatusSchema,
        createdAt: z.string(),
        viewerIsSubmitter: z.boolean(),
      })
      .strict(),
    task: z
      .object({
        slug: EvaluationTaskSlugSchema,
        name: z.string(),
        taskKind: EvaluationTaskKindDbSchema,
        numClasses: z.number().int(),
        referableThreshold: z.number().int(),
        positiveClassName: z.string().nullable(),
        /** The dataset the task names, whether or not the reader may see it. */
        datasetSlug: z.string(),
        /** Items in the task's reference set. The labels themselves are never sent. */
        itemCount: z.number().int().nonnegative(),
      })
      .strict(),
    modelCard: EvidenceModelCardSchema.nullable(),
    data: z
      .object({
        dataset: EvidenceDatasetSchema.nullable(),
        referenceLabels: EvidenceReferenceLabelsSchema.nullable(),
      })
      .strict(),
    method: EvidenceMethodSchema,
    performance: z
      .object({
        standing: EvidenceStandingSchema,
        scores: TaskKindScoresSchema.nullable(),
        /**
         * Positive reference cases among the scored items: TP + FN for a
         * binary finding, the support of label 1 for a two-class
         * classification. Null where the task has no single positive class.
         */
        positiveCases: z.number().int().nonnegative().nullable(),
        minPositiveCases: z.number().int().positive(),
        /**
         * Two-class classification only: the diagnostic measures derived
         * from the stored per-class result, class 1 positive. Null for any
         * other task kind or class count.
         */
        derivedDiagnostic: EvidenceDerivedDiagnosticSchema.nullable(),
      })
      .strict(),
    /** Stored already suppressed, read as the submission page reads it (ADR-0030). */
    subgroups: SubgroupResultsSchema.nullable(),
    trace: z
      .object({
        events: z.array(EvidenceTraceEventSchema),
        /** True when the submission has more events than are listed. */
        truncated: z.boolean(),
      })
      .strict(),
    gaps: z.array(EvidenceGapSchema),
  })
  .strict();
export type EvidenceSummary = z.infer<typeof EvidenceSummarySchema>;

export const tokens = {
  /** Phase B.A.1 added: Campaign, AnnotationToolIntegration (stub registry). */
  /** Phase B.A.2 will add: Task, TaskAssignment, Annotation, gate decisions. */
  /** Phase C added (ADR-0017): EvaluationTask, Submission (evaluation surface). */
  /** Phase D will add: Report, ReportTemplate, AuditEvent */
  /** Phase E will add: DMXP transaction envelope, FederatedConnector */
  /** PR E.2 will add: RemoteDataset, ListDatasetsQuery.source */
};

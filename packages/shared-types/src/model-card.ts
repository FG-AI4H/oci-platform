import { z } from 'zod';
import { IntendedUseStatementSchema } from './intended-use.js';
import { ModelClassSchema, type ModelClass } from './evaluation-task-kind.js';
import { RegulatoryPathwaySchema } from './regulatory-pathway.js';

/**
 * Model Card — the AI-submission carrier (#260, ADR-0013 amended + ADR-0015).
 *
 * The Intended-Use Statement attaches HERE, on the model submission —
 * never on a dataset (ADR-0013 amendment 2026-05-17). A dataset is a
 * multi-purpose resource; suitability for an intended use is a matching
 * concern of the submission, not a dataset field. `intendedUse` is
 * therefore non-optional: a model card without an IUS is rejected.
 */

const SEMVER = /^\d+\.\d+\.\d+$/;
// Lowercase alphanumerics + hyphens. Kept as a single character class
// (no nested quantifier) so it's linear-time — security/detect-unsafe-regex.
const SLUG = /^[a-z0-9-]+$/;

/** Model card slug — also validates the `:slug` path param on the public reads (#591). */
export const ModelCardSlugSchema = z.string().min(3).max(120).regex(SLUG);
export type ModelCardSlug = z.infer<typeof ModelCardSlugSchema>;

/**
 * Free-text search input. Postgres rejects NUL in text parameters with an
 * encoding error, which would surface as a 500 on a public endpoint — refuse
 * it here as a 400 instead.
 */
const searchText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !s.includes('\0'), 'NUL characters are not allowed');

/**
 * Model lifecycle (#432, ADR-0019 Decision 3 / CHAI `ReleaseInfo.ReleaseStage`).
 * A card starts DRAFT; only a non-DRAFT card is eligible for the Model Facts
 * Label (#261) and the CHAI export (#433).
 */
export const ModelCardStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'PUBLISHED', 'WITHDRAWN']);
export type ModelCardStatus = z.infer<typeof ModelCardStatusSchema>;

// Allowed lifecycle moves. A Map (not an object index) keeps the lookup free of
// dynamic-key access — eslint security/detect-object-injection.
const TRANSITIONS = new Map<ModelCardStatus, ReadonlyArray<ModelCardStatus>>([
  ['DRAFT', ['SUBMITTED']],
  ['SUBMITTED', ['PUBLISHED', 'DRAFT']], // back to DRAFT = returned for revision
  ['PUBLISHED', ['WITHDRAWN']],
  ['WITHDRAWN', []], // terminal
]);

export function allowedTransitionsFrom(from: ModelCardStatus): ReadonlyArray<ModelCardStatus> {
  return TRANSITIONS.get(from) ?? [];
}

export function canTransition(from: ModelCardStatus, to: ModelCardStatus): boolean {
  return allowedTransitionsFrom(from).includes(to);
}

/** Regulatory approval state (CHAI `ReleaseInfo.RegulatoryApproval`). Reuses the
 * platform's existing pathway vocabulary from #120 rather than a parallel one. */
export const RegulatoryApprovalSchema = z
  .object({
    pathway: RegulatoryPathwaySchema,
    status: z.enum(['none', 'pending', 'granted', 'withdrawn']),
    /** ISO-3166 alpha-2 or region codes the approval covers. */
    jurisdictions: z.array(z.string().min(2).max(64)).max(32).default([]),
    /** Certificate / clearance number, when granted. */
    identifier: z.string().max(200).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type RegulatoryApproval = z.infer<typeof RegulatoryApprovalSchema>;

export const CreateModelCardRequestSchema = z
  .object({
    slug: ModelCardSlugSchema,
    intendedUse: IntendedUseStatementSchema,
    /** ADR-0015 door-opener: classical | time-series | foundation | lmm | agent. */
    modelClass: ModelClassSchema,
    architectureSummary: z.string().min(1).max(4000),
    trainingDataLineage: z.record(z.string(), z.unknown()).default({}),
    /** Semver parent (soft FK → prediction.model_cards.id) for version promotion. */
    parentModelCardId: z.string().uuid().nullable().optional(),
    versionMajorMinorPatch: z.string().regex(SEMVER, 'expected MAJOR.MINOR.PATCH'),
    changeJustification: z.string().max(4000).nullable().optional(),
    materialChange: z.boolean().default(false),
    trainingDataJurisdictions: z.array(z.string().min(2).max(64)).max(64).default([]),
    generativeAi: z.boolean().default(false),
    lmmSpecificLimitations: z.record(z.string(), z.unknown()).nullable().optional(),

    // -- #432 / ADR-0019 D3 -------------------------------------------------
    // Developer identity. Required on submission: `submitterUserId` records the
    // platform account, which is not the same as the vendor accountable for the
    // model (CHAI `BasicInfo`). Nullable in the DB so the column is additive.
    modelDeveloper: z.string().min(1).max(200),
    developerContact: z.string().min(1).max(200),
    /** Clinician-facing summary — distinct from the technical `architectureSummary`. */
    clinicalSummary: z.string().max(4000).nullable().optional(),
    regulatoryApproval: RegulatoryApprovalSchema.nullable().optional(),
    knownBiasesOrEthicalConsiderations: z.string().max(4000).nullable().optional(),
    biasMitigationApproaches: z.string().max(4000).nullable().optional(),
    /** Post-market surveillance / monitoring commitments. */
    ongoingMaintenance: z.string().max(4000).nullable().optional(),
    securityPosture: z.string().max(4000).nullable().optional(),
  })
  .strict();
export type CreateModelCardRequest = z.infer<typeof CreateModelCardRequestSchema>;

export const ModelCardResponseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  submitterUserId: z.string().uuid().nullable(),
  intendedUse: IntendedUseStatementSchema,
  modelClass: ModelClassSchema,
  architectureSummary: z.string(),
  trainingDataLineage: z.record(z.string(), z.unknown()),
  parentModelCardId: z.string().uuid().nullable(),
  versionMajorMinorPatch: z.string(),
  changeJustification: z.string().nullable(),
  materialChange: z.boolean(),
  trainingDataJurisdictions: z.array(z.string()),
  generativeAi: z.boolean(),
  lmmSpecificLimitations: z.record(z.string(), z.unknown()).nullable(),
  status: ModelCardStatusSchema,
  modelDeveloper: z.string().nullable(),
  developerContact: z.string().nullable(),
  clinicalSummary: z.string().nullable(),
  regulatoryApproval: RegulatoryApprovalSchema.nullable(),
  knownBiasesOrEthicalConsiderations: z.string().nullable(),
  biasMitigationApproaches: z.string().nullable(),
  ongoingMaintenance: z.string().nullable(),
  securityPosture: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ModelCardResponse = z.infer<typeof ModelCardResponseSchema>;

/**
 * A model card as served to anyone who is not its submitter, a reviewer or an
 * admin, signed in or not (#591). An allowlist, not a strip list: a field added
 * to the card later stays private until someone decides to publish it.
 *
 * Left out on purpose: `submitterUserId` (a platform account, not the
 * accountable developer), `securityPosture` (a guide for an attacker),
 * `trainingDataLineage` (free-form, can hold internal IDs and URLs),
 * `parentModelCardId` (may point at a card never published) and
 * `changeJustification` (a note for reviewers). `developerContact` stays: it is
 * the CHAI developer-contact disclosure, meant to be published.
 */
export const PublicModelCardSchema = ModelCardResponseSchema.pick({
  id: true,
  slug: true,
  intendedUse: true,
  modelClass: true,
  architectureSummary: true,
  versionMajorMinorPatch: true,
  materialChange: true,
  trainingDataJurisdictions: true,
  generativeAi: true,
  lmmSpecificLimitations: true,
  status: true,
  modelDeveloper: true,
  developerContact: true,
  clinicalSummary: true,
  regulatoryApproval: true,
  knownBiasesOrEthicalConsiderations: true,
  biasMitigationApproaches: true,
  ongoingMaintenance: true,
  createdAt: true,
  updatedAt: true,
});
export type PublicModelCard = z.infer<typeof PublicModelCardSchema>;

/**
 * Public model catalogue — `GET /v2/prediction/model-cards` (#591, Y.3176
 * Discover). Lists PUBLISHED cards only, whoever is asking. Offset
 * pagination and the sort vocabulary mirror `ListDatasetsQuerySchema`;
 * `name` sorts by slug, the closest thing a model card has to a name.
 */
export const ListModelCardsSortSchema = z.enum(['recent', 'name', 'oldest']);
export type ListModelCardsSort = z.infer<typeof ListModelCardsSortSchema>;

export const ListModelCardsQuerySchema = z.object({
  /** Case-insensitive substring over slug, developer, clinical summary and IUS text. */
  q: searchText(1, 200).optional(),
  modelClass: ModelClassSchema.optional(),
  /** Matches `trainingDataJurisdictions` or `regulatoryApproval.jurisdictions`, case-insensitive. */
  jurisdiction: searchText(2, 64).optional(),
  sort: ListModelCardsSortSchema.default('recent'),
  /** 1-indexed page. */
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListModelCardsQuery = z.infer<typeof ListModelCardsQuerySchema>;

/** One row of the public model list — enough to scan and pick, nothing private. */
export interface ModelCardSummary {
  id: string;
  slug: string;
  modelClass: ModelClass;
  versionMajorMinorPatch: string;
  modelDeveloper: string | null;
  clinicalSummary: string | null;
  medicalPurpose: string;
  riskTier: string;
  generativeAi: boolean;
  trainingDataJurisdictions: string[];
  regulatoryApprovalStatus: RegulatoryApproval['status'] | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListModelCardsResponse {
  items: ModelCardSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Lifecycle transition request — `POST /v2/prediction/model-cards/:slug/status`. */
export const ChangeModelCardStatusRequestSchema = z
  .object({
    status: ModelCardStatusSchema,
    reason: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type ChangeModelCardStatusRequest = z.infer<typeof ChangeModelCardStatusRequestSchema>;

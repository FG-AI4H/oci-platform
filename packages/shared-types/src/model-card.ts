import { z } from 'zod';
import { IntendedUseStatementSchema } from './intended-use.js';
import { ModelClassSchema } from './evaluation-task-kind.js';
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
    slug: z.string().min(3).max(120).regex(SLUG),
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

/** Lifecycle transition request — `POST /v2/prediction/model-cards/:slug/status`. */
export const ChangeModelCardStatusRequestSchema = z
  .object({
    status: ModelCardStatusSchema,
    reason: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type ChangeModelCardStatusRequest = z.infer<typeof ChangeModelCardStatusRequestSchema>;

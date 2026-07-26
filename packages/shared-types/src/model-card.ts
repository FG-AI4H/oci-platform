import { z } from 'zod';
import { IntendedUseStatementSchema } from './intended-use.js';
import { ModelClassSchema } from './evaluation-task-kind.js';

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
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ModelCardResponse = z.infer<typeof ModelCardResponseSchema>;

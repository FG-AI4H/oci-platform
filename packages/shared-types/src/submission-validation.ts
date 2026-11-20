import { z } from 'zod';
import { DatasetSlugSchema } from './slug.js';

/**
 * Submission mode + the VALIDATION report contract.
 *
 * Extracted from `index.ts` for one concrete reason: the EvalAI seam response
 * carries a full validation report, and a module the barrel re-exports cannot
 * import from the barrel — the cycle leaves the schema `undefined` when the
 * module is evaluated. Same fix as `regulatory-pathway.ts`. Everything here is
 * re-exported from `index.ts`, so no consumer import changes.
 *
 * GROUND TRUTH: a validation report is derived from the task's item-ID KEY SET
 * and never from a label. The reasoning for exactly where that line sits is in
 * `apps/api/src/modules/evaluation/submission-validation.ts`, next to the code
 * that has to honour it. That property is what makes a report safe to forward
 * across the seam to an external front door.
 */

/** How predictions reach the platform. Orthogonal to submission INTENT. */
export const SubmissionModeSchema = z.enum(['PREDICTIONS', 'CONTAINER', 'ENCRYPTED']);
export type SubmissionMode = z.infer<typeof SubmissionModeSchema>;

/** An evaluation task is addressed by the same slug rule as a dataset. */
export const EvaluationTaskSlugSchema = DatasetSlugSchema;
export type EvaluationTaskSlug = z.infer<typeof EvaluationTaskSlugSchema>;

/** Which interface check a `SubmissionValidationCheck` reports on. */
export const SubmissionValidationCheckNameSchema = z.enum([
  /** The wire shape parsed at all (implicitly true once the DTO accepted it). */
  'PAYLOAD_SHAPE',
  /** No item ID appears twice in the payload. */
  'DUPLICATE_ITEM_IDS',
  /** Every label is an integer inside the task's `[0, numClasses-1]`. */
  'LABEL_RANGE',
  /** Every submitted item ID is one the task contains. */
  'ITEM_IDS_RECOGNISED',
  /** `imageRef` is pinned to the submitted `imageDigest`. */
  'IMAGE_DIGEST_PINNED',
  /** Sealed execution is configured on this environment, so a run could be dispatched. */
  'DISPATCH_AVAILABLE',
]);
export type SubmissionValidationCheckName = z.infer<typeof SubmissionValidationCheckNameSchema>;

/** One check's outcome. `detail` and `itemIds` must be specific enough to fix. */
export const SubmissionValidationCheckSchema = z.object({
  name: SubmissionValidationCheckNameSchema,
  ok: z.boolean(),
  /**
   * Participant-facing explanation. Derived from the submitted payload and the
   * task's PUBLIC configuration only — never from a ground-truth label.
   */
  detail: z.string(),
  /**
   * The offending item IDs, truncated. Either the participant's own IDs or IDs
   * absent from a key set the participant was already given, so naming them
   * discloses nothing. Empty when the check passed or names no IDs.
   */
  itemIds: z.array(z.string()),
  /** How many IDs the check found, when `itemIds` above was truncated. */
  itemIdCount: z.number().int(),
});
export type SubmissionValidationCheck = z.infer<typeof SubmissionValidationCheckSchema>;

/**
 * Item-ID arithmetic for a predictions payload. Every field is a count of
 * IDENTIFIERS, all four derivable by the participant from the `index.json`
 * they were handed. No field is a function of a label — see the boundary note
 * in `submission-validation.ts` for why that distinction is the whole control.
 */
export const SubmissionValidationItemIdSummarySchema = z.object({
  /** Rows in the payload (duplicates included). */
  submitted: z.number().int(),
  /** Distinct submitted IDs the task contains. */
  recognised: z.number().int(),
  /** Distinct submitted IDs the task does not contain. */
  unrecognised: z.number().int(),
  /** IDs the task contains with no prediction — scored as reduced coverage. */
  notPredicted: z.number().int(),
});
export type SubmissionValidationItemIdSummary = z.infer<
  typeof SubmissionValidationItemIdSummarySchema
>;

/**
 * Response to `POST .../submissions` with `intent: 'VALIDATION'`.
 *
 * Answered `200` whether or not the checks pass: the request itself was
 * well-formed and the answer to "is my artefact usable" is the payload, not the
 * status code. A `4xx` here would conflate "your validation request was bad"
 * with "your submission would not have worked", which is the distinction the
 * participant is asking about.
 *
 * `scores`, `submissionId` and `quotaConsumed` are pinned to constants rather
 * than omitted so no client can mistake a validation response for a scored one,
 * and so the three WP6 guarantees are legible in the response itself: nothing
 * was scored, no `Submission` row exists, no quota was spent.
 */
export const SubmissionValidationReportSchema = z.object({
  intent: z.literal('VALIDATION'),
  mode: SubmissionModeSchema,
  taskSlug: EvaluationTaskSlugSchema,
  /** True iff every check passed. */
  ok: z.boolean(),
  /** Always `null` — a validation submission is never scored. */
  scores: z.null(),
  /** Always `null` — no `Submission` row is written for a validation submission. */
  submissionId: z.null(),
  /** Always `false` — validation never spends scored quota. */
  quotaConsumed: z.literal(false),
  checks: z.array(SubmissionValidationCheckSchema),
  /** `null` for a CONTAINER validation, which has no predictions to count. */
  itemIdSummary: SubmissionValidationItemIdSummarySchema.nullable(),
});
export type SubmissionValidationReport = z.infer<typeof SubmissionValidationReportSchema>;

import { z } from 'zod';

/**
 * Agreement between readers for an annotation campaign, and the export
 * of its annotations (#648).
 *
 * Readers appear only under the campaign's pseudonymous reader ids
 * (`r-` and 8 hex digits): the same reader has the same id in the
 * agreement view and in every export of the campaign, and a different
 * one in every other campaign. No name, email or account id.
 */

/** Below this many tasks with a finished independent reading, no coefficient is given. */
export const AGREEMENT_MIN_TASKS = 10;

/** A campaign-scoped pseudonymous reader id. */
export const ReaderPseudonymSchema = z.string().regex(/^r-[0-9a-f]{8}$/);
export type ReaderPseudonym = z.infer<typeof ReaderPseudonymSchema>;

/** How a coefficient was, or was not, computed. */
export const AgreementCoefficientStatusSchema = z.enum([
  /** Computed. */
  'computed',
  /** Fewer than `AGREEMENT_MIN_TASKS` tasks: counts only. */
  'too-few-tasks',
  /** Every reading gave the same answer: kappa is 0/0, agreement is 100%. */
  'single-answer',
  /** One reader per task: there is nothing to agree with. */
  'single-reader',
]);
export type AgreementCoefficientStatus = z.infer<typeof AgreementCoefficientStatusSchema>;

export const KappaIntervalSchema = z.object({
  lower: z.number(),
  upper: z.number(),
  /** 0.95. */
  level: z.number(),
  /** Percentile bootstrap over tasks, fixed seed (see `@oci/annotation-quality`). */
  method: z.literal('percentile-bootstrap'),
  resamples: z.number().int().positive(),
  seed: z.number().int(),
});
export type KappaInterval = z.infer<typeof KappaIntervalSchema>;

export const PairwiseAgreementSchema = z.object({
  readerA: ReaderPseudonymSchema,
  readerB: ReaderPseudonymSchema,
  /** Tasks both readers read, among the tasks counted. */
  sharedTasks: z.number().int().nonnegative(),
  /** Cohen's kappa over the shared tasks; null below `AGREEMENT_MIN_TASKS` or when undefined. */
  cohensKappa: z.number().nullable(),
  /** Share of the shared tasks on which the two gave the same answer; null below the minimum. */
  percentAgreement: z.number().min(0).max(1).nullable(),
  status: AgreementCoefficientStatusSchema,
});
export type PairwiseAgreement = z.infer<typeof PairwiseAgreementSchema>;

export const ReaderLabelCountsSchema = z.object({
  reader: ReaderPseudonymSchema,
  /** Independent readings by this reader on the tasks counted. */
  readings: z.number().int().nonnegative(),
  /** One entry per answer in `CampaignAgreement.labels`, in that order. */
  counts: z.array(z.object({ label: z.string(), count: z.number().int().nonnegative() })),
});
export type ReaderLabelCounts = z.infer<typeof ReaderLabelCountsSchema>;

/**
 * `GET /v2/annotation/campaigns/:slug/agreement` (#648), for the
 * campaign's managers and supervisors. Computed on request.
 *
 * Basis: the SUBMITTED readings of the independent step only. Released
 * and expired assignments produced no reading and are not counted;
 * arbitration and expert-review answers are not readings of the same
 * kind and are left out (they decide the final label, see the export).
 * A task counts once its independent step is finished: all its readers
 * answered and it closed or went on to arbitration. Skipped tasks and
 * tasks still being read are counted apart.
 */
export const CampaignAgreementSchema = z.object({
  campaignSlug: z.string(),
  computedAt: z.string().datetime(),
  minimumTasks: z.number().int().positive(),
  tasks: z.object({
    /** Tasks whose independent step is finished, counted in the agreement. */
    counted: z.number().int().nonnegative(),
    /** Tasks still at the independent step. */
    open: z.number().int().nonnegative(),
    /** Tasks taken out of the campaign (skipped). */
    skipped: z.number().int().nonnegative(),
    /**
     * Finished tasks left out of the coefficient: a reading without an
     * answer, or a number of readers different from the other tasks.
     */
    excluded: z.number().int().nonnegative(),
    /** Counted tasks the readers did not settle: they went to arbitration. */
    sentToArbitration: z.number().int().nonnegative(),
    /** sentToArbitration / counted; null when nothing is counted. */
    arbitrationShare: z.number().min(0).max(1).nullable(),
  }),
  /** Readers per counted task (the campaign's N). Null when nothing is counted. */
  readersPerTask: z.number().int().positive().nullable(),
  /** Distinct readers across the counted tasks. */
  readers: z.number().int().nonnegative(),
  /**
   * The answers, in the campaign's order, then « cannot assess », then
   * any other answer met. `display` is the campaign's wording; null for
   * « cannot assess » (the interface names it) and for unknown answers.
   */
  labels: z.array(z.object({ value: z.string(), display: z.string().nullable() })),
  /**
   * How « cannot assess » counts: as an answer of its own. Two readers
   * who both cannot assess agree; one who can and one who cannot
   * disagree. That is how a task is closed or sent to arbitration, so
   * the agreement and the workflow use the same rule.
   */
  cannotAssess: z.object({
    policy: z.literal('own-answer'),
    /** Readings that gave « cannot assess », on the counted tasks. */
    readings: z.number().int().nonnegative(),
  }),
  overall: z.object({
    status: AgreementCoefficientStatusSchema,
    /** Fleiss' kappa over the counted tasks; null unless status is `computed`. */
    fleissKappa: z.number().nullable(),
    interval: KappaIntervalSchema.nullable(),
    /**
     * Overall percent agreement: the share of reader pairs, within a
     * task, that gave the same answer, averaged over tasks (Fleiss' P̄).
     * Null below the minimum.
     */
    percentAgreement: z.number().min(0).max(1).nullable(),
    /** Counted tasks on which every reader gave the same answer; null below the minimum. */
    unanimousTasks: z.number().int().nonnegative().nullable(),
  }),
  /** Every pair of readers who share at least one counted task. */
  pairwise: z.array(PairwiseAgreementSchema),
  labelCountsByReader: z.array(ReaderLabelCountsSchema),
});
export type CampaignAgreement = z.infer<typeof CampaignAgreementSchema>;

/** Where a task stands, as the export says it. */
export const ExportTaskStatusSchema = z.enum([
  /** The readers agreed at the independent step. */
  'closed-independent',
  /** Settled by arbitration. */
  'closed-arbitration',
  /** Settled by expert review. */
  'closed-expert-review',
  /** Not settled yet: no final label. */
  'open',
  /** Taken out of the campaign: no final label. */
  'skipped',
]);
export type ExportTaskStatus = z.infer<typeof ExportTaskStatusSchema>;

export const ExportGateSchema = z.enum(['independent', 'arbitration', 'expert-review']);
export type ExportGate = z.infer<typeof ExportGateSchema>;

/**
 * One row of `GET /v2/annotation/campaigns/:slug/annotations.{csv,json}`
 * (#648): one per submitted answer, and one for a task with no answer
 * yet. The final label is the task's, repeated on each of its rows:
 *   - closed at the independent step: the readers' common label;
 *   - sent to arbitration: the arbitration label, or the expert-review
 *     label if there is one (the last one wins);
 *   - open or skipped: empty.
 * No majority vote is applied (ADR-0008 amendment of 2026-11-25).
 */
export const AnnotationExportRowSchema = z.object({
  task: z.string().uuid(),
  sampleRef: z.string(),
  taskStatus: ExportTaskStatusSchema,
  /** Null on the row of a task with no answer yet. */
  reader: ReaderPseudonymSchema.nullable(),
  gate: ExportGateSchema.nullable(),
  label: z.string().nullable(),
  comment: z.string().nullable(),
  submittedAt: z.string().datetime().nullable(),
  /** The arbiter's reason, on the arbitration row only. */
  arbitrationReason: z.string().nullable(),
  finalLabel: z.string().nullable(),
});
export type AnnotationExportRow = z.infer<typeof AnnotationExportRowSchema>;

/** The CSV columns, in order: the header row of the file. */
export const ANNOTATION_EXPORT_COLUMNS = [
  'task',
  'sampleRef',
  'taskStatus',
  'reader',
  'gate',
  'label',
  'comment',
  'submittedAt',
  'arbitrationReason',
  'finalLabel',
] as const satisfies readonly (keyof AnnotationExportRow)[];

export const AnnotationExportSchema = z.object({
  format: z.literal('oci-annotation-export/v1'),
  exportId: z.string().uuid(),
  exportedAt: z.string().datetime(),
  campaign: z.object({ slug: z.string(), name: z.string(), taskKind: z.string() }),
  rules: z.object({ readers: z.string(), finalLabel: z.string() }),
  rowCount: z.number().int().nonnegative(),
  rows: z.array(AnnotationExportRowSchema),
});
export type AnnotationExport = z.infer<typeof AnnotationExportSchema>;

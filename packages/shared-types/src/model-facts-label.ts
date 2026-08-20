import { z } from 'zod';

/**
 * Model Facts Label (#261) — the clinician-facing one-page summary of a model
 * submission, shaped after WHO 2021 *Ethics & Governance of AI for Health*
 * Fig. 7.
 *
 * This is a **rendering of the canonical `ModelCard`**, not a second source of
 * truth (ADR-0019 Decision 2: one canonical record → many regulator-facing
 * renderings — WHO here, CHAI in #433, EU AI Act later). Everything below is
 * derived; nothing is stored.
 *
 * `gaps` is deliberate: a compliance artefact should state what it could not
 * populate rather than silently omit it. A reader must be able to tell "not
 * applicable" from "we don't know yet".
 */

/** One evaluated task's headline result, read from the ADR-0020 scores envelope. */
export const ModelFactsPerformanceEntrySchema = z.object({
  taskSlug: z.string(),
  /** Value of EvaluationTaskKindDb. Typed as a string here rather than importing
   * the enum, because that lives in index.ts and index.ts re-exports this module
   * — importing it back would be a cycle. Copied at the render boundary. */
  taskKind: z.string(),
  /** The metric that kind ranks by — QWK for grading, macro F1 for classification. */
  primaryMetricLabel: z.string(),
  primaryMetricValue: z.number(),
  /** Fraction of the ground-truth set the submission actually covered. */
  coverage: z.number().nullable(),
  evaluatedAt: z.string().nullable(),
});
export type ModelFactsPerformanceEntry = z.infer<typeof ModelFactsPerformanceEntrySchema>;

export const ModelFactsLabelSchema = z.object({
  v: z.literal(1),
  generatedAt: z.string(),
  modelCardSlug: z.string(),

  /** WHO Fig. 7 — "Model name / summary". */
  summary: z.object({
    name: z.string(),
    developer: z.string().nullable(),
    developerContact: z.string().nullable(),
    version: z.string(),
    status: z.string(),
    text: z.string(),
  }),

  /** WHO Fig. 7 — "Mechanism": what it does and how, in clinician terms. */
  mechanism: z.object({
    modelClass: z.string(),
    generativeAi: z.boolean(),
    text: z.string(),
  }),

  /** WHO Fig. 7 — "Validation & performance", overall then per-subgroup. */
  validationAndPerformance: z.object({
    entries: z.array(ModelFactsPerformanceEntrySchema),
    /** Per-subgroup rows require the fairness report (#263) — absent until then. */
    subgroupAvailable: z.boolean(),
    subgroupNote: z.string(),
  }),

  /** WHO Fig. 7 — "Uses & directions". Sourced from the IUS (ADR-0013). */
  usesAndDirections: z.object({
    medicalPurpose: z.string(),
    intendedUsers: z.array(z.string()),
    clinicalPathway: z.string().nullable(),
    targetPopulation: z.string().nullable(),
    operatingEnvironments: z.array(z.string()),
  }),

  /** WHO Fig. 7 — "Warnings". */
  warnings: z.object({
    riskTier: z.string(),
    foreseeableMisuse: z.string(),
    contraindications: z.string().nullable(),
    knownBiasesOrEthicalConsiderations: z.string().nullable(),
    lmmSpecificLimitations: z.record(z.string(), z.unknown()).nullable(),
  }),

  /** WHO Fig. 7 — generalisability: where these results are expected to hold. */
  generalisability: z.object({
    trainingDataJurisdictions: z.array(z.string()),
    statement: z.string(),
  }),

  /** WHO Fig. 7 — when to stop relying on the model. */
  discontinueUse: z.object({
    ongoingMaintenance: z.string().nullable(),
    statement: z.string(),
  }),

  /** What could not be populated, and why. Never silently omitted. */
  gaps: z.array(z.string()),
});
export type ModelFactsLabel = z.infer<typeof ModelFactsLabelSchema>;

/**
 * Task-kind scoring registry (ADR-0020, WP10, issue #428) — pure, no NestJS /
 * Prisma deps.
 *
 * ADR-0017 shipped one scoring family, `GRADING`, and hard-coded its payload
 * shape (`itemId -> integer label`) and its metric set into `scoreSubmission()`.
 * That was correct for IDRiD DR grading and does not generalise: a challenge
 * claiming to test *generalisable* privacy-preserving evaluation cannot only
 * score image grading, and the constraint caps which institutions can be
 * recruited as data hosts at all.
 *
 * This registry inverts the dependency. Each task kind declares three things —
 * the schema its predictions payload must satisfy, the function that scores it,
 * and the shape of the scores that come back. `scoreByKind()` dispatches; it
 * computes nothing itself. Adding a kind is adding a registry entry.
 *
 * ADDITIVE BY CONSTRUCTION: `scoreSubmission()` keeps its exact signature and
 * its numbers, and `GRADING` routes straight to it. Existing callers and the
 * hand-computed cases in `scoring.spec.ts` are untouched.
 *
 * SECURITY NOTE (#414, #428). The predictions payload arrives over the
 * sealed-execution output path, which is an exfiltration channel: a model that
 * cannot read out the data it was shown may still try to encode it into its
 * "predictions". Every kind therefore declares a STRICT schema and an item
 * budget, and payloads are validated before scoring rather than during it. Do
 * not add a kind speculatively — land it against a real task definition from a
 * named host.
 */

import { z } from 'zod';

import { scoreSubmission, ScoringError, type EvaluationScores } from './scoring.js';
import { scoreClassification, type ClassificationScores } from './scoring-classification.js';

/** Task kinds this build can score. Mirrors the Prisma `EvaluationTaskKind`. */
export const SCORABLE_TASK_KINDS = ['GRADING', 'CLASSIFICATION'] as const;
export type ScorableTaskKind = (typeof SCORABLE_TASK_KINDS)[number];

/**
 * Upper bound on items in a single predictions payload, for every kind.
 * A submission is scored over the intersection with the ground truth, so a
 * payload larger than any plausible evaluation split is not a generous
 * submission — it is either a mistake or a smuggling attempt.
 */
export const MAX_PREDICTION_ITEMS = 100_000;

/**
 * Payload shared by the two single-label kinds: `itemId -> integer label`.
 * Non-integer, negative and out-of-range labels are rejected again inside the
 * scorers, which know the task's `numClasses`; this is the shape gate.
 */
const singleLabelPayloadSchema = z
  .record(z.string().min(1), z.number().int().nonnegative())
  .refine((rec) => Object.keys(rec).length <= MAX_PREDICTION_ITEMS, {
    message: `predictions payload exceeds ${MAX_PREDICTION_ITEMS} items`,
  });

/** Config a task carries into scoring, whatever its kind. */
export interface TaskScoringConfig {
  numClasses?: number;
  /** `GRADING` only — the referable split T. Ignored by nominal kinds. */
  referableThreshold?: number;
}

/** Scores envelope: the kind that produced them, and the metrics themselves. */
export type KindScores =
  | { kind: 'GRADING'; metrics: EvaluationScores }
  | { kind: 'CLASSIFICATION'; metrics: ClassificationScores };

interface ScorerEntry {
  /** Strict shape gate for this kind's predictions payload. */
  readonly payloadSchema: z.ZodType<unknown>;
  /** Pure scorer. Receives an already shape-validated payload. */
  readonly score: (args: {
    groundTruth: Record<string, number>;
    predictions: Record<string, number>;
    config: TaskScoringConfig;
  }) => KindScores;
}

const REGISTRY: Readonly<Record<ScorableTaskKind, ScorerEntry>> = {
  GRADING: {
    payloadSchema: singleLabelPayloadSchema,
    score: ({ groundTruth, predictions, config }) => ({
      kind: 'GRADING',
      // Delegates verbatim to the ADR-0017 implementation — same numbers.
      metrics: scoreSubmission({
        groundTruth,
        predictions,
        numClasses: config.numClasses,
        referableThreshold: config.referableThreshold,
      }),
    }),
  },
  CLASSIFICATION: {
    payloadSchema: singleLabelPayloadSchema,
    score: ({ groundTruth, predictions, config }) => ({
      kind: 'CLASSIFICATION',
      metrics: scoreClassification({
        groundTruth,
        predictions,
        numClasses: config.numClasses,
      }),
    }),
  },
};

/** True when this build can score the given kind. */
export function isScorableTaskKind(kind: string): kind is ScorableTaskKind {
  return (SCORABLE_TASK_KINDS as readonly string[]).includes(kind);
}

/**
 * Validate a predictions payload against its task kind's declared schema.
 *
 * Separate from `scoreByKind` on purpose: the worker and the validation-
 * submission path (WP6) need to answer "is this payload even the right shape"
 * without holding ground truth, and must never load it to find out.
 */
export function validatePredictionsPayload(kind: string, payload: unknown): Record<string, number> {
  if (!isScorableTaskKind(kind)) {
    throw new ScoringError(
      `Unsupported task kind "${kind}": this build scores ${SCORABLE_TASK_KINDS.join(', ')}`,
    );
  }
  /* eslint-disable-next-line security/detect-object-injection --
   * `kind` has been narrowed by `isScorableTaskKind` to the two-member
   * literal union `ScorableTaskKind`, and REGISTRY is a closed
   * `Readonly<Record<ScorableTaskKind, ScorerEntry>>`. The index cannot be
   * an arbitrary caller-supplied string, so the injection sink does not
   * apply. An unknown kind has already thrown above. */
  const parsed = REGISTRY[kind].payloadSchema.safeParse(payload);
  if (!parsed.success) {
    // Deliberately terse: the participant learns that the shape is wrong, not
    // what the server holds. Detail goes to operator logs, not the response.
    throw new ScoringError(
      `Malformed predictions payload for task kind "${kind}": ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
    );
  }
  return parsed.data as Record<string, number>;
}

/**
 * Score a submission for a task of the given kind.
 *
 * Throws `ScoringError` for an unsupported kind, a malformed payload, or a
 * label outside the task's class range. Never returns partial scores: a
 * submission is scored or it is rejected.
 */
export function scoreByKind(args: {
  kind: string;
  groundTruth: Record<string, number>;
  predictions: unknown;
  config?: TaskScoringConfig;
}): KindScores {
  const predictions = validatePredictionsPayload(args.kind, args.predictions);
  // `validatePredictionsPayload` has already narrowed the kind.
  const kind = args.kind as ScorableTaskKind;
  /* eslint-disable-next-line security/detect-object-injection --
   * Same as above: `validatePredictionsPayload` has already rejected any
   * kind outside `ScorableTaskKind`, so this index is one of two literals
   * against a closed record. */
  return REGISTRY[kind].score({
    groundTruth: args.groundTruth,
    predictions,
    config: args.config ?? {},
  });
}

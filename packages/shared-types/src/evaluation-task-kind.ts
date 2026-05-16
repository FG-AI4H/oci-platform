/**
 * Evaluation task kinds + model classes — extensibility door-openers
 * locked by ADR-0015.
 *
 * The classical AI-SaMD evaluation pipeline (classification, segmentation,
 * detection, …) sits next to LMM evaluation (red-teaming, hallucination
 * scoring, prompt-injection probing). WHO 2024 LMM Guidance treats the
 * second class as fundamentally different — different metrics, different
 * failure modes, different acceptable-risk envelopes. Phase D will build
 * the LMM tooling; this file ships the schema *now* so a future LMM
 * submission does not require a closed-enum migration.
 *
 * Two strict invariants (see ADR-0015):
 *   1. Consumers must not write `if (kind === ...) else throw`. Pattern-
 *      match on the known set, fall through gracefully on the open tail.
 *   2. DB columns store `String @db.VarChar(64)`, never a PostgreSQL enum
 *      type. The Zod schema is the boundary validator.
 *
 * This file deliberately does NOT belong with annotation's
 * `CampaignTaskKind` (`./modality-task-kinds.ts`). The annotation
 * orchestrator's task kinds are closed by design (ADR-0009 routing
 * invariants); the evaluation task kind is open by design. Different
 * module, different invariant.
 */

import { z } from 'zod';

/**
 * The documented vocabulary. Adding a value here is a one-line change;
 * removing or renaming requires an ADR amendment. Order is meaningful
 * for UI listings — classical kinds first, LMM kinds next, generic
 * fallback last.
 */
export const KNOWN_EVALUATION_TASK_KINDS = [
  // Classical AI-SaMD task kinds — Phase B ships these.
  'classification',
  'detection',
  'segmentation',
  'localization',
  'regression',
  'survival',

  // LMM task kinds — reserved namespace; tooling lands Phase D
  // (ADR-0015). Listed here from day one so future submissions don't
  // require a schema-version migration.
  'lmm-qa',
  'lmm-summarization',
  'lmm-red-team',
  'lmm-hallucination',
  'lmm-prompt-injection',
  'lmm-safety-eval',

  // Hybrid / catch-all.
  'multi-modal',
] as const;

export type KnownEvaluationTaskKind = (typeof KNOWN_EVALUATION_TASK_KINDS)[number];

/**
 * Vendor-extension pattern. Anyone needing to register a task kind
 * without an upstream ADR uses `x-<vendor>-<task>`. The platform never
 * gates on `x-*` semantics; UI surfaces them as "custom". Lower-case
 * ASCII + hyphens, ≤ 64 chars total.
 */
// eslint-disable-next-line security/detect-unsafe-regex -- bounded by .max(64); each `[a-z0-9]+` segment is atomic-greedy with disjoint follow-set (`-`), so no exponential backtracking surface
export const VENDOR_TASK_KIND_PATTERN = /^x-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Open vocabulary: one of the known values OR an `x-…` vendor token.
 * Anything else fails parse.
 */
export const EvaluationTaskKindSchema = z.union([
  z.enum(KNOWN_EVALUATION_TASK_KINDS),
  z
    .string()
    .regex(VENDOR_TASK_KIND_PATTERN, 'expected `x-<vendor>-<task>` extension token')
    .max(64),
]);
export type EvaluationTaskKind = z.infer<typeof EvaluationTaskKindSchema>;

/**
 * Convenience predicate for narrowing inside switch-like consumers
 * without sacrificing the open tail. Use in the *generic* renderer
 * fall-through path; do not use it to throw on unknown values.
 */
export function isKnownEvaluationTaskKind(
  value: EvaluationTaskKind,
): value is KnownEvaluationTaskKind {
  return (KNOWN_EVALUATION_TASK_KINDS as readonly string[]).includes(value);
}

/**
 * Predicate for the LMM family. The `lmm-` prefix is reserved; Phase D
 * tooling routes off this predicate (red-team runner, hallucination
 * scorer, …). Vendor-extension tokens starting `x-` never match — vendor
 * LMM kinds should pick a non-`lmm-` token to avoid collision with
 * future canonical additions.
 */
export function isLmmTaskKind(value: EvaluationTaskKind): boolean {
  return typeof value === 'string' && value.startsWith('lmm-');
}

// ===========================================================================
// Model class — also extensible, but with a tighter known set.
// ===========================================================================

/**
 * Model-class taxonomy locked by ADR-0015. Includes `lmm` and `agent`
 * from day one even though neither has a built-out submission path yet —
 * the cost of waiting and migrating later is higher than the cost of
 * listing them now.
 *
 *   - `classical`   — closed-form ML/DL: classifier, segmentor, detector, regressor.
 *   - `time-series` — RNN/Transformer over signals (ECG, EEG, vitals).
 *   - `foundation`  — general-purpose pre-trained model, single modality.
 *   - `lmm`         — Large Multi-Modal Model (LLM + vision / EHR / signals).
 *   - `agent`       — multi-step orchestrated AI (Phase D+ placeholder).
 */
export const ModelClassSchema = z.enum([
  'classical',
  'time-series',
  'foundation',
  'lmm',
  'agent',
]);
export type ModelClass = z.infer<typeof ModelClassSchema>;

/**
 * Convenience predicate matching the family of model classes for which
 * Phase D LMM-style governance applies (red-teaming, hallucination
 * scoring, prompt-injection probes, output-distribution drift).
 */
export function requiresLmmGovernance(modelClass: ModelClass): boolean {
  return modelClass === 'lmm' || modelClass === 'agent';
}

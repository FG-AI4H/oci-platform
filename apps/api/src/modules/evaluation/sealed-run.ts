/**
 * Sealed execution (Mode 2 / CONTAINER) — pure helpers, no NestJS / Prisma
 * deps (same shape as `scoring.ts`). Spec:
 * `docs/planning/evaluation-challenge-2026-08/sealed-execution-contract.md`;
 * decisions ADR-0017 (modes) and ADR-0018 (routes).
 *
 * Three things live here, all of them boundary logic that must be trusted:
 *
 *   1. **The operational envelope defaults.** The task-level envelope is
 *      WP5 (`EvaluationRoute`); until it exists the dispatcher needs a
 *      documented constant rather than an invented per-task value.
 *   2. **The participant-facing failure text.** Derived from the classified
 *      code ALONE. `participantFacingFailureMessage` takes a
 *      `SealedRunFailureCode` and nothing else, so no call site can pass it
 *      the worker's operator detail even by accident — container stdout is
 *      an exfiltration channel (contract §6, an explicit review checkpoint).
 *   3. **The idempotency fingerprint.** What makes a replay a replay.
 */

import { createHash } from 'node:crypto';
import type { EvaluationScores, SealedRunFailureCode, SealedRunResult } from '@oci/shared-types';

// ---- Operational envelope --------------------------------------------------

/**
 * Hard wall-clock cap handed to the worker, in seconds.
 *
 * Provenance: there is no task-level operational envelope yet — routes carry
 * one and the route model is WP5 (ADR-0018, plan §4). 1800 s is the documented
 * platform default until then, chosen as the IDRiD demo slice (a few hundred
 * fundus images through one model) finishing inside it with room for a cold
 * image pull, while still bounding a hung run to half an hour of a host slot.
 *
 * **Coupled to CDK (WP2):** the queue's visibility timeout must exceed this
 * plus pull time (contract §2). Overridable per environment with
 * `OCI_EVAL_RUN_TIMEOUT_SEC` so ops can realign the two without a code
 * change.
 */
export const DEFAULT_SEALED_RUN_TIMEOUT_SEC = 1800;

/**
 * How far ahead the dispatch deadline is set, in seconds. After this instant
 * the worker abandons the message rather than starting a run (contract §2), so
 * it bounds queue-backlog staleness rather than the run itself: a submission
 * that has sat behind a full queue for six hours is better failed than started
 * against a slot the operator has since re-planned. Must be comfortably larger
 * than the run timeout.
 */
export const SEALED_RUN_DEADLINE_SEC = 6 * 60 * 60;

/** Bounds from `SealedRunMessageSchema.timeoutSec` — kept in sync by hand. */
const TIMEOUT_MIN_SEC = 1;
const TIMEOUT_MAX_SEC = 86_400;

/**
 * Resolve the run timeout from a raw env value. Anything unparseable or out of
 * the contract's bounds falls back to the default rather than dispatching a
 * message the schema would reject at the far end.
 */
export function resolveSealedRunTimeoutSec(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SEALED_RUN_TIMEOUT_SEC;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < TIMEOUT_MIN_SEC || parsed > TIMEOUT_MAX_SEC) {
    return DEFAULT_SEALED_RUN_TIMEOUT_SEC;
  }
  return parsed;
}

// ---- Failure taxonomy → participant-facing text ---------------------------

/**
 * One message per member of `SealedRunFailureCodeSchema` (contract §6). These
 * strings are the ONLY failure text a participant ever sees. Each one names a
 * control that was hit, never anything the container observed or emitted.
 */
const PARTICIPANT_FAILURE_MESSAGE: Record<SealedRunFailureCode, string> = {
  IMAGE_PULL_FAILED: 'The submitted image could not be pulled from the registry.',
  DIGEST_MISMATCH: 'The pulled image digest did not match the submitted digest.',
  STARTUP_FAILED: 'The container did not start.',
  TIMEOUT: 'The run exceeded the wall-clock limit for this task and was terminated.',
  OOM_KILLED: 'The run exceeded the memory limit for this task and was terminated.',
  NONZERO_EXIT: 'The container exited with a non-zero status.',
  NO_OUTPUT: 'The container did not write a predictions file to the output directory.',
  MALFORMED_OUTPUT: 'The predictions file was not valid for this task.',
  UNKNOWN_ITEM_IDS: 'The predictions file referenced item identifiers this task does not contain.',
  OUTPUT_TOO_LARGE: 'The container wrote more to the output directory than this task permits.',
  NETWORK_ATTEMPT_DETECTED:
    'The run attempted network egress. Sealed runs execute with networking disabled.',
  INTERNAL_ERROR: 'The evaluation could not be completed because of a platform error.',
};

/**
 * Participant-facing text for a classified failure. Takes the CODE and nothing
 * else — the operator detail is not in scope here and cannot be, which is the
 * point: the exfiltration channel is closed structurally rather than by
 * remembering to omit a field.
 */
export function participantFacingFailureMessage(code: SealedRunFailureCode): string {
  /* eslint-disable-next-line security/detect-object-injection --
   * `code` is a member of the closed, Zod-validated SealedRunFailureCode union
   * and the table is a Record over exactly that union, so the lookup is total
   * and cannot reach a prototype or an attacker-chosen key. */
  return PARTICIPANT_FAILURE_MESSAGE[code];
}

// ---- Result classification ------------------------------------------------

/** Rejected outbox payload: not exactly one of predictions / metrics / failure. */
export class SealedRunResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealedRunResultError';
  }
}

/**
 * The three mutually exclusive outbox outcomes.
 *
 * The `failure` branch deliberately carries the code WITHOUT `detail`. Detail
 * is read from the validated body at exactly one place in the service — a
 * `void` logging method — so it cannot travel toward a response or a stored
 * `error` column through this type.
 */
export type SealedRunOutcome =
  | { kind: 'predictions'; predictions: Record<string, number> }
  | { kind: 'metrics'; metrics: EvaluationScores }
  | { kind: 'failure'; code: SealedRunFailureCode };

/**
 * Narrow a validated outbox body to its single outcome. `SealedRunResultSchema`
 * already enforces exactly-one via `superRefine`; this re-checks it so the
 * service is self-defending when called outside the controller pipe (and so
 * "both" / "neither" are rejected in one place with one message).
 */
export function classifySealedRunResult(result: SealedRunResult): SealedRunOutcome {
  const present = [
    result.predictions !== undefined,
    result.metrics !== undefined,
    result.failure !== undefined,
  ].filter(Boolean).length;
  if (present !== 1) {
    throw new SealedRunResultError(
      'exactly one of predictions, metrics or failure must be present',
    );
  }
  if (result.predictions !== undefined) {
    return { kind: 'predictions', predictions: result.predictions };
  }
  if (result.metrics !== undefined) return { kind: 'metrics', metrics: result.metrics };
  if (result.failure !== undefined) return { kind: 'failure', code: result.failure.code };
  // Unreachable: `present === 1` with none of the three branches matching.
  throw new SealedRunResultError('exactly one of predictions, metrics or failure must be present');
}

// ---- Idempotency fingerprint ----------------------------------------------

/**
 * sha256 over the outcome-determining content of an outbox payload.
 *
 * Included: which of the three shapes arrived, and the values that decide the
 * stored outcome (prediction labels in key order, the five metrics, the failure
 * code).
 *
 * Deliberately EXCLUDED: `durationMs`, `routeVersion` and `failure.detail`. A
 * worker retrying its POST after a network blip reports a different duration
 * and possibly a longer detail string for the same run; that is a replay, not a
 * conflicting result. Anything that changes the score or the failure class
 * changes the fingerprint, and a fingerprint mismatch against a terminal
 * submission is a 409.
 */
export function sealedRunResultFingerprint(result: SealedRunResult): string {
  const outcome = classifySealedRunResult(result);
  let canonical: string;
  if (outcome.kind === 'predictions') {
    const entries = Object.entries(outcome.predictions).sort(([a], [b]) => (a < b ? -1 : 1));
    canonical = JSON.stringify(['predictions', entries]);
  } else if (outcome.kind === 'metrics') {
    const m = outcome.metrics;
    canonical = JSON.stringify([
      'metrics',
      m.qwk,
      m.accuracy,
      m.referableSensitivity,
      m.referableSpecificity,
      m.coverage,
    ]);
  } else {
    canonical = JSON.stringify(['failure', outcome.code]);
  }
  return createHash('sha256').update(canonical).digest('hex');
}

// ---- Dispatch helpers -----------------------------------------------------

/**
 * Absolute outbox URL for a submission. The worker holds it; it is never passed
 * into the container (contract §3 — the container gets `/input`, `/output` and
 * two env vars, nothing that could identify or call back).
 */
export function sealedRunCallbackUrl(apiBaseUrl: string, submissionId: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/v2/submissions/${submissionId}/result`;
}

/**
 * `imageRef` and `imageDigest` are validated independently by the wire schema
 * (a ref must contain `@sha256:`, a digest must look like one) but nothing
 * there cross-checks that they agree. A ref pinned to digest A submitted
 * alongside digest B is an image-substitution vector, so agreement is asserted
 * at the API boundary before anything is persisted or dispatched.
 */
export function imageRefMatchesDigest(imageRef: string, imageDigest: string): boolean {
  return imageRef.endsWith(`@${imageDigest}`);
}

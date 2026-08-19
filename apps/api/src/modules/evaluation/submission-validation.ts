/**
 * Validation submissions (WP6) — pure helpers, no NestJS / Prisma deps (same
 * shape as `scoring.ts` and `sealed-run.ts`).
 *
 * A validation submission checks the INTERFACE CONTRACT and produces no score:
 * would this payload have parsed, would this image have been dispatchable. It
 * is the only debugging loop available in a model-to-data challenge, where the
 * participant never sees the data their submission failed against.
 *
 * ---------------------------------------------------------------------------
 * THE GROUND-TRUTH LINE, AND WHY IT IS DRAWN AT THE ITEM ID
 * ---------------------------------------------------------------------------
 *
 * Validation is UNSCORED and UNLIMITED. Unlimited is what makes it dangerous:
 * any part of the answer that is a function of the hidden labels becomes an
 * oracle that costs nothing to query, and a participant can difference
 * successive reports until they have reconstructed the label vector. The quota
 * in `submission-quota.ts` is what bounds that exposure on the scored path;
 * there is no such bound here, so the report must contain nothing label-derived
 * at all.
 *
 * SAFE — reporting WHICH submitted item IDs the task does not recognise. The
 * task's item-ID key set is already handed to every sealed run as
 * `/input/index.json` (sealed-execution-contract §3), and to every Mode 1
 * participant as the dataset's manifest. Naming the IDs, and counting them,
 * tells the participant nothing they were not given — while being precisely the
 * information that fixes the single most common plumbing failure (an ID
 * convention that does not match the task's).
 *
 * NOT SAFE — anything derived from a label, and that explicitly includes
 * aggregates:
 *   - "how many of your labels match" — accuracy, i.e. a score;
 *   - "how many of the IDs you did not predict are referable" — one bit of the
 *     label vector per call;
 *   - a per-class count over ANY subset, including the recognised set, the
 *     unrecognised set or the whole task. A class histogram over a
 *     participant-chosen subset is a linear measurement of the labels, and
 *     unlimited measurements over subsets the participant controls recover the
 *     individual labels exactly.
 *
 * The control is structural rather than remembered: the input type below
 * carries `taskItemIds: readonly string[]` and NO labels whatsoever, so nothing
 * in this file can leak a label even by accident. Same move as
 * `SealedRunOutcome` having no field for the worker's operator detail. The
 * repository method that produces `taskItemIds` (`findTaskItemIds`) projects
 * the ground-truth map to its keys before returning, so the labels never leave
 * that one method's local scope either.
 */

import type {
  SubmissionValidationCheck,
  SubmissionValidationCheckName,
  SubmissionValidationItemIdSummary,
} from '@oci/shared-types';

/**
 * How many offending IDs a single check names. A 100 000-row payload against
 * the wrong ID convention would otherwise return a 100 000-element list; the
 * count is reported in full alongside, so the report stays actionable without
 * being unbounded. Twenty is enough to see the pattern in an ID convention,
 * which is what a participant actually needs.
 */
export const MAX_REPORTED_ITEM_IDS = 20;

/** The checks' verdict, plus the ID arithmetic. The service wraps it in the DTO. */
export interface InterfaceValidationOutcome {
  ok: boolean;
  checks: SubmissionValidationCheck[];
  itemIdSummary: SubmissionValidationItemIdSummary | null;
}

/**
 * Input for a PREDICTIONS validation. Note what is absent and cannot be added
 * without changing this type: the ground-truth labels.
 */
export interface PredictionsValidationInput {
  /** The payload as submitted, duplicates and all. */
  predictions: readonly { imageId: string; grade: number }[];
  /**
   * The task's item-ID key set — the SAME set the participant already holds via
   * `/input/index.json`. Labels are deliberately not part of this type.
   */
  taskItemIds: readonly string[];
  /** Public task config; already exposed by `GET /v2/evaluation/tasks/:slug`. */
  numClasses: number;
}

/** Input for a CONTAINER validation: is this image dispatchable at all. */
export interface ContainerValidationInput {
  imageRef: string;
  imageDigest: string;
  /** True when `imageRef` is pinned to `imageDigest` (see `sealed-run.ts`). */
  digestPinned: boolean;
  /** True when sealed execution is configured and a run could be enqueued. */
  dispatchAvailable: boolean;
}

function check(
  name: SubmissionValidationCheckName,
  ok: boolean,
  detail: string,
  itemIds: readonly string[] = [],
): SubmissionValidationCheck {
  return {
    name,
    ok,
    detail,
    itemIds: itemIds.slice(0, MAX_REPORTED_ITEM_IDS),
    itemIdCount: itemIds.length,
  };
}

/**
 * Validate a predictions payload against the task's interface contract.
 *
 * Four checks, each independently reported so a participant fixes everything in
 * one pass rather than discovering the next failure on the next submission —
 * unlike the scored path, which stops at the first problem because it has to
 * persist a single FAILED reason.
 */
export function validatePredictionsInterface(
  input: PredictionsValidationInput,
): InterfaceValidationOutcome {
  const { numClasses } = input;
  const maxLabel = numClasses - 1;

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const outOfRange = new Set<string>();
  const distinctIds: string[] = [];

  for (const { imageId, grade } of input.predictions) {
    if (seen.has(imageId)) {
      duplicates.add(imageId);
    } else {
      seen.add(imageId);
      distinctIds.push(imageId);
    }
    // The DTO already bounds `grade` to a non-negative integer; this is the
    // task-aware range the scored path enforces in `scoring.ts`.
    if (!Number.isInteger(grade) || grade < 0 || grade > maxLabel) {
      outOfRange.add(imageId);
    }
  }

  const taskIds = new Set(input.taskItemIds);
  const unrecognised = distinctIds.filter((id) => !taskIds.has(id)).sort();
  const recognisedCount = distinctIds.length - unrecognised.length;

  const itemIdSummary: SubmissionValidationItemIdSummary = {
    submitted: input.predictions.length,
    recognised: recognisedCount,
    unrecognised: unrecognised.length,
    notPredicted: taskIds.size - recognisedCount,
  };

  const checks: SubmissionValidationCheck[] = [
    check(
      'PAYLOAD_SHAPE',
      true,
      `Parsed ${input.predictions.length} prediction row(s) with the expected { imageId, grade } shape.`,
    ),
    duplicates.size === 0
      ? check('DUPLICATE_ITEM_IDS', true, 'No item ID appears more than once.')
      : check(
          'DUPLICATE_ITEM_IDS',
          false,
          `${duplicates.size} item ID(s) appear more than once. Send exactly one prediction per item ID; the scored path rejects the whole submission on the first duplicate.`,
          [...duplicates].sort(),
        ),
    outOfRange.size === 0
      ? check('LABEL_RANGE', true, `Every grade is an integer in [0, ${maxLabel}].`)
      : check(
          'LABEL_RANGE',
          false,
          `${outOfRange.size} prediction(s) carry a grade outside this task's range. Grades must be integers in [0, ${maxLabel}] (numClasses = ${numClasses}).`,
          [...outOfRange].sort(),
        ),
    itemIdsRecognisedCheck(unrecognised, recognisedCount, taskIds.size),
  ];

  return { ok: checks.every((c) => c.ok), checks, itemIdSummary };
}

/**
 * The unknown-ID check. Recognising zero IDs is called out separately because
 * it means something different in practice: not a few stragglers but the wrong
 * ID convention entirely, which would otherwise score as coverage 0 and read
 * as a bad model rather than bad plumbing.
 *
 * Note the shape of the detail text: counts of identifiers and the task's item
 * count, which the participant already has from `index.json`. Nothing here is a
 * function of a label.
 */
function itemIdsRecognisedCheck(
  unrecognised: readonly string[],
  recognisedCount: number,
  taskItemCount: number,
): SubmissionValidationCheck {
  if (unrecognised.length === 0) {
    return check(
      'ITEM_IDS_RECOGNISED',
      true,
      `All ${recognisedCount} submitted item ID(s) are contained in this task's ${taskItemCount} item(s).`,
    );
  }
  const detail =
    recognisedCount === 0
      ? `None of the submitted item IDs are contained in this task's ${taskItemCount} item(s). This is usually a naming convention mismatch rather than a partial submission — compare against the identifiers in the task's index.json.`
      : `${unrecognised.length} submitted item ID(s) are not contained in this task's ${taskItemCount} item(s); ${recognisedCount} are. Unknown IDs are a validation failure for a sealed run and are ignored when scoring a predictions file.`;
  return check('ITEM_IDS_RECOGNISED', false, detail, unrecognised);
}

/**
 * Validate a sealed-container submission's interface: is the image pinned, and
 * could a run be dispatched for it. Nothing is enqueued and no image is pulled
 * — this is the pre-flight the scored path performs before it persists a
 * dispatch record, run on its own and reported instead of thrown.
 *
 * `DISPATCH_AVAILABLE` deliberately does NOT name the missing environment
 * variables. The scored path's 503 does, because an operator asked for that;
 * a participant cannot act on them, and they are not the participant's to know.
 * The service logs the gap with the names.
 */
export function validateContainerInterface(
  input: ContainerValidationInput,
): InterfaceValidationOutcome {
  const checks: SubmissionValidationCheck[] = [
    input.digestPinned
      ? check(
          'IMAGE_DIGEST_PINNED',
          true,
          `imageRef is pinned to the submitted digest ${input.imageDigest}.`,
        )
      : check(
          'IMAGE_DIGEST_PINNED',
          false,
          `imageRef and imageDigest disagree: imageRef must end with "@${input.imageDigest}". A run is pulled by digest, never by tag, so the two must name the same image.`,
        ),
    input.dispatchAvailable
      ? check(
          'DISPATCH_AVAILABLE',
          true,
          'Sealed execution is configured on this environment; a scored submission would be enqueued for a run.',
        )
      : check(
          'DISPATCH_AVAILABLE',
          false,
          'Sealed execution is not configured on this environment, so a scored submission would be refused with 503. This is a platform-side gap, not a problem with your image — it has been logged for the operators.',
        ),
  ];

  // No predictions were submitted, so there is no item-ID arithmetic to do.
  return { ok: checks.every((c) => c.ok), checks, itemIdSummary: null };
}

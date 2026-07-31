import { Injectable, PipeTransform, type ArgumentMetadata } from '@nestjs/common';
import {
  SubmitContainerRequestSchema,
  SubmitPredictionsRequestSchema,
  type SubmitContainerRequest,
  type SubmitPredictionsRequest,
} from '@oci/shared-types';
import { ZodPipe } from './zod-pipe.js';

/**
 * Either shape `POST /v2/evaluation/tasks/:slug/submissions` accepts.
 * Discriminated by the presence of the `mode` literal: only the CONTAINER
 * request carries one.
 */
export type SubmitRequestBody = SubmitContainerRequest | SubmitPredictionsRequest;

/**
 * Routes the submission body to the right schema.
 *
 * Mode 1 must stay **byte-for-byte** what it is today — it is live on `dev` —
 * including its 400 payload. So this is not a `z.union` (whose error issues
 * would change for every malformed predictions body); a body without a `mode`
 * key goes through the exact same `ZodPipe(SubmitPredictionsRequestSchema)` as
 * before, and only a body that explicitly declares a non-`PREDICTIONS` mode is
 * parsed as a CONTAINER submission. `mode: 'PREDICTIONS'` sent explicitly is
 * accepted and stripped (Zod objects strip unknown keys), so both old and new
 * clients land on Mode 1.
 *
 * A body with a `mode` the platform does not implement (e.g. `ENCRYPTED`, WP8)
 * is parsed against the CONTAINER schema, whose `z.literal('CONTAINER')` gives
 * the caller an error naming the field that is wrong — better than reporting
 * "predictions is required".
 */
@Injectable()
export class SubmissionBodyPipe implements PipeTransform {
  private readonly predictions = new ZodPipe(SubmitPredictionsRequestSchema);
  private readonly container = new ZodPipe(SubmitContainerRequestSchema);

  transform(value: unknown, metadata: ArgumentMetadata): SubmitRequestBody {
    if (declaresNonPredictionsMode(value)) {
      return this.container.transform(value, metadata);
    }
    return this.predictions.transform(value, metadata);
  }
}

function declaresNonPredictionsMode(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (!('mode' in value)) return false;
  return (value as { mode?: unknown }).mode !== 'PREDICTIONS';
}

/** Narrowing helper for the controller / service branch. */
export function isContainerSubmission(body: SubmitRequestBody): body is SubmitContainerRequest {
  return 'mode' in body && body.mode === 'CONTAINER';
}

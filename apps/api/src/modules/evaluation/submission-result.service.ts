import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  SealedRunFailureCodeSchema,
  type TaskKindScores,
  type SealedRunFailureCode,
  type SealedRunResult,
  type SubmissionStatus,
} from '@oci/shared-types';
import { EvaluationRepository, type SubmissionResultContextRow } from './evaluation.repository.js';
import { parseScores } from './evaluation.service.js';
import {
  classifySealedRunResult,
  participantFacingFailureMessage,
  sealedRunResultFingerprint,
  SealedRunResultError,
} from './sealed-run.js';
import { ScoringError } from './scoring.js';
import { scoreByKind } from './scoring-registry.js';

/**
 * Response of `POST /v2/submissions/:id/result`.
 *
 * Note what is NOT here and cannot be added by accident: the worker's
 * `failure.detail`. The type has no field for it, the only value that reaches
 * `failure.message` comes from `participantFacingFailureMessage(code)`, and the
 * detail string is read at exactly one place in this file — a `void` logging
 * method. Container stdout is an exfiltration channel and this is the review
 * checkpoint for it (sealed-execution-contract §6).
 */
export interface SealedRunResultResponse {
  id: string;
  status: SubmissionStatus;
  /** Metrics as stored, tagged with their scoring family. Null unless SCORED. */
  scores: TaskKindScores | null;
  /** Present only when FAILED. `message` is derived from `code` ALONE. */
  failure: { code: SealedRunFailureCode; message: string } | null;
  /** True when this call re-delivered an already-applied result (200 no-op). */
  replayed: boolean;
}

const TERMINAL: readonly SubmissionStatus[] = ['SCORED', 'FAILED'];

/**
 * The sealed-run result outbox (WP3, sealed-execution-contract §5).
 *
 * `worker-eval` calls this after a run. Three payload shapes, one of them:
 *
 *   - `predictions` — the demo path. The worker returns labels; **the API
 *     scores them here** against ground truth it already holds, which keeps
 *     ground truth out of the sandbox entirely and keeps `scoring.ts` the
 *     single scoring implementation (this service does not reimplement any of
 *     it).
 *   - `metrics` — the genuinely host-resident path. The API cannot see the data,
 *     the host scored against its own labels, and the metrics are stored as-is.
 *   - `failure` — stored as a classified code plus the participant-facing text
 *     derived from that code.
 *
 * Idempotency is enforced by a predicated UPDATE in the repository
 * (`status = PENDING`), so a replay cannot score a second time even under
 * concurrent delivery. A replay of the SAME result is a 200 no-op; a DIFFERENT
 * result for a terminal submission is a 409.
 */
@Injectable()
export class SubmissionResultService {
  private readonly logger = new Logger(SubmissionResultService.name);

  constructor(@Inject(EvaluationRepository) private readonly repo: EvaluationRepository) {}

  async recordResult(
    submissionId: string,
    body: SealedRunResult,
  ): Promise<SealedRunResultResponse> {
    const submission = await this.repo.findSubmissionForResult(submissionId);
    if (!submission) {
      throw new NotFoundException(`submission "${submissionId}" not found`);
    }

    // Shape check first: "both" / "neither" is a malformed payload regardless of
    // the submission's state, and rejecting it before touching anything else
    // keeps the 400 unambiguous.
    const outcome = (() => {
      try {
        return classifySealedRunResult(body);
      } catch (err: unknown) {
        if (err instanceof SealedRunResultError) throw new BadRequestException(err.message);
        throw err;
      }
    })();

    const fingerprint = sealedRunResultFingerprint(body);

    // Already terminal → either this is a replay (200 no-op) or someone is
    // trying to overwrite a published result (409). Checked BEFORE scoring so a
    // replay demonstrably does no scoring work, not merely no second write.
    if (TERMINAL.includes(submission.status)) {
      return replayOrConflict(submission, fingerprint);
    }

    // Route-version gate (contract §5). Only enforceable against a dispatch
    // that recorded one; `routeVersion` stays null until the EvaluationRoute
    // registry lands (WP5), so today this is present and inert rather than
    // silently absent.
    if (submission.routeVersion !== null && body.routeVersion !== submission.routeVersion) {
      throw new ConflictException(
        `routeVersion does not match the route version dispatched for submission "${submissionId}"`,
      );
    }

    if (outcome.kind === 'failure') {
      this.logOperatorFailureDetail(submissionId, outcome.code, body.failure?.detail);
      return this.applyOrResolveRace(submissionId, fingerprint, {
        status: 'FAILED',
        scores: null,
        error: participantFacingFailureMessage(outcome.code),
        failureCode: outcome.code,
        durationMs: body.durationMs,
        resultFingerprint: fingerprint,
      });
    }

    if (outcome.kind === 'metrics') {
      // The host scored against its own labels and sent metrics. The
      // sealed-run contract types `metrics` as the GRADING set specifically
      // (`SealedRunResultSchema`), so that is what this path can honestly tag
      // them as. A CONTAINER task of any other kind must return `predictions`
      // and let the API score them, where dispatch is by the task's real kind —
      // until the worker contract carries a kind of its own, mislabelling
      // host-supplied metrics would be worse than restricting the path.
      return this.applyOrResolveRace(submissionId, fingerprint, {
        status: 'SCORED',
        scores: { kind: 'GRADING', metrics: outcome.metrics },
        error: null,
        failureCode: null,
        durationMs: body.durationMs,
        resultFingerprint: fingerprint,
      });
    }

    // predictions → score server-side against the hidden ground truth.
    const ctx = await this.repo.findScoringContextBySubmissionId(submissionId);
    if (!ctx) {
      throw new NotFoundException(`submission "${submissionId}" not found`);
    }

    let scores: TaskKindScores;
    try {
      // Dispatch on the task's own scoring family, exactly as the Mode 1 path
      // does — a sealed run of a CLASSIFICATION task must not be scored with
      // ordinal-agreement metrics.
      scores = scoreByKind({
        kind: ctx.taskKind,
        groundTruth: ctx.groundTruth,
        predictions: outcome.predictions,
        config: {
          numClasses: ctx.numClasses,
          referableThreshold: ctx.referableThreshold,
        },
      });
    } catch (err: unknown) {
      if (err instanceof ScoringError) {
        // Worker-returned predictions that do not fit the task are a
        // MALFORMED_OUTPUT failure, not a 400 to the worker: the run happened,
        // it produced an unusable artefact, and that is the submission's
        // outcome.
        this.logOperatorFailureDetail(submissionId, 'MALFORMED_OUTPUT', redactScoringError(err));
        return this.applyOrResolveRace(submissionId, fingerprint, {
          status: 'FAILED',
          scores: null,
          error: participantFacingFailureMessage('MALFORMED_OUTPUT'),
          failureCode: 'MALFORMED_OUTPUT',
          durationMs: body.durationMs,
          resultFingerprint: fingerprint,
        });
      }
      throw err;
    }

    return this.applyOrResolveRace(submissionId, fingerprint, {
      status: 'SCORED',
      scores,
      error: null,
      failureCode: null,
      durationMs: body.durationMs,
      resultFingerprint: fingerprint,
    });
  }

  /**
   * Write the result under the `status = PENDING` predicate. If the row was
   * claimed in between (0 rows updated), re-read and answer replay vs conflict
   * from what actually landed — never from what this call computed.
   */
  private async applyOrResolveRace(
    submissionId: string,
    fingerprint: string,
    update: Parameters<EvaluationRepository['applyResult']>[1],
  ): Promise<SealedRunResultResponse> {
    const applied = await this.repo.applyResult(submissionId, update);
    if (applied === 0) {
      const current = await this.repo.findSubmissionForResult(submissionId);
      if (!current) throw new NotFoundException(`submission "${submissionId}" not found`);
      return replayOrConflict(current, fingerprint);
    }
    return {
      id: submissionId,
      status: update.status,
      scores: update.scores,
      failure: failureFor(update.failureCode),
      replayed: false,
    };
  }

  /**
   * The ONLY place the worker's operator detail is read, and it returns `void`
   * so it cannot contribute to a response or a persisted column. Detail stays
   * host-side for debugging (contract §4/§6).
   *
   * `NETWORK_ATTEMPT_DETECTED` logs at `error`, not `warn`: a model attempting
   * egress inside a sealed run is a finding about that submission that the
   * operator and the host must see, not a transient error to swallow
   * (contract §6).
   */
  private logOperatorFailureDetail(
    submissionId: string,
    code: SealedRunFailureCode,
    detail: string | undefined,
  ): void {
    const line = `sealed run failed submissionId=${submissionId} code=${code}${
      detail ? ` detail=${detail}` : ''
    }`;
    if (code === 'NETWORK_ATTEMPT_DETECTED') {
      this.logger.error(line);
    } else {
      this.logger.warn(line);
    }
  }
}

/**
 * A terminal submission answers a replay of the same result with 200 and a
 * different result with 409. Equality is the stored fingerprint; a submission
 * with no fingerprint (a Mode 1 row, which was never dispatched) can only
 * conflict.
 */
function replayOrConflict(
  submission: SubmissionResultContextRow,
  fingerprint: string,
): SealedRunResultResponse {
  if (submission.resultFingerprint !== null && submission.resultFingerprint === fingerprint) {
    return {
      id: submission.id,
      status: submission.status,
      scores: parseScores(submission.scores),
      failure: failureFor(submission.failureCode),
      replayed: true,
    };
  }
  throw new ConflictException(
    `submission "${submission.id}" is already ${submission.status}; a different result cannot be applied`,
  );
}

/**
 * Build the participant-facing failure object from a stored / classified code.
 * An unrecognised stored value degrades to `INTERNAL_ERROR` rather than being
 * echoed — the column is text so that the taxonomy can grow, which means a
 * value written by a newer deploy must not become a passthrough.
 */
function failureFor(code: string | null): { code: SealedRunFailureCode; message: string } | null {
  if (code === null) return null;
  const parsed = SealedRunFailureCodeSchema.safeParse(code);
  const resolved: SealedRunFailureCode = parsed.success ? parsed.data : 'INTERNAL_ERROR';
  return { code: resolved, message: participantFacingFailureMessage(resolved) };
}

/**
 * `ScoringError` messages quote the offending id and label. For a
 * *prediction* label that is the participant's own container output, which the
 * operator may see; for the defensive *ground-truth* validation it would quote
 * a hidden label, and ground truth must not reach a log line either (plan §6).
 * So the ground-truth variant is withheld even from the operator log.
 */
function redactScoringError(err: ScoringError): string {
  if (err.message.startsWith('ground-truth')) {
    return 'ground-truth label validation failed — detail withheld (would quote hidden labels)';
  }
  return err.message;
}

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@oci/database';
import type {
  CreateEvaluationTaskRequest,
  EvaluationSubmissionResult,
  EvaluationTaskDetail,
  EvaluationTaskSummary,
  SealedRunMessage,
  SubmissionStatus,
  SubmitContainerRequest,
  SubmitContainerResponse,
  SubmitPredictionsRequest,
  SubmitPredictionsResponse,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { EvalQueueProvider } from './eval-queue.js';
import { EvaluationRepository } from './evaluation.repository.js';
import {
  imageRefMatchesDigest,
  participantFacingFailureMessage,
  SEALED_RUN_DEADLINE_SEC,
} from './sealed-run.js';
import { scoreSubmission, ScoringError, type EvaluationScores } from './scoring.js';

/**
 * Evaluation service (ADR-0017 / ADR-0018). Owns:
 *   - the public read surface (list + detail), which strips ground truth;
 *   - Mode 1: in-process scoring of a predictions-file submission against
 *     the task's HIDDEN ground truth, persisting SCORED / FAILED;
 *   - Mode 2: dispatch of a sealed-container submission — persist PENDING
 *     and enqueue, never score here. The result comes back through
 *     `SubmissionResultService` (the outbox);
 *   - admin/host task creation (the only non-SQL way a task + hidden
 *     labels get created).
 *
 * The controller enforces role gating; this layer trusts that gate.
 */
@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    @Inject(EvaluationRepository) private readonly repo: EvaluationRepository,
    @Inject(EvalQueueProvider) private readonly queue: EvalQueueProvider,
  ) {}

  async listTasks(): Promise<EvaluationTaskSummary[]> {
    const rows = await this.repo.listTasks();
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      datasetSlug: r.datasetSlug,
      taskKind: r.taskKind,
      submissionCount: r.submissionCount,
    }));
  }

  async getTaskDetail(slug: string): Promise<EvaluationTaskDetail> {
    const t = await this.repo.findBySlugWithSubmissions(slug);
    if (!t) throw new NotFoundException(`evaluation task "${slug}" not found`);

    const submissions: EvaluationSubmissionResult[] = t.submissions
      .map((s) => ({
        id: s.id,
        methodName: s.methodName,
        status: s.status,
        scores: parseScores(s.scores),
        createdAt: s.createdAt.toISOString(),
      }))
      // Best-QWK first; submissions without scores (PENDING / FAILED) sink
      // to the bottom.
      .sort((a, b) => (b.scores?.qwk ?? -Infinity) - (a.scores?.qwk ?? -Infinity));

    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      datasetSlug: t.datasetSlug,
      taskKind: t.taskKind,
      numClasses: t.numClasses,
      referableThreshold: t.referableThreshold,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      submissions,
    };
  }

  /**
   * Mode 1 submit: load the task, score the predictions in-process against
   * the hidden ground truth, persist a SCORED submission + return its
   * scores. On a validation / scoring error, persist a FAILED submission
   * carrying the reason and surface a 400.
   */
  async submitPredictions(
    slug: string,
    body: SubmitPredictionsRequest,
    user?: CognitoAccessTokenPayload,
  ): Promise<SubmitPredictionsResponse> {
    const ctx = await this.repo.findScoringContext(slug);
    if (!ctx) throw new NotFoundException(`evaluation task "${slug}" not found`);

    const submittedBy = user?.sub ? cognitoSubAsUuid(user.sub) : null;

    // Build the imageId -> grade map, rejecting duplicate imageIds (the DTO
    // validates the array shape but not cross-row uniqueness).
    const predictions: Record<string, number> = {};
    for (const p of body.predictions) {
      if (Object.prototype.hasOwnProperty.call(predictions, p.imageId)) {
        return await this.failSubmission(
          ctx.id,
          body.methodName,
          submittedBy,
          `duplicate imageId "${p.imageId}" in predictions`,
        );
      }
      predictions[p.imageId] = p.grade;
    }

    let scores: EvaluationScores;
    try {
      scores = scoreSubmission({
        groundTruth: ctx.groundTruth,
        predictions,
        numClasses: ctx.numClasses,
        referableThreshold: ctx.referableThreshold,
      });
    } catch (err: unknown) {
      if (err instanceof ScoringError) {
        return await this.failSubmission(ctx.id, body.methodName, submittedBy, err.message);
      }
      throw err;
    }

    const created = await this.repo.createSubmission({
      taskId: ctx.id,
      methodName: body.methodName,
      submittedBy,
      status: 'SCORED',
      scores,
      error: null,
    });
    return { id: created.id, scores };
  }

  /**
   * Mode 2 submit (sealed container). Persists a PENDING dispatch record and
   * publishes a `SealedRunMessage`; **no scoring happens here** — the worker
   * runs the image against host-resident data and POSTs back to the outbox,
   * which scores. Ground truth is never read on this path, and the task's
   * hidden labels are never loaded into this request at all.
   *
   * Order of operations matters:
   *   1. resolve the task (404 if unknown);
   *   2. refuse loudly if dispatch is not configured — a 503 BEFORE any row is
   *      written, so an un-enqueueable submission never leaves a PENDING row
   *      that no worker will ever consume;
   *   3. assert the ref and the digest agree (image-substitution guard);
   *   4. persist, then publish. If the publish fails the row is marked FAILED
   *      immediately for the same reason as (2).
   */
  async submitContainer(
    slug: string,
    body: SubmitContainerRequest,
    user?: CognitoAccessTokenPayload,
  ): Promise<SubmitContainerResponse> {
    const task = await this.repo.findTaskRefBySlug(slug);
    if (!task) throw new NotFoundException(`evaluation task "${slug}" not found`);

    const missing = this.queue.missingConfig();
    if (missing.length > 0) {
      this.logger.error(
        `sealed-container submission refused — dispatch not configured (missing ${missing.join(', ')})`,
      );
      throw new ServiceUnavailableException(
        `sealed execution is not configured on this environment (missing ${missing.join(', ')})`,
      );
    }

    if (!imageRefMatchesDigest(body.imageRef, body.imageDigest)) {
      throw new BadRequestException(
        'imageRef must be pinned to the submitted imageDigest — the two disagree',
      );
    }

    const submittedBy = user?.sub ? cognitoSubAsUuid(user.sub) : null;

    const created = await this.repo.createContainerSubmission({
      taskId: task.id,
      methodName: body.methodName,
      submittedBy,
      imageRef: body.imageRef,
      imageDigest: body.imageDigest,
      // No route registry yet (WP5). Dispatching an invented uuid/version that
      // resolves to nothing would be worse than an absent value, and the outbox
      // only enforces a routeVersion match when one WAS dispatched.
      routeId: null,
      routeVersion: null,
    });

    const message: SealedRunMessage = {
      submissionId: created.id,
      taskSlug: task.slug,
      imageRef: body.imageRef,
      imageDigest: body.imageDigest,
      timeoutSec: this.queue.runTimeoutSec,
      callbackUrl: this.queue.callbackUrlFor(created.id),
      deadline: new Date(Date.now() + SEALED_RUN_DEADLINE_SEC * 1000).toISOString(),
    };

    try {
      await this.queue.publish(message);
    } catch (err: unknown) {
      // A PENDING row nobody will ever consume is worse than a visible failure:
      // it reads as "still running" forever. Mark it FAILED and tell the caller.
      await this.repo.applyResult(created.id, {
        status: 'FAILED',
        scores: null,
        error: participantFacingFailureMessage('INTERNAL_ERROR'),
        failureCode: 'INTERNAL_ERROR',
        durationMs: null,
        resultFingerprint: null,
      });
      this.logger.error(
        `sealed-run dispatch failed submissionId=${created.id} task=${task.slug}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new ServiceUnavailableException(
        'sealed execution dispatch failed; the submission was recorded as failed',
      );
    }

    return { id: created.id, status: 'PENDING' };
  }

  async createTask(body: CreateEvaluationTaskRequest): Promise<EvaluationTaskSummary> {
    try {
      const created = await this.repo.createTask({
        slug: body.slug,
        name: body.name,
        datasetSlug: body.datasetSlug,
        taskKind: body.taskKind,
        numClasses: body.numClasses,
        referableThreshold: body.referableThreshold,
        groundTruth: body.groundTruth,
      });
      return {
        id: created.id,
        slug: created.slug,
        name: body.name,
        datasetSlug: body.datasetSlug,
        taskKind: body.taskKind,
        submissionCount: 0,
      };
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException(`slug "${body.slug}" is already taken`);
      }
      throw err;
    }
  }

  /**
   * Persist a FAILED submission and throw a 400 carrying the same reason.
   * Never returns normally — the `Promise<never>`-flavoured return type lets
   * callers write `return await this.failSubmission(...)`.
   */
  private async failSubmission(
    taskId: string,
    methodName: string,
    submittedBy: string | null,
    reason: string,
  ): Promise<never> {
    const created = await this.repo.createSubmission({
      taskId,
      methodName,
      submittedBy,
      status: 'FAILED' satisfies SubmissionStatus,
      scores: null,
      error: reason,
    });
    throw new BadRequestException({ message: reason, submissionId: created.id });
  }
}

/**
 * Coerce a stored `scores` JSON blob to `EvaluationScores | null`. Rows are
 * written by this service (or by the outbox), so the shape is trusted; we still
 * guard against a null / non-object so a corrupt row can't crash the detail
 * render. Exported so the result outbox reuses this one coercion rather than
 * growing a second, slightly-different copy.
 */
export function parseScores(raw: unknown): EvaluationScores | null {
  if (raw === null || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (
    typeof s.qwk === 'number' &&
    typeof s.accuracy === 'number' &&
    typeof s.referableSensitivity === 'number' &&
    typeof s.referableSpecificity === 'number' &&
    typeof s.coverage === 'number'
  ) {
    return {
      qwk: s.qwk,
      accuracy: s.accuracy,
      referableSensitivity: s.referableSensitivity,
      referableSpecificity: s.referableSpecificity,
      coverage: s.coverage,
    };
  }
  return null;
}

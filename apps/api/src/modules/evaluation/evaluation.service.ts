import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@oci/database';
import type {
  CreateEvaluationTaskRequest,
  EvaluationSubmissionResult,
  EvaluationTaskDetail,
  EvaluationTaskSummary,
  SubmissionStatus,
  SubmitPredictionsRequest,
  SubmitPredictionsResponse,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { EvaluationRepository } from './evaluation.repository.js';
import { scoreSubmission, ScoringError, type EvaluationScores } from './scoring.js';

/**
 * Evaluation service (ADR-0017, Mode 1). Owns:
 *   - the public read surface (list + detail), which strips ground truth;
 *   - in-process scoring of a predictions-file submission against the
 *     task's HIDDEN ground truth, persisting SCORED / FAILED;
 *   - admin/host task creation (the only non-SQL way a task + hidden
 *     labels get created).
 *
 * The controller enforces role gating; this layer trusts that gate.
 */
@Injectable()
export class EvaluationService {
  constructor(@Inject(EvaluationRepository) private readonly repo: EvaluationRepository) {}

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
 * written by this service, so the shape is trusted; we still guard against
 * a null / non-object so a corrupt row can't crash the detail render.
 */
function parseScores(raw: unknown): EvaluationScores | null {
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

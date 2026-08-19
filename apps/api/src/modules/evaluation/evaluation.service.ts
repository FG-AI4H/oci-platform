import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@oci/database';
import type {
  CreateEvaluationTaskRequest,
  EvaluationSubmissionResult,
  EvaluationTaskDetail,
  EvaluationTaskSummary,
  SealedRunMessage,
  SubmissionMode,
  SubmissionStatus,
  SubmissionValidationReport,
  SubmitContainerRequest,
  SubmitContainerResponse,
  SubmitPredictionsRequest,
  SubmitPredictionsResponse,
  TaskKindScores,
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
import {
  nextQuotaWeekStart,
  quotaState,
  quotaWeekStart,
  SCORED_SUBMISSIONS_PER_TASK,
  SCORED_SUBMISSIONS_PER_WEEK,
  totalQuotaExceededMessage,
  weeklyQuotaExceededMessage,
} from './submission-quota.js';
import {
  validateContainerInterface,
  validatePredictionsInterface,
  type InterfaceValidationOutcome,
} from './submission-validation.js';
import { ScoringError } from './scoring.js';
import { primaryMetricOf, scoreByKind } from './scoring-registry.js';

/**
 * Refusal text for an anonymous SCORED submission (WP6).
 *
 * The submit endpoint is behind `OptionalCognitoJwtGuard` and
 * `Submission.submittedBy` is nullable, so anonymous scored submissions were
 * possible — which makes a PER-PARTICIPANT quota unenforceable: an anonymous
 * caller has no participant to count against, and refusing to count them would
 * make the cap trivially bypassable by dropping the token. Scored submissions
 * therefore now require an identified participant. Validation submissions stay
 * open to anonymous callers, so the open path a participant needs in order to
 * get their plumbing right is still there.
 *
 * 401, not 403: the caller presented no credentials at all. A caller who
 * presents a bad token still gets 401 from the guard itself.
 */
export const SCORED_SUBMISSION_REQUIRES_IDENTITY_MESSAGE =
  'Scored submissions require an identified participant: send a bearer token for the participant ' +
  'the submission belongs to. Anonymous scored submissions are refused because the per-task ' +
  'submission quota (3 per calendar week, 10 per task in total) can only be enforced against an ' +
  'identity. Validation submissions remain open to anonymous callers — resend the same body with ' +
  '"intent": "VALIDATION" to check the interface contract without a score.';

/**
 * Evaluation service (ADR-0017 / ADR-0018). Owns:
 *   - the public read surface (list + detail), which strips ground truth;
 *   - Mode 1: in-process scoring of a predictions-file submission against
 *     the task's HIDDEN ground truth, persisting SCORED / FAILED;
 *   - Mode 2: dispatch of a sealed-container submission — persist PENDING
 *     and enqueue, never score here. The result comes back through
 *     `SubmissionResultService` (the outbox);
 *   - validation submissions (WP6): the same two shapes checked against the
 *     interface contract and answered with a report instead of a score. They
 *     write no row, enqueue nothing, and spend no quota;
 *   - the scored-submission quota (WP6): 3 per participant per task per
 *     calendar week, 10 per participant per task in total;
 *   - admin/host task creation (the only non-SQL way a task + hidden
 *     labels get created).
 *
 * The controller enforces role gating; this layer trusts that gate. It does NOT
 * trust the controller for participant identity on a scored path — `requireParticipant`
 * is what refuses an anonymous scored submission, because that refusal is what
 * makes the quota enforceable.
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
      // Best-first on the scoring family's own primary metric — quadratic-
      // weighted kappa for GRADING, macro F1 for CLASSIFICATION (ADR-0020).
      // Every submission on one task shares that task's kind, so the ordering
      // is well defined; ordering ACROSS tasks is not, which is why results are
      // reported per task. Unscored rows sink rather than sorting as zero.
      .sort((a, b) => primaryMetricOf(b.scores) - primaryMetricOf(a.scores));

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
   *
   * WP6 added two gates in front of the unchanged scoring body: the submission
   * must belong to an identified participant, and that participant must be
   * inside their per-task quota. Both run BEFORE anything is persisted and
   * before anything is scored, so a refused submission leaves no row and burns
   * no slot.
   */
  async submitPredictions(
    slug: string,
    body: SubmitPredictionsRequest,
    user?: CognitoAccessTokenPayload,
  ): Promise<SubmitPredictionsResponse> {
    // Cheapest gate first — no I/O at all on the anonymous rejection path.
    const submittedBy = this.requireParticipant(user);

    const ctx = await this.repo.findScoringContext(slug);
    if (!ctx) throw new NotFoundException(`evaluation task "${slug}" not found`);

    // The hidden ground truth is loaded (by the call above) before the quota is
    // checked, and is discarded unread if the quota refuses. That is safe — it
    // never reaches a response, a log or the exception — and it keeps this path
    // to one task read rather than two on the happy path.
    await this.assertWithinScoredQuota(ctx.id, slug, submittedBy);

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

    let scores: TaskKindScores;
    try {
      // Dispatch on the task's own kind rather than assuming ordinal grading.
      // `scoreByKind` validates the payload against the kind's declared schema
      // before scoring, so a shape error fails the submission instead of
      // producing a partially-scored one.
      scores = scoreByKind({
        kind: ctx.taskKind,
        groundTruth: ctx.groundTruth,
        predictions,
        config: {
          numClasses: ctx.numClasses,
          referableThreshold: ctx.referableThreshold,
        },
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
   *   0. (WP6) refuse an anonymous caller, then refuse a caller over quota —
   *      both before any row is written or any message published;
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
    const submittedBy = this.requireParticipant(user);

    const task = await this.repo.findTaskRefBySlug(slug);
    if (!task) throw new NotFoundException(`evaluation task "${slug}" not found`);

    await this.assertWithinScoredQuota(task.id, task.slug, submittedBy);

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

  /**
   * Validation submit, PREDICTIONS (WP6). Checks the interface contract and
   * returns a report; scores nothing, writes nothing, spends no quota.
   *
   * Note the signature: no `user`. The quota is keyed on a participant id, and
   * this method is never given one, so it cannot consume quota — the guarantee
   * is structural rather than a rule someone has to remember. For the same
   * reason it reads `findTaskItemIds` and never `findScoringContext`: the hidden
   * labels are not loaded into this request at all.
   */
  async validatePredictions(
    slug: string,
    body: SubmitPredictionsRequest,
  ): Promise<SubmissionValidationReport> {
    const task = await this.repo.findTaskItemIds(slug);
    if (!task) throw new NotFoundException(`evaluation task "${slug}" not found`);

    const outcome = validatePredictionsInterface({
      predictions: body.predictions,
      taskItemIds: task.itemIds,
      numClasses: task.numClasses,
    });
    this.logValidation(task.slug, 'PREDICTIONS', body.methodName, outcome);
    return validationReport(task.slug, 'PREDICTIONS', outcome);
  }

  /**
   * Validation submit, CONTAINER (WP6). Checks that the image is digest-pinned
   * and that a run could be dispatched at all — and then does NOT dispatch one.
   * No queue message, no PENDING row, no image pull.
   *
   * A missing dispatch configuration is reported as a failed check rather than
   * thrown as a 503: the participant asked "would this work", and "the platform
   * cannot currently run anything" is a truthful answer to that question, not an
   * error in their request. The operator-facing detail (which env vars are
   * missing) goes to the log, mirroring `submitContainer`'s 503 path.
   */
  async validateContainer(
    slug: string,
    body: SubmitContainerRequest,
  ): Promise<SubmissionValidationReport> {
    const task = await this.repo.findTaskRefBySlug(slug);
    if (!task) throw new NotFoundException(`evaluation task "${slug}" not found`);

    const missing = this.queue.missingConfig();
    if (missing.length > 0) {
      this.logger.error(
        `sealed-container validation reports dispatch unavailable — not configured (missing ${missing.join(', ')})`,
      );
    }

    const outcome = validateContainerInterface({
      imageRef: body.imageRef,
      imageDigest: body.imageDigest,
      digestPinned: imageRefMatchesDigest(body.imageRef, body.imageDigest),
      dispatchAvailable: missing.length === 0,
    });
    this.logValidation(task.slug, 'CONTAINER', body.methodName, outcome);
    return validationReport(task.slug, 'CONTAINER', outcome);
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

  /**
   * Resolve the participant a SCORED submission is attributed to, refusing an
   * anonymous one (WP6).
   *
   * The endpoint's guard is deliberately *optional* so validation submissions
   * stay open — a participant debugging their interface should not need to
   * authenticate. But a per-participant quota is only a quota if the
   * participant is identified: with anonymous scoring, the 3-per-week and
   * 10-per-task caps are bypassed by simply omitting the token, which is worse
   * than having no cap because the limit then only binds honest entrants.
   *
   * So identity is required here and nowhere else, and the message says what
   * the open alternative is rather than leaving the caller to guess.
   */
  /**
   * Record that a validation ran, for operators only.
   *
   * Deliberately logs the *shape* of the outcome — pass/fail and the failing
   * check codes — and never the payload or any item id. A validation report is
   * derived from the ground-truth key set, and a log line is the easiest place
   * for that to end up somewhere it should not be.
   */
  private logValidation(
    taskSlug: string,
    mode: SubmissionMode,
    methodName: string,
    outcome: InterfaceValidationOutcome,
  ): void {
    const failed = outcome.checks.filter((c) => !c.ok).map((c) => c.name);
    this.logger.log(
      `validation ${mode} task=${taskSlug} method=${methodName} ok=${outcome.ok}` +
        (failed.length > 0 ? ` failed=[${failed.join(',')}]` : ''),
    );
  }

  private requireParticipant(user?: CognitoAccessTokenPayload): string {
    if (!user?.sub) {
      throw new UnauthorizedException(
        'a scored submission must be attributed to an identified participant — sign in and ' +
          'retry. Validation submissions (intent: "VALIDATION") need no account and are ' +
          'unlimited; use those to check your interface first.',
      );
    }
    return cognitoSubAsUuid(user.sub);
  }

  /**
   * Refuse a SCORED submission that would exceed either cap: the per-week
   * allowance or the per-task lifetime allowance (WP6).
   *
   * The total is checked first. When a participant has exhausted the lifetime
   * allowance the weekly reset instant is irrelevant and quoting it would be
   * actively misleading — nothing becomes available next Monday.
   *
   * Both messages carry the limit, the usage and (for the weekly cap) a
   * concrete reset instant, so a participant never has to email support to
   * learn when they can submit again.
   */
  private async assertWithinScoredQuota(
    taskId: string,
    taskSlug: string,
    submittedBy: string,
  ): Promise<void> {
    const totalUsed = await this.repo.countScoredSubmissionsForParticipant({
      taskId,
      submittedBy,
    });
    if (totalUsed >= SCORED_SUBMISSIONS_PER_TASK) {
      throw new ForbiddenException({
        message: totalQuotaExceededMessage(taskSlug),
        quota: quotaState('TASK_TOTAL', totalUsed, null),
      });
    }

    const now = new Date();
    const weekStart = quotaWeekStart(now);
    const weekUsed = await this.repo.countScoredSubmissionsForParticipant({
      taskId,
      submittedBy,
      since: weekStart,
    });
    if (weekUsed >= SCORED_SUBMISSIONS_PER_WEEK) {
      const resetsAt = nextQuotaWeekStart(now);
      throw new ForbiddenException({
        message: weeklyQuotaExceededMessage(taskSlug, resetsAt),
        quota: quotaState('WEEK', weekUsed, resetsAt),
      });
    }
  }
}

/**
 * Wrap a validation outcome in the response DTO.
 *
 * The three constant fields are the point: `scores: null`, `submissionId: null`
 * and `quotaConsumed: false` are literals in the schema, so the WP6 guarantees
 * are legible in the payload a participant receives rather than being something
 * they have to take on trust. They are not computed, so they cannot drift.
 */
function validationReport(
  taskSlug: string,
  mode: SubmissionMode,
  outcome: InterfaceValidationOutcome,
): SubmissionValidationReport {
  return {
    intent: 'VALIDATION',
    mode,
    taskSlug,
    ok: outcome.ok,
    scores: null,
    submissionId: null,
    quotaConsumed: false,
    checks: outcome.checks,
    itemIdSummary: outcome.itemIdSummary,
  };
}

/**
 * Coerce a stored `scores` JSON blob to `TaskKindScores | null`.
 *
 * Two shapes exist in the column and both must read back cleanly:
 *
 *   - the ADR-0020 envelope `{ kind, metrics }`, written by this service and
 *     the outbox from now on;
 *   - the bare `GRADING` object written before ADR-0020 — no `kind` field at
 *     all. Those rows are real published results, so they are wrapped rather
 *     than discarded: a legacy row reads as `{ kind: 'GRADING', metrics }`.
 *
 * Validated with the Zod schema rather than hand-sniffed keys, so a third shape
 * can never slip through as a half-populated object. A blob matching neither
 * returns `null` — a corrupt row must not crash a task's detail render.
 *
 * Exported so the result outbox reuses this one coercion rather than growing a
 * second, slightly-different copy.
 */
export function parseScores(raw: unknown): TaskKindScores | null {
  if (raw === null || typeof raw !== 'object') return null;

  const envelope = TaskKindScoresSchema.safeParse(raw);
  if (envelope.success) return envelope.data;

  // Pre-ADR-0020 row: the grading metrics, unwrapped.
  const legacy = GradingScoresSchema.safeParse(raw);
  if (legacy.success) return { kind: 'GRADING', metrics: legacy.data };

  return null;
}

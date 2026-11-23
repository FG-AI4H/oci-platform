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
import { canonicalSha256, type AuditEmitter } from '@oci/audit';
import { Prisma } from '@oci/database';
import {
  GradingScoresSchema,
  MIN_SUBGROUP_CELL_SIZE,
  TaskKindScoresSchema,
} from '@oci/shared-types';
import type {
  CreateEvaluationTaskRequest,
  EvaluationSubmissionDetail,
  EvaluationSubmissionResult,
  EvaluationTaskDetail,
  EvaluationTaskSummary,
  ScoredSubmissionQuotaSummary,
  SealedRunFailureCode,
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
import { AUDIT_EMITTER } from '../audit/audit.module.js';
import { attributionFor } from './route-registry.js';
import { EvalQueueProvider } from './eval-queue.js';
import { EvaluationRepository } from './evaluation.repository.js';
import {
  imageRefMatchesDigest,
  participantFacingFailureMessage,
  SEALED_RUN_DEADLINE_SEC,
} from './sealed-run.js';
import {
  consumesScoredQuota,
  nextQuotaWeekStart,
  quotaState,
  quotaSummary,
  quotaWeekStart,
  resolveScoredQuotaLimits,
  type ScoredQuotaLimits,
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
import { parseSubgroupResults } from './subgroup-config.js';
import { scoreSubgroups } from './subgroup-scoring.js';

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
  'submission quota can only be enforced against an identity. Validation submissions remain open ' +
  'to anonymous callers — resend the same body with "intent": "VALIDATION" to check the interface ' +
  'contract without a score.';
// Deliberately does not quote the limits. They are per-environment now, and a
// refusal that states a number the environment does not enforce is worse than
// one that states none — the caller who hits the actual cap is told the real
// figure by the message that refuses them.

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
 *   - the scored-submission quota (WP6): per participant per task, per
 *     calendar week and in total, at the limits configured for the
 *     environment. A predictions file refused before scoring does not count
 *     (#645);
 *   - one submission's own result, with the rule for who may read a FAILED
 *     one (#645);
 *   - admin/host task creation (the only non-SQL way a task + hidden
 *     labels get created);
 *   - the audit events of all of the above (#653): `evaluation.task.created`,
 *     `.submitted`, `.scored` and `.failed`. They carry ids, the method
 *     version and sha256 hashes (`canonicalSha256` from `@oci/audit`), never a
 *     prediction, a label or a refusal text that could quote one.
 *
 * The controller enforces role gating; this layer trusts that gate. It does NOT
 * trust the controller for participant identity on a scored path — `requireParticipant`
 * is what refuses an anonymous scored submission, because that refusal is what
 * makes the quota enforceable.
 */
@Injectable()
export class EvaluationService {
  /**
   * Caps in force for this environment, resolved ONCE. Re-reading the
   * environment per request would let the limit a check enforced differ from
   * the limit its refusal message quotes.
   */
  private readonly quotaLimits: ScoredQuotaLimits;

  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    @Inject(EvaluationRepository) private readonly repo: EvaluationRepository,
    @Inject(EvalQueueProvider) private readonly queue: EvalQueueProvider,
    @Inject(AUDIT_EMITTER) private readonly audit: AuditEmitter,
  ) {
    const { limits, warnings } = resolveScoredQuotaLimits(process.env);
    this.quotaLimits = limits;
    // Log the caps in force at startup unconditionally. An operator debugging a
    // quota refusal should not have to infer the configured limit from a task
    // definition, and a misconfiguration that fell back to a default is only
    // discoverable if the fallback announces itself.
    for (const w of warnings) this.logger.warn(`scored quota config: ${w}`);
    this.logger.log(
      `scored-submission quota in force: ${limits.perWeek}/participant/task/week, ` +
        `${limits.perTask}/participant/task total`,
    );
  }

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
        // Invariant 3 (WP5): a score never leaves the API without its route.
        // Rows scored before the registry existed are labelled LEGACY rather
        // than backfilled or hidden — see attributionFor.
        attribution: attributionFor(s),
        createdAt: s.createdAt.toISOString(),
      }))
      // Best-first on the scoring family's own primary metric — quadratic-
      // weighted kappa for GRADING, macro F1 for CLASSIFICATION, balanced
      // accuracy for BINARY_DIAGNOSTIC (ADR-0020).
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
      positiveClassName: t.positiveClassName,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      // #441 — the item-ID key set, so a Mode 1 participant can key a
      // predictions file without inferring the convention from the dataset
      // manifest. The repository has already reduced the ground truth to its
      // keys; there is no label in `t` to leak here.
      itemIds: t.itemIds,
      itemCount: t.itemIds.length,
      // #410 — the declared fields only. Which item has which value is held
      // like the answer key and is not part of `t`.
      subgroupFields: t.subgroupFields,
      submissions,
    };
  }

  /**
   * One submission's full result (#645).
   *
   * A SCORED or PENDING submission is returned to anyone: it is already in the
   * task's public result list, and this adds nothing to it but the task context.
   * A FAILED one is returned to its submitter and to administrators only, with
   * the reason. To anyone else it is a 404 with the same text as an id that does
   * not exist, so the answer does not distinguish "not yours" from "not there".
   *
   * The reason is the stored participant-facing text. For a sealed run that is
   * the sentence derived from the failure code, never the worker's detail.
   */
  async getSubmissionDetail(
    slug: string,
    submissionId: string,
    user?: CognitoAccessTokenPayload,
  ): Promise<EvaluationSubmissionDetail> {
    const notFound = () =>
      new NotFoundException(`submission "${submissionId}" not found on evaluation task "${slug}"`);

    const row = await this.repo.findSubmissionDetail(slug, submissionId);
    if (!row) throw notFound();

    // A row with no submitter (created before scored submissions required an
    // identity) matches nobody, so only an administrator reads its failure.
    const viewerIsSubmitter =
      !!user?.sub && row.submittedBy !== null && row.submittedBy === cognitoSubAsUuid(user.sub);
    const failed = row.status === 'FAILED';
    if (failed && !viewerIsSubmitter && !isAdministrator(user)) throw notFound();

    return {
      id: row.id,
      task: row.task,
      methodName: row.methodName,
      mode: row.mode,
      status: row.status,
      scores: parseScores(row.scores),
      // #410 — stored already suppressed: the same object for every reader,
      // submitter and administrator included (ADR-0030).
      subgroups: parseSubgroupResults(row.subgroupScores),
      attribution: attributionFor(row),
      failure: failed
        ? {
            reason: row.error ?? 'No reason was recorded for this failure.',
            quotaConsumed: consumesScoredQuota(row),
          }
        : null,
      viewerIsSubmitter,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * What the caller has left on one task (#645), so a page can show it before
   * a slot is spent. Same counts, same limits and same week as the gate in
   * front of a scored submission — it reads through `readQuotaUsage`, the one
   * place usage is counted, so the figure shown and the figure enforced cannot
   * drift apart.
   */
  async getScoredQuota(
    slug: string,
    user?: CognitoAccessTokenPayload,
  ): Promise<ScoredSubmissionQuotaSummary> {
    const submittedBy = this.requireParticipant(user);
    const task = await this.repo.findTaskRefBySlug(slug);
    if (!task) throw new NotFoundException(`evaluation task "${slug}" not found`);

    const now = new Date();
    const usage = await this.readQuotaUsage(task.id, submittedBy, now);
    return quotaSummary(task.slug, usage, this.quotaLimits, now);
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
   *
   * A FAILED row written here does not count against the quota either (#645):
   * every `failSubmission` below fires before `createSubmission` records a
   * score, so the file was refused on its format and never compared with the
   * labels. Keep it that way — a failure added AFTER scoring would be free
   * oracle queries. See `consumesScoredQuota`.
   */
  async submitPredictions(
    slug: string,
    body: SubmitPredictionsRequest,
    user?: CognitoAccessTokenPayload,
    /**
     * EvalAI seam provenance (WP4). When present the participant is already
     * resolved from the entrant identity the seam sent, so `requireParticipant`
     * is bypassed — NOT because the seam is unauthenticated, but because its
     * caller is a machine and the participant it acts for is an EvalAI team,
     * not a Cognito user. The quota still binds that team.
     */
    seam?: { submittedBy: string; externalSubmissionId: string; externalChallengeId: string },
  ): Promise<SubmitPredictionsResponse> {
    // Cheapest gate first — no I/O at all on the anonymous rejection path.
    const submittedBy = seam ? seam.submittedBy : this.requireParticipant(user);

    const ctx = await this.repo.findScoringContext(slug);
    if (!ctx) throw new NotFoundException(`evaluation task "${slug}" not found`);

    // The hidden ground truth is loaded (by the call above) before the quota is
    // checked, and is discarded unread if the quota refuses. That is safe — it
    // never reaches a response, a log or the exception — and it keeps this path
    // to one task read rather than two on the happy path.
    await this.assertWithinScoredQuota(ctx.id, slug, submittedBy);

    // What the audit trail records of the file: its hash, never its content.
    const predictionsSha256 = canonicalSha256(body.predictions);
    const failure = { taskId: ctx.id, taskSlug: slug, predictionsSha256 };

    // Build the imageId -> grade map, rejecting duplicate imageIds (the DTO
    // validates the array shape but not cross-row uniqueness). Scores, where a
    // row has one, go into their own map: the registry decides whether this
    // task's kind takes them, and refuses them if not (#650).
    const predictions: Record<string, number> = {};
    const itemScores: Record<string, number> = {};
    for (const p of body.predictions) {
      if (Object.prototype.hasOwnProperty.call(predictions, p.imageId)) {
        return await this.failSubmission(
          failure,
          body.methodName,
          submittedBy,
          `duplicate imageId "${p.imageId}" in predictions`,
        );
      }
      predictions[p.imageId] = p.grade;
      if (p.score !== undefined) itemScores[p.imageId] = p.score;
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
        // Absent rather than empty when no row had a score, so a kind that
        // takes none sees exactly what it saw before scores existed.
        itemScores: Object.keys(itemScores).length > 0 ? itemScores : undefined,
        config: {
          numClasses: ctx.numClasses,
          referableThreshold: ctx.referableThreshold,
        },
      });
    } catch (err: unknown) {
      if (err instanceof ScoringError) {
        return await this.failSubmission(failure, body.methodName, submittedBy, err.message);
      }
      throw err;
    }

    // Results by subgroup (#410), from the same validated payload, OUTSIDE the
    // try above on purpose: the labels have now been consulted, so nothing
    // from here on may turn into a FAILED row (a free oracle query, see
    // `consumesScoredQuota`). A throw here is a server fault: it surfaces as a
    // 500 and writes nothing, so the caller learns nothing either.
    const subgroupScores = scoreSubgroups({
      kind: ctx.taskKind,
      groundTruth: ctx.groundTruth,
      predictions,
      itemScores: Object.keys(itemScores).length > 0 ? itemScores : undefined,
      config: { numClasses: ctx.numClasses, referableThreshold: ctx.referableThreshold },
      subgroups: ctx.subgroups,
      minCellSize: MIN_SUBGROUP_CELL_SIZE,
    });

    // Seam submissions are attributed to the reference route here, because the
    // seam's response contract reports the route and whether its result counts
    // as published. Direct participant submissions are left unattributed on
    // purpose: pinning the route on every submission, in both modes and with a
    // refusal when none resolves, is #583 and lands there.
    const ref = seam ? await this.repo.findReferenceRouteVersionForMode('PREDICTIONS') : null;
    if (seam && !ref) {
      this.logger.error(
        'no reference PREDICTIONS route is seeded — this seam submission is scored ' +
          'without attribution and will read as a pre-registry result',
      );
    }
    const created = await this.repo.createSubmission({
      taskId: ctx.id,
      methodName: body.methodName,
      submittedBy,
      status: 'SCORED',
      scores,
      subgroupScores,
      error: null,
      routeId: ref?.routeId ?? null,
      routeVersion: ref?.version ?? null,
      routeVersionId: ref?.versionId ?? null,
      externalSubmissionId: seam?.externalSubmissionId ?? null,
      externalChallengeId: seam?.externalChallengeId ?? null,
    });

    // `emit`, not `emitSync`: the row is SCORED and the quota slot is spent, so
    // an audit write that fails must not turn the answer into a 500 that hides
    // the scores from the participant. `emit` queues when Redis is wired and
    // otherwise logs the failure and swallows it (ADR-0014): a SCORED row
    // without its two events is the visible gap. The two events share one
    // payload apart from the scores hash.
    const submitted = {
      taskId: ctx.id,
      taskSlug: slug,
      taskKind: ctx.taskKind,
      mode: 'PREDICTIONS' satisfies SubmissionMode,
      methodName: body.methodName,
      routeId: ref?.routeId ?? null,
      routeVersion: ref?.version ?? null,
      routeVersionId: ref?.versionId ?? null,
      externalSubmissionId: seam?.externalSubmissionId ?? null,
      externalChallengeId: seam?.externalChallengeId ?? null,
      predictionCount: body.predictions.length,
      predictionsSha256,
    };
    await this.audit.emit({
      module: 'evaluation',
      action: 'submitted',
      subjectType: 'evaluation-submission',
      subjectId: created.id,
      actorUserId: submittedBy,
      payload: submitted,
    });
    await this.audit.emit({
      module: 'evaluation',
      action: 'scored',
      subjectType: 'evaluation-submission',
      subjectId: created.id,
      actorUserId: submittedBy,
      payload: { ...submitted, scoresSha256: canonicalSha256(scores) },
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

    // The image digest identifies what was submitted, as the predictions hash
    // does in Mode 1. `emit` for the reason given in `submitPredictions`.
    const audited = {
      taskId: task.id,
      taskSlug: task.slug,
      mode: 'CONTAINER' satisfies SubmissionMode,
      methodName: body.methodName,
      routeId: null,
      routeVersion: null,
      imageDigest: body.imageDigest,
    };
    await this.audit.emit({
      module: 'evaluation',
      action: 'submitted',
      subjectType: 'evaluation-submission',
      subjectId: created.id,
      actorUserId: submittedBy,
      payload: audited,
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
        subgroupScores: null,
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
      // `emitSync`: the failure is in the trail, or the caller is told of the
      // error rather than of a recorded failure.
      await this.audit.emitSync({
        module: 'evaluation',
        action: 'failed',
        subjectType: 'evaluation-submission',
        subjectId: created.id,
        actorUserId: submittedBy,
        payload: { ...audited, failureCode: 'INTERNAL_ERROR' satisfies SealedRunFailureCode },
      });
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
      taskKind: task.taskKind,
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

  /**
   * `user` is the host or admin the controller let through, recorded as the
   * actor of `evaluation.task.created`.
   */
  async createTask(
    body: CreateEvaluationTaskRequest,
    user?: CognitoAccessTokenPayload,
  ): Promise<EvaluationTaskSummary> {
    let created: { id: string; slug: string };
    try {
      created = await this.repo.createTask({
        slug: body.slug,
        name: body.name,
        datasetSlug: body.datasetSlug,
        taskKind: body.taskKind,
        numClasses: body.numClasses,
        referableThreshold: body.referableThreshold,
        // The request schema requires it for BINARY_DIAGNOSTIC and refuses it
        // for every other kind, so this is null exactly when it does not apply.
        positiveClassName: body.positiveClassName ?? null,
        groundTruth: body.groundTruth,
        // Validated against the answer key by the request schema (#410).
        subgroups: body.subgroups ?? null,
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException(`slug "${body.slug}" is already taken`);
      }
      throw err;
    }

    // `emitSync`, outside the try so an audit failure is not read as a slug
    // conflict. The answer key is recorded by its hash only; the subgroup
    // declaration by its field keys, and not the map of which item has which
    // value, which is held like the answer key. Every kind has a class count
    // and a threshold (the request schema defaults both and the columns are
    // NOT NULL); `positiveClassName` is null except for BINARY_DIAGNOSTIC.
    await this.audit.emitSync({
      module: 'evaluation',
      action: 'task.created',
      subjectType: 'evaluation-task',
      subjectId: created.id,
      actorUserId: user?.sub ? cognitoSubAsUuid(user.sub) : null,
      payload: taskCreatedPayload(created.slug, body),
    });

    return {
      id: created.id,
      slug: created.slug,
      name: body.name,
      datasetSlug: body.datasetSlug,
      taskKind: body.taskKind,
      submissionCount: 0,
    };
  }

  /**
   * Persist a FAILED submission and throw a 400 carrying the same reason.
   * Never returns normally — the `Promise<never>`-flavoured return type lets
   * callers write `return await this.failSubmission(...)`.
   */
  private async failSubmission(
    task: { taskId: string; taskSlug: string; predictionsSha256: string },
    methodName: string,
    submittedBy: string | null,
    reason: string,
  ): Promise<never> {
    const created = await this.repo.createSubmission({
      taskId: task.taskId,
      methodName,
      submittedBy,
      status: 'FAILED' satisfies SubmissionStatus,
      scores: null,
      error: reason,
    });
    // `emitSync`, so a refused file is always in the trail: if the event
    // cannot be written the caller gets the error, not a 400. The reason is
    // left out: it can quote a predicted label. It stays on the row, which
    // the submitter reads. No `submitted` event precedes this one: the file
    // was refused on its format, before it was accepted for scoring.
    await this.audit.emitSync({
      module: 'evaluation',
      action: 'failed',
      subjectType: 'evaluation-submission',
      subjectId: created.id,
      actorUserId: submittedBy,
      payload: {
        taskId: task.taskId,
        taskSlug: task.taskSlug,
        mode: 'PREDICTIONS' satisfies SubmissionMode,
        methodName,
        routeId: null,
        routeVersion: null,
        routeVersionId: null,
        failureCode: null,
        predictionsSha256: task.predictionsSha256,
      },
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
    const now = new Date();
    const { totalUsed, weekUsed } = await this.readQuotaUsage(taskId, submittedBy, now);
    if (totalUsed >= this.quotaLimits.perTask) {
      throw new ForbiddenException({
        message: totalQuotaExceededMessage(taskSlug, this.quotaLimits.perTask),
        quota: quotaState('TASK_TOTAL', totalUsed, null, this.quotaLimits),
      });
    }
    if (weekUsed >= this.quotaLimits.perWeek) {
      const resetsAt = nextQuotaWeekStart(now);
      throw new ForbiddenException({
        message: weeklyQuotaExceededMessage(taskSlug, resetsAt, this.quotaLimits.perWeek),
        quota: quotaState('WEEK', weekUsed, resetsAt, this.quotaLimits),
      });
    }
  }

  /**
   * One participant's usage on one task: over the task's lifetime and inside
   * the calendar week containing `now`. The only place usage is counted — the
   * gate and the quota read both go through it.
   */
  private async readQuotaUsage(
    taskId: string,
    submittedBy: string,
    now: Date,
  ): Promise<{ totalUsed: number; weekUsed: number }> {
    const [totalUsed, weekUsed] = await Promise.all([
      this.repo.countScoredSubmissionsForParticipant({ taskId, submittedBy }),
      this.repo.countScoredSubmissionsForParticipant({
        taskId,
        submittedBy,
        since: quotaWeekStart(now),
      }),
    ]);
    return { totalUsed, weekUsed };
  }
}

/**
 * Whether the caller is in the `admin` group — the operator override, as in
 * `RolesGuard`. Read from the verified token's claim, never from the request.
 */
function isAdministrator(user?: CognitoAccessTokenPayload): boolean {
  const groups: unknown = user?.['cognito:groups'];
  return Array.isArray(groups) && groups.includes('admin');
}

/**
 * Payload of `evaluation.task.created`. Ids, the declaration and hashes: the
 * answer key and the item-to-subgroup map never appear in it.
 */
function taskCreatedPayload(
  slug: string,
  body: CreateEvaluationTaskRequest,
): Record<string, unknown> {
  return {
    slug,
    datasetSlug: body.datasetSlug,
    taskKind: body.taskKind,
    numClasses: body.numClasses,
    referableThreshold: body.referableThreshold,
    positiveClassName: body.positiveClassName ?? null,
    itemCount: Object.keys(body.groundTruth).length,
    subgroupFields: (body.subgroups?.fields ?? []).map((f) => f.key),
    groundTruthSha256: canonicalSha256(body.groundTruth),
  };
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

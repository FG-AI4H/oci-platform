import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { annotatorVsGold } from '@oci/annotation-quality';
import type { AnnotationGateState, AnnotationTask, AnnotationTaskAssignment } from '@oci/database';
import type {
  AnnotatorQualitySummary,
  AssignmentSummary,
  CampaignCompletenessMode,
  CampaignQualityConfig,
  CampaignTaskKind,
  GateTransitionAction,
  PullNextResponse,
  ReleaseAssignmentResponse,
  SeedTaskItem,
  SeedTasksFromDatasetResponse,
  SeedTasksResponse,
  SubmitAssignmentResponse,
  TaskSummary,
} from '@oci/shared-types';
import { evaluateCompleteness, fileSampleRef, labelSubmissionProblems } from '@oci/shared-types';
// ANNOTATION_GATE_ROLES is the canonical gate → group mapping shared
// with the web; `roleForGate` is the local typed accessor.
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { DicomSeriesService } from '../storage/dicom-series.service.js';
import { CampaignRepository } from './campaign.repository.js';
import { readClassificationLabels } from './campaign.service.js';
import { evaluateGate1Predicate } from './gate-irr-predicate.js';
import { lookupGateTransition } from './gate-state-machine.js';
import {
  HOUR_MS,
  readTaskTimeoutHours,
  TaskAbandonmentService,
} from './task-abandonment.service.js';
import { TaskRepository } from './task.repository.js';

/**
 * Slice-2 task workflow service for #215.
 *
 * Owns three flows:
 *   - seed   — campaign-manager creates tasks from a list of sample refs
 *   - next   — annotator pulls the next eligible task (creates an
 *              assignment row if one isn't already in flight)
 *   - submit — annotator persists a submission; gate advances per the
 *              state machine when the gate's required submission count
 *              is met
 *
 * Routing follows ADR-0009 Decision 1 slice-2 cut: role-Visa scope
 * (predicate 1, mapped to Cognito groups today per ADR-0006 Decision
 * 2's "behind-the-Cognito-seam" plan) + FIFO tiebreaker (predicate 6).
 * Predicates 2–5 (capability, experience, bias, stratification) and
 * the calibration loop are slice 3+.
 */
@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    @Inject(CampaignRepository) private readonly campaigns: CampaignRepository,
    @Inject(TaskRepository) private readonly tasks: TaskRepository,
    @Inject(TaskAbandonmentService) private readonly abandonment: TaskAbandonmentService,
    @Inject(DicomSeriesService)
    private readonly dicomSeries: Pick<DicomSeriesService, 'listTaskSamples'>,
  ) {}

  // --- Seed --------------------------------------------------------------

  async seed(args: {
    slug: string;
    sampleRefs: readonly SeedTaskItem[];
  }): Promise<SeedTasksResponse> {
    const campaign = await this.campaigns.findBySlug(args.slug);
    if (!campaign) throw new NotFoundException(`Campaign '${args.slug}' not found`);
    assertCanSeed(campaign.status);

    // Normalise the union shape: a string ref is implicitly a non-gold
    // sample. Gold rows MUST carry a label — the supervisor IRR-vs-
    // gold computation has nothing to compare against otherwise.
    const items = args.sampleRefs.map((raw, i) => {
      if (typeof raw === 'string') return { sampleRef: raw, isGoldStandard: false };
      if (raw.isGoldStandard && !raw.goldStandardLabel) {
        throw new BadRequestException(
          `sampleRefs[${i}]: gold-standard rows must include a goldStandardLabel`,
        );
      }
      return {
        sampleRef: raw.sampleRef,
        isGoldStandard: raw.isGoldStandard,
        ...(raw.goldStandardLabel ? { goldStandardLabel: raw.goldStandardLabel } : {}),
      };
    });

    const n = this.requireNAnnotators(campaign.workflowConfig);
    const result = await this.tasks.seedTasks(campaign.id, n, items);
    const goldCount = items.filter((i) => i.isGoldStandard).length;
    this.logger.log(
      `seed: campaign=${campaign.slug} created=${result.created} skipped=${result.skipped} n=${n} gold=${goldCount}`,
    );
    return result;
  }

  /**
   * One task per platform-hosted PNG / JPEG file, and one per DICOM
   * series (#674), of the campaign's pinned dataset version (#646).
   *
   * The sample reference is a typed platform id, `file:<distribution
   * id>` or `dicom-series:<series id>`, never the storage key: it goes
   * into the audit trail and exports, and a key carries the file name.
   * A series with a held image (ADR-0026) is not made into a task and
   * is counted as `held`: a held file never reaches a reader.
   *
   * Idempotent: a sample that already has a task is `skipped`. `prefix`
   * matches image file names and leaves series out; `limit` takes the
   * first samples, image files in key order, then series. A dry run
   * reports the counts and creates nothing, for the manager's
   * confirmation step.
   */
  async seedFromDataset(args: {
    slug: string;
    prefix?: string;
    limit?: number;
    dryRun: boolean;
  }): Promise<SeedTasksFromDatasetResponse> {
    const campaign = await this.campaigns.findBySlug(args.slug);
    if (!campaign) throw new NotFoundException(`Campaign '${args.slug}' not found`);
    assertCanSeed(campaign.status);
    if (!campaign.manifestVersionId) {
      throw new ConflictException(
        'The campaign has no pinned dataset version, so there are no files to create tasks from',
      );
    }

    const prefix = args.prefix?.trim() ?? '';
    const [images, series] = await Promise.all([
      this.campaigns.findHostedImages(campaign.manifestVersionId),
      prefix ? Promise.resolve([]) : this.dicomSeries.listTaskSamples(campaign.manifestVersionId),
    ]);
    const imageRefs = images
      .filter((f) => fileNameOf(f.s3Key).startsWith(prefix))
      .map((f) => fileSampleRef(f.id));
    const seriesRefs = series.filter((c) => c.heldImageCount === 0).map((c) => c.sampleRef);
    const held = series.length - seriesRefs.length;
    const all = [...imageRefs, ...seriesRefs];
    const refs = args.limit !== undefined ? all.slice(0, args.limit) : all;

    if (args.dryRun) {
      const existing = await this.tasks.countExistingSampleRefs(campaign.id, refs);
      return {
        matched: refs.length,
        created: refs.length - existing,
        skipped: existing,
        held,
        dryRun: true,
      };
    }
    if (refs.length === 0) return { matched: 0, created: 0, skipped: 0, held, dryRun: false };

    const n = this.requireNAnnotators(campaign.workflowConfig);
    const result = await this.tasks.seedTasks(
      campaign.id,
      n,
      refs.map((sampleRef) => ({ sampleRef })),
    );
    this.logger.log(
      `seed-from-dataset: campaign=${campaign.slug} matched=${refs.length} created=${result.created} skipped=${result.skipped} held=${held}`,
    );
    return { matched: refs.length, ...result, held, dryRun: false };
  }

  /**
   * Supervisor read of an annotator's IRR-vs-gold score for a
   * campaign (#291, ADR-0009 Decision 4). Used by the supervisor
   * inbox to decide which annotators are `calibrated` /
   * `uncalibrated` / `flagged` per the calibration-state model. The
   * auto-transition logic itself is the slice-3 follow-up (#292).
   */
  async annotatorQuality(args: {
    slug: string;
    annotatorUserId: string;
  }): Promise<AnnotatorQualitySummary> {
    const campaign = await this.campaigns.findBySlug(args.slug);
    if (!campaign) throw new NotFoundException(`Campaign '${args.slug}' not found`);

    const quality = readQualityConfig(campaign.workflowConfig);
    const [pairs, goldTotal] = await Promise.all([
      this.tasks.annotatorGoldPairs({
        campaignId: campaign.id,
        annotatorUserId: args.annotatorUserId,
      }),
      this.tasks.countGoldSamplesInCampaign(campaign.id),
    ]);
    const scored = annotatorVsGold({ metric: quality.metric, pairs });
    return {
      annotatorUserId: args.annotatorUserId,
      goldSamplesScored: scored.scored,
      goldSamplesTotal: goldTotal,
      irrAgainstGold: scored.score,
      metric: quality.metric,
      threshold: quality.threshold,
    };
  }

  async listForCampaign(slug: string): Promise<TaskSummary[]> {
    const campaign = await this.campaigns.findBySlug(slug);
    if (!campaign) throw new NotFoundException(`Campaign '${slug}' not found`);
    const [rows, submittedByKey] = await Promise.all([
      this.tasks.listTasksForCampaign(campaign.id),
      this.tasks.submittedCountsForCampaign(campaign.id),
    ]);
    return rows.map((row) => {
      const key = `${row.id}|${row.gateState}`;
      const submittedCount = submittedByKey.get(key) ?? 0;
      return toTaskSummary(row, submittedCount);
    });
  }

  // --- Current (read-only) ----------------------------------------------

  /**
   * The caller's in-flight assignment for this campaign at their gate,
   * or null. Reserves nothing: the annotate page reads this on open and
   * only "Start" pulls a task (#646), so visiting the page doesn't hold
   * a slot other annotators could be reading.
   */
  async current(args: {
    slug: string;
    user: CognitoAccessTokenPayload;
    userGroups: readonly string[];
  }): Promise<PullNextResponse> {
    const campaign = await this.campaigns.findBySlug(args.slug);
    if (!campaign) throw new NotFoundException(`Campaign '${args.slug}' not found`);
    const gate = this.gateFromGroups(args.userGroups);
    if (!gate) {
      throw new ForbiddenException(
        'Caller has no annotation role group (annotator / arbitration-annotator / expert-reviewer)',
      );
    }
    const existing = await this.tasks.findActiveAssignmentForUser({
      campaignId: campaign.id,
      gate,
      assigneeUserId: cognitoSubAsUuid(args.user.sub),
    });
    return { assignment: existing ? toAssignmentSummary(existing, existing.task) : null };
  }

  // --- Next (router) -----------------------------------------------------

  /**
   * Returns the caller's active assignment if one's already in flight
   * for this campaign + the caller's eligible gate. Otherwise picks
   * the FIFO-earliest eligible task and creates a new PENDING
   * assignment. Returns `{ assignment: null }` when nothing is
   * available — the UI shows the "all caught up" empty state.
   */
  async pullNext(args: {
    slug: string;
    user: CognitoAccessTokenPayload;
    userGroups: readonly string[];
  }): Promise<PullNextResponse> {
    const campaign = await this.campaigns.findBySlug(args.slug);
    if (!campaign) throw new NotFoundException(`Campaign '${args.slug}' not found`);
    if (campaign.status !== 'RUNNING') {
      throw new ConflictException(
        `Cannot pull tasks from a ${campaign.status} campaign — only RUNNING campaigns serve work`,
      );
    }

    const gate = this.gateFromGroups(args.userGroups);
    if (!gate) {
      throw new ForbiddenException(
        'Caller has no annotation role group (annotator / arbitration-annotator / expert-reviewer)',
      );
    }
    const assigneeRole = roleForGate(gate);
    const assigneeUserId = cognitoSubAsUuid(args.user.sub);

    const timeoutHours = readTaskTimeoutHours(campaign.workflowConfig);
    const nowMs = Date.now();
    const staleBefore = nowMs - timeoutHours * HOUR_MS;

    // Re-issue an in-flight assignment if one exists. Returns the same
    // row idempotently so a reload of the annotator UI doesn't start
    // counting double work, and does it without the expiry scan or a
    // transaction. An assignment past the time limit is not re-issued:
    // the expiry below releases it and the caller gets a fresh one.
    const activeArgs = { campaignId: campaign.id, gate, assigneeUserId };
    const inFlight = await this.tasks.findActiveAssignmentForUser(activeArgs);
    if (inFlight && inFlight.assignedAt.getTime() >= staleBefore) {
      return { assignment: toAssignmentSummary(inFlight, inFlight.task) };
    }

    // The caller needs a new task, so free abandoned slots first
    // (#647). Doing it here, rather than only in the BullMQ sweep,
    // works on environments that run without Redis. Each expiry is
    // its own short transaction (it holds the audit chain lock), kept
    // out of the pull transaction below (#669 review).
    await this.abandonment.expireStaleForCampaign({ campaign, nowMs });

    // The cap check, the pick and the new assignment share one
    // transaction, behind the campaign's pull lock: readers who press
    // Start together are served one after another, so each counts the
    // slots the previous one left and a task never gets more readers
    // than it needs (#646 review, item 1).
    return this.tasks.inTransaction(async (tasks) => {
      await tasks.lockCampaignPulls(campaign.id);
      // A concurrent pull by the same caller may have assigned since
      // the check above.
      const existing = await tasks.findActiveAssignmentForUser(activeArgs);
      if (existing) {
        return { assignment: toAssignmentSummary(existing, existing.task) };
      }

      // Bias-prevention 1.5× cap (ADR-0009 Decision 1 Predicate 4).
      // The router refuses to give this caller another independent
      // reading if doing so would push their per-campaign share above
      // the soft ceiling. EXPIRED and RELEASED rows are excluded
      // (abandonment and skips don't burden the cap per ADR-0009 + #229). When the cap
      // binds the task stays in the queue for another annotator. The
      // cap shares out independent readings only; arbitration and
      // expert review are single-reader gates it doesn't govern.
      // Annotators with no activity in the last
      // ACTIVE_WINDOW_TIMEOUTS × taskTimeoutHours have left the
      // campaign and no longer share the work.
      if (
        gate === 'INDEPENDENT' &&
        !this.callerWithinBiasCap(
          await tasks.biasCapInputs({
            campaignId: campaign.id,
            callerUserId: assigneeUserId,
            activeSince: new Date(nowMs - ACTIVE_WINDOW_TIMEOUTS * timeoutHours * HOUR_MS),
          }),
        )
      ) {
        this.logger.log(
          `pullNext: caller ${assigneeUserId} at the bias-prevention cap in campaign ${campaign.slug} — returning null`,
        );
        return { assignment: null };
      }

      const nextTask = await tasks.findNextEligibleTask({
        campaignId: campaign.id,
        gate,
        assigneeUserId,
      });
      if (!nextTask) return { assignment: null };

      const assignment = await tasks.createAssignment({
        taskId: nextTask.id,
        assigneeUserId,
        assigneeRole,
        gateAtAssignment: gate,
      });
      this.logger.log(
        `pullNext: campaign=${campaign.slug} task=${nextTask.id} gate=${gate} assignee=${assigneeUserId}`,
      );
      return { assignment: toAssignmentSummary(assignment, nextTask) };
    });
  }

  // --- Release (skip) ----------------------------------------------------

  /**
   * The assignee gives the task back unread (#646). The slot reopens
   * at once for other annotators, and the router offers the caller
   * other tasks before this one. Only the assignee may release, and
   * only an assignment still in flight.
   */
  async release(args: {
    assignmentId: string;
    user: CognitoAccessTokenPayload;
  }): Promise<ReleaseAssignmentResponse> {
    const callerUserId = cognitoSubAsUuid(args.user.sub);
    return this.tasks.inTransaction(async (tasks, tx) => {
      const assignment = await tasks.findAssignmentById(args.assignmentId);
      if (!assignment) throw new NotFoundException(`Assignment '${args.assignmentId}' not found`);
      if (assignment.assigneeUserId !== callerUserId) {
        throw new ForbiddenException('Assignment belongs to a different user');
      }
      if (assignment.status !== 'PENDING' && assignment.status !== 'IN_PROGRESS') {
        throw new ConflictException(
          `Assignment is ${assignment.status}; only an assignment in progress can be released`,
        );
      }
      const campaign = await this.campaigns.findById(assignment.task.campaignId);
      const released = await this.abandonment.release({
        row: assignment,
        campaignSlug: campaign?.slug ?? 'unknown',
        tasks,
        tx,
      });
      if (!released) {
        throw new ConflictException('Assignment was submitted or expired while being released');
      }
      return {
        assignmentId: assignment.id,
        taskId: assignment.taskId,
        releasedAt: new Date().toISOString(),
      };
    });
  }

  // --- Submit ------------------------------------------------------------

  async submit(args: {
    assignmentId: string;
    submission: Record<string, unknown>;
    acknowledgedInstructionsVersion?: string | null;
    user: CognitoAccessTokenPayload;
  }): Promise<SubmitAssignmentResponse> {
    const assignment = await this.tasks.findAssignmentById(args.assignmentId);
    if (!assignment) throw new NotFoundException(`Assignment '${args.assignmentId}' not found`);

    const callerUserId = cognitoSubAsUuid(args.user.sub);
    if (assignment.assigneeUserId !== callerUserId) {
      throw new ForbiddenException('Assignment belongs to a different user');
    }
    if (assignment.status === 'SUBMITTED') {
      throw new ConflictException('Assignment is already submitted; resubmission is not allowed');
    }
    if (assignment.status === 'EXPIRED') {
      throw new ConflictException('Assignment expired due to abandonment timeout; pull a new task');
    }
    if (assignment.status === 'RELEASED') {
      throw new ConflictException('Assignment was released; pull a new task');
    }
    if (assignment.gateAtAssignment !== assignment.task.gateState) {
      // Task moved on while the caller was working. Slice 2 surfaces
      // a 409; slice 3 may auto-rollover with a notification.
      // The text names no step: telling a reader where the task went
      // would say whether the others agreed (#646 review).
      throw new ConflictException('This task no longer needs your answer; pull a new task');
    }
    if (assignment.task.gateState === 'COMPLETED' || assignment.task.gateState === 'SKIPPED') {
      throw new ConflictException(`Task is ${assignment.task.gateState}; submissions closed`);
    }
    // The router never gives an arbiter a task they read (#646); this
    // holds the line for an assignment made before that rule.
    if (
      assignment.task.gateState === 'AWAITING_ARBITRATION' &&
      (await this.tasks.hasReadTask(assignment.task.id, callerUserId))
    ) {
      throw new ForbiddenException('An arbiter cannot settle a task they read');
    }

    // Completeness check (#231). Read the parent campaign once for
    // `taskKind` + `completenessMode`; the predicate is pure and
    // shared with the annotator UI. On `hard-block` campaigns a
    // semantically-incomplete payload throws 422; on `soft-warn`
    // we log a warning + carry on so the supervisor inbox can
    // surface the row for review (the soft-warn surface comes
    // with the supervisor PR in #233).
    const campaignForSubmit = await this.campaigns.findById(assignment.task.campaignId);

    // Instructions acknowledgement (#230). When the campaign has a
    // published instructions version, the submission must carry the
    // matching `acknowledgedInstructionsVersion` so the annotator
    // can't slip past an updated version. Captured into the
    // assignment row for provenance.
    const requiredInstructionsVersion = campaignForSubmit?.currentInstructionsVersion ?? null;
    if (requiredInstructionsVersion !== null) {
      const ack = args.acknowledgedInstructionsVersion ?? null;
      if (ack !== requiredInstructionsVersion) {
        throw new ConflictException({
          message:
            'Submission must acknowledge the current instructions version before it can be persisted',
          requiredInstructionsVersion,
          acknowledgedInstructionsVersion: ack,
          campaignSlug: campaignForSubmit?.slug ?? null,
        });
      }
    }
    // A campaign with declared labels takes only `{ label, comment }`
    // with one of them (#646), at every gate. The arbiter also gives
    // the reason for the final label, stored with it as `reason`.
    const labels =
      campaignForSubmit?.taskKind === 'CLASSIFICATION'
        ? readClassificationLabels(campaignForSubmit.workflowConfig)
        : null;
    if (labels) {
      const problems = labelSubmissionProblems(labels, args.submission, {
        reasonRequired: assignment.task.gateState === 'AWAITING_ARBITRATION',
      });
      if (problems.length > 0) {
        throw new UnprocessableEntityException({
          message: 'Submission does not match the campaign labels',
          reasons: problems,
          campaignSlug: campaignForSubmit?.slug ?? null,
        });
      }
    }
    const completenessMode = readCompletenessMode(campaignForSubmit?.workflowConfig);
    const completeness = evaluateCompleteness(
      (campaignForSubmit?.taskKind ?? 'CLASSIFICATION') as CampaignTaskKind,
      args.submission,
    );
    if (!completeness.complete) {
      if (completenessMode === 'hard-block') {
        throw new UnprocessableEntityException({
          message: 'Submission is incomplete and the campaign requires hard-block validation',
          reasons: completeness.reasons,
          campaignSlug: campaignForSubmit?.slug ?? null,
          taskId: assignment.task.id,
        });
      }
      this.logger.warn(
        `submit: incomplete payload (soft-warn) task=${assignment.task.id} reasons=${completeness.reasons.join('; ')}`,
      );
    }

    const record = async (
      tasks: TaskRepository,
      singleAnswer: boolean,
    ): Promise<SubmitAssignmentResponse> => {
      const submitted = await tasks.markAssignmentSubmitted({
        assignmentId: assignment.id,
        submission: args.submission,
        acknowledgedInstructionsVersion: args.acknowledgedInstructionsVersion ?? null,
      });
      if (!submitted) {
        // Another pull expired the assignment, or a parallel submit
        // landed, after the status checks above (#669 review).
        throw new ConflictException(
          'Assignment is no longer open (it expired or was already submitted); pull a new task',
        );
      }

      const submittedCount = await tasks.countSubmittedAssignmentsAtGate(
        assignment.task.id,
        assignment.task.gateState,
      );

      const action = gateActionForSubmittedRole(assignment.assigneeRole);
      if (!action) {
        // Submission persisted, but the role doesn't correspond to a
        // gate-advancing action. This shouldn't happen in slice 2 (the
        // three known roles all map to actions); log and exit
        // gracefully so the assignment row is still saved.
        this.logger.warn(
          `submit: assignee role '${assignment.assigneeRole}' has no gate action mapping`,
        );
        return {
          assignmentId: assignment.id,
          taskId: assignment.task.id,
          newGateState: null,
        };
      }

      // INDEPENDENT gate needs N submissions before advancing; the
      // other gates advance on the single submission (per ADR-0008
      // §gate-1/2/3 semantics and the state machine table).
      if (
        assignment.task.gateState === 'INDEPENDENT' &&
        submittedCount < assignment.task.nAnnotatorsRequired
      ) {
        return {
          assignmentId: assignment.id,
          taskId: assignment.task.id,
          newGateState: null,
        };
      }

      // Slice-3 decision-box predicate (#215, ADR-0008): when the
      // N-th independent submission lands AND N ≥ 2, compute IRR
      // across all N submissions. If raters agreed above the
      // campaign's threshold, route INDEPENDENT → COMPLETED instead
      // of AWAITING_ARBITRATION.
      let irrPassed = false;
      if (
        assignment.task.gateState === 'INDEPENDENT' &&
        assignment.task.nAnnotatorsRequired >= 2 &&
        action === 'independent-submitted'
      ) {
        // Re-use the campaign row read above for completeness; both
        // paths need the same parent campaign + workflowConfig.
        const campaign = campaignForSubmit;
        const quality = readQualityConfig(campaign?.workflowConfig);
        const taskKind = (campaign?.taskKind ?? 'CLASSIFICATION') as CampaignTaskKind;
        const submissions = await tasks.submissionPayloadsAtGate(assignment.task.id, 'INDEPENDENT');
        const result = evaluateGate1Predicate({ taskKind, quality, submissions });
        irrPassed = result.passed;
        this.logger.log(
          `gate-1 decision: task=${assignment.task.id} ${result.reason} ` +
            `(irr=${result.irr ?? 'n/a'}, metric=${result.metricApplied ?? 'n/a'}, threshold=${result.threshold})`,
        );
      }

      const rule = lookupGateTransition(
        assignment.task.gateState,
        action,
        assignment.task.nAnnotatorsRequired,
        { irrPassed },
      );
      if (!rule) {
        this.logger.warn(
          `submit: no transition rule for gate=${assignment.task.gateState} action=${action}`,
        );
        return {
          assignmentId: assignment.id,
          taskId: assignment.task.id,
          newGateState: null,
        };
      }

      const moved = await tasks.updateGateState({
        taskId: assignment.task.id,
        expectedFrom: assignment.task.gateState,
        to: rule.to,
        ...(rule.stampCompletedAt ? { stampCompletedAt: true } : {}),
      });
      if (!moved && singleAnswer) {
        // Another arbiter (or expert) settled the task first. Throwing
        // rolls this answer back, so the task keeps one final label.
        throw new ConflictException(
          'This task was settled by someone else while you worked on it; pull a new task',
        );
      }
      this.logger.log(
        `submit: campaign-scoped task=${assignment.task.id} ${assignment.task.gateState}→${rule.to}`,
      );
      return {
        assignmentId: assignment.id,
        taskId: assignment.task.id,
        newGateState: rule.to,
      };
    };

    // Arbitration and expert review take one answer. Recording it and
    // moving the task share a transaction: if another arbiter settled
    // the task first, the gate update finds nothing to move and this
    // answer is rolled back with a 409, so a task never carries two
    // final labels (#646 review, item 2). Independent readings stay
    // outside a transaction: each is committed before it counts the
    // others, so of two last readers at least one sees both.
    if (assignment.task.gateState !== 'INDEPENDENT') {
      return this.tasks.inTransaction((tasks) => record(tasks, true));
    }
    return record(this.tasks, false);
  }

  // --- Helpers -----------------------------------------------------------

  private requireNAnnotators(workflowConfig: unknown): number {
    if (
      workflowConfig &&
      typeof workflowConfig === 'object' &&
      'nAnnotators' in workflowConfig &&
      typeof (workflowConfig as { nAnnotators: unknown }).nAnnotators === 'number'
    ) {
      const n = (workflowConfig as { nAnnotators: number }).nAnnotators;
      if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
    }
    throw new BadRequestException(
      'Campaign workflowConfig.nAnnotators is missing or out of bounds [1, 12]',
    );
  }

  /**
   * Map the caller's Cognito groups to the earliest-eligible gate.
   * A caller with multiple roles (e.g. an arbitration-annotator who
   * is also a regular annotator) receives the INDEPENDENT-gate task
   * first, preserving the SOP ordering. Slice 3 may make this
   * configurable per campaign (a campaign manager might want their
   * expert-reviewer to drain arbitration backlog before gate-1).
   */
  /**
   * Bias-prevention soft ceiling per ADR-0009 Decision 1
   * Predicate 4:
   *
   *   cap = ceil(totalSlots / max(1, nActiveAnnotators)) * 1.5
   *
   * `totalSlots` counts independent readings (tasks × readers per
   * task), so with N readers per task the annotators can between them
   * reach every reading the campaign needs (#647).
   *
   * Returns false when assigning the next task to this caller would
   * push their share past the cap; the router then refuses + the
   * task waits for another annotator. The "max(1, n)" guard handles
   * the first-ever pull-next on a fresh campaign (no rows yet → no
   * cap can possibly bind).
   */
  private callerWithinBiasCap(inputs: {
    totalSlots: number;
    nActiveAnnotators: number;
    callerShare: number;
  }): boolean {
    const n = Math.max(1, inputs.nActiveAnnotators);
    const cap = Math.ceil(inputs.totalSlots / n) * 1.5;
    return inputs.callerShare + 1 <= cap;
  }

  private gateFromGroups(groups: readonly string[]): AnnotationGateState | null {
    if (groups.includes('annotator')) return 'INDEPENDENT';
    if (groups.includes('arbitration-annotator')) return 'AWAITING_ARBITRATION';
    if (groups.includes('expert-reviewer')) return 'AWAITING_EXPERT';
    return null;
  }
}

/**
 * How long, in multiples of the campaign's `taskTimeoutHours`, an
 * annotator with no new assignment and no submission still counts as
 * sharing the campaign's readings for the bias cap. With the 24 h
 * default an annotator gone for two days stops holding others back.
 */
const ACTIVE_WINDOW_TIMEOUTS = 2;

/**
 * Tasks are seeded once the campaign is past DRAFT. Allowing seed at
 * READY lets a manager pre-load work before calling `start`; seeding
 * at DRAFT would risk losing the tasks if the manager reverts.
 */
function assertCanSeed(status: string): void {
  if (status === 'DRAFT' || status === 'ARCHIVED') {
    throw new ConflictException(
      `Cannot seed tasks while campaign is ${status}; transition to READY or RUNNING first`,
    );
  }
  if (status === 'COMPLETED') {
    throw new ConflictException('Cannot seed tasks on a COMPLETED campaign');
  }
}

/** The file name at the end of a storage key. */
function fileNameOf(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1);
}

function gateActionForSubmittedRole(role: string): GateTransitionAction | null {
  if (role === 'annotator') return 'independent-submitted';
  if (role === 'arbitration-annotator') return 'arbitration-submitted';
  if (role === 'expert-reviewer') return 'expert-submitted';
  return null;
}

/**
 * Read the campaign's quality config from its JSONB `workflowConfig`,
 * filling in `CampaignQualityConfigSchema` defaults when the field
 * is missing (every pre-#216 campaign row). Tolerant of partial
 * objects — partial values fall back to defaults individually.
 */
function readQualityConfig(workflowConfig: unknown): CampaignQualityConfig {
  const raw =
    workflowConfig && typeof workflowConfig === 'object'
      ? ((workflowConfig as { qualityConfig?: unknown }).qualityConfig ?? {})
      : {};
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const metric = obj.metric;
  const threshold = obj.threshold;
  return {
    metric:
      metric === 'cohens-kappa' || metric === 'fleiss-kappa' || metric === 'dice'
        ? metric
        : 'fleiss-kappa',
    threshold: typeof threshold === 'number' && threshold >= 0 && threshold <= 1 ? threshold : 0.6,
  };
}

/**
 * Read the campaign's completeness-enforcement mode from its JSONB
 * `workflowConfig` (#231). Pre-#231 campaign rows are missing the
 * field — fall back to the schema default (`soft-warn`).
 */
function readCompletenessMode(workflowConfig: unknown): CampaignCompletenessMode {
  if (workflowConfig && typeof workflowConfig === 'object') {
    const v = (workflowConfig as { completenessMode?: unknown }).completenessMode;
    if (v === 'soft-warn' || v === 'hard-block') return v;
  }
  return 'soft-warn';
}

function roleForGate(gate: AnnotationGateState): string {
  switch (gate) {
    case 'INDEPENDENT':
      return 'annotator';
    case 'AWAITING_ARBITRATION':
      return 'arbitration-annotator';
    case 'AWAITING_EXPERT':
      return 'expert-reviewer';
    default:
      throw new Error(`No assignment role for terminal gate ${gate}`);
  }
}

function toTaskSummary(row: AnnotationTask, submittedCount: number): TaskSummary {
  return {
    id: row.id,
    campaignId: row.campaignId,
    sampleRef: row.sampleRef,
    isGoldStandard: row.isGoldStandard,
    gateState: row.gateState,
    nAnnotatorsRequired: row.nAnnotatorsRequired,
    submittedCount,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

function toAssignmentSummary(
  row: AnnotationTaskAssignment,
  task: AnnotationTask,
): AssignmentSummary {
  return {
    id: row.id,
    taskId: row.taskId,
    sampleRef: task.sampleRef,
    gateAtAssignment: row.gateAtAssignment,
    assigneeRole: row.assigneeRole,
    status: row.status,
    assignedAt: row.assignedAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
  };
}

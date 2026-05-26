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
  SeedTaskItem,
  SeedTasksResponse,
  SubmitAssignmentResponse,
  TaskSummary,
} from '@oci/shared-types';
import { evaluateCompleteness } from '@oci/shared-types';
// ANNOTATION_GATE_ROLES is the canonical gate → group mapping shared
// with the web; `roleForGate` is the local typed accessor.
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { CampaignRepository } from './campaign.repository.js';
import { evaluateGate1Predicate } from './gate-irr-predicate.js';
import { lookupGateTransition } from './gate-state-machine.js';
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
  ) {}

  // --- Seed --------------------------------------------------------------

  async seed(args: {
    slug: string;
    sampleRefs: readonly SeedTaskItem[];
  }): Promise<SeedTasksResponse> {
    const campaign = await this.campaigns.findBySlug(args.slug);
    if (!campaign) throw new NotFoundException(`Campaign '${args.slug}' not found`);

    // Tasks can only be seeded once the campaign is past DRAFT.
    // Allowing seed at READY lets a manager pre-load work before
    // calling `start`; seeding at DRAFT would risk losing the tasks
    // if the manager reverts.
    if (campaign.status === 'DRAFT' || campaign.status === 'ARCHIVED') {
      throw new ConflictException(
        `Cannot seed tasks while campaign is ${campaign.status}; transition to READY or RUNNING first`,
      );
    }
    if (campaign.status === 'COMPLETED') {
      throw new ConflictException('Cannot seed tasks on a COMPLETED campaign');
    }

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

    // Re-issue an in-flight assignment if one exists. Returns the
    // same row idempotently so a reload of the annotator UI doesn't
    // start counting double work.
    const existing = await this.tasks.findActiveAssignmentForUser({
      campaignId: campaign.id,
      gate,
      assigneeUserId,
    });
    if (existing) {
      return { assignment: toAssignmentSummary(existing, existing.task) };
    }

    const nextTask = await this.tasks.findNextEligibleTask({
      campaignId: campaign.id,
      gate,
      assigneeUserId,
    });
    if (!nextTask) return { assignment: null };

    const assignment = await this.tasks.createAssignment({
      taskId: nextTask.id,
      assigneeUserId,
      assigneeRole,
      gateAtAssignment: gate,
    });
    this.logger.log(
      `pullNext: campaign=${campaign.slug} task=${nextTask.id} gate=${gate} assignee=${assigneeUserId}`,
    );
    return { assignment: toAssignmentSummary(assignment, nextTask) };
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
    if (assignment.gateAtAssignment !== assignment.task.gateState) {
      // Task moved on while the caller was working. Slice 2 surfaces
      // a 409; slice 3 may auto-rollover with a notification.
      throw new ConflictException(
        `Task gate has advanced (assignment for ${assignment.gateAtAssignment}, task at ${assignment.task.gateState})`,
      );
    }
    if (assignment.task.gateState === 'COMPLETED' || assignment.task.gateState === 'SKIPPED') {
      throw new ConflictException(`Task is ${assignment.task.gateState}; submissions closed`);
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

    await this.tasks.markAssignmentSubmitted({
      assignmentId: assignment.id,
      submission: args.submission,
      acknowledgedInstructionsVersion: args.acknowledgedInstructionsVersion ?? null,
    });

    const submittedCount = await this.tasks.countSubmittedAssignmentsAtGate(
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
      const submissions = await this.tasks.submissionPayloadsAtGate(
        assignment.task.id,
        'INDEPENDENT',
      );
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

    await this.tasks.updateGateState({
      taskId: assignment.task.id,
      expectedFrom: assignment.task.gateState,
      to: rule.to,
      ...(rule.stampCompletedAt ? { stampCompletedAt: true } : {}),
    });
    this.logger.log(
      `submit: campaign-scoped task=${assignment.task.id} ${assignment.task.gateState}→${rule.to}`,
    );
    return {
      assignmentId: assignment.id,
      taskId: assignment.task.id,
      newGateState: rule.to,
    };
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
  private gateFromGroups(groups: readonly string[]): AnnotationGateState | null {
    if (groups.includes('annotator')) return 'INDEPENDENT';
    if (groups.includes('arbitration-annotator')) return 'AWAITING_ARBITRATION';
    if (groups.includes('expert-reviewer')) return 'AWAITING_EXPERT';
    return null;
  }
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

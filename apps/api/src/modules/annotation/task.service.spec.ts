import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  AnnotationCampaign,
  AnnotationGateState,
  AnnotationTask,
  AnnotationTaskAssignment,
  AnnotationToolIntegration,
} from '@oci/database';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { CampaignRepository } from './campaign.repository.js';
import { TaskAbandonmentService } from './task-abandonment.service.js';
import { TaskRepository } from './task.repository.js';
import { TaskService } from './task.service.js';

// --- Fixtures ---------------------------------------------------------------

const ANNOTATOR_SUB = 'annie';
const ARBITER_SUB = 'arbie';
const EXPERT_SUB = 'eddy';
const ANNOTATOR_UUID = cognitoSubAsUuid(ANNOTATOR_SUB);

function userPayload(sub: string): CognitoAccessTokenPayload {
  return { sub } as unknown as CognitoAccessTokenPayload;
}

const TOOL: AnnotationToolIntegration = {
  id: 't-1',
  slug: 'monai-label',
  name: 'MONAI',
  vendor: 'v',
  version: '0.1',
  isActive: true,
  supportedTaskKinds: ['CLASSIFICATION'],
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as AnnotationToolIntegration;

function runningCampaign(
  nAnnotators: number,
): AnnotationCampaign & { toolIntegration: AnnotationToolIntegration } {
  return {
    id: 'cmp-1',
    slug: 'pilot',
    name: 'Pilot',
    description: null,
    status: 'RUNNING',
    taskKind: 'CLASSIFICATION',
    datasetId: 'ds-1',
    toolIntegrationId: TOOL.id,
    outputLicense: 'CC_BY_4_0',
    workflowConfig: { nAnnotators },
    createdById: 'creator',
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
    toolIntegration: TOOL,
  } as unknown as AnnotationCampaign & { toolIntegration: AnnotationToolIntegration };
}

function taskRow(overrides: Partial<AnnotationTask> = {}): AnnotationTask {
  return {
    id: 'task-1',
    campaignId: 'cmp-1',
    sampleRef: 'sample-1',
    nAnnotatorsRequired: 1,
    gateState: 'INDEPENDENT' as AnnotationGateState,
    skipReason: null,
    isGoldStandard: false,
    goldStandardLabel: null,
    createdAt: new Date('2026-05-17T10:00:00Z'),
    updatedAt: new Date('2026-05-17T10:00:00Z'),
    completedAt: null,
    ...overrides,
  } as unknown as AnnotationTask;
}

function assignmentRow(
  overrides: Partial<AnnotationTaskAssignment> = {},
): AnnotationTaskAssignment {
  return {
    id: 'asn-1',
    taskId: 'task-1',
    assigneeUserId: ANNOTATOR_UUID,
    assigneeRole: 'annotator',
    gateAtAssignment: 'INDEPENDENT' as AnnotationGateState,
    status: 'PENDING',
    submission: null,
    assignedAt: new Date('2026-05-17T10:05:00Z'),
    startedAt: null,
    submittedAt: null,
    expiredAt: null,
    ...overrides,
  } as unknown as AnnotationTaskAssignment;
}

// --- Mocks ------------------------------------------------------------------

interface CampaignsMock {
  findBySlug: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
}

interface TasksMock {
  inTransaction: ReturnType<typeof vi.fn>;
  seedTasks: ReturnType<typeof vi.fn>;
  listTasksForCampaign: ReturnType<typeof vi.fn>;
  submittedCountsForCampaign: ReturnType<typeof vi.fn>;
  findActiveAssignmentForUser: ReturnType<typeof vi.fn>;
  findNextEligibleTask: ReturnType<typeof vi.fn>;
  biasCapInputs: ReturnType<typeof vi.fn>;
  createAssignment: ReturnType<typeof vi.fn>;
  findAssignmentById: ReturnType<typeof vi.fn>;
  markAssignmentSubmitted: ReturnType<typeof vi.fn>;
  countSubmittedAssignmentsAtGate: ReturnType<typeof vi.fn>;
  submissionPayloadsAtGate: ReturnType<typeof vi.fn>;
  updateGateState: ReturnType<typeof vi.fn>;
  setAssignmentStatus: ReturnType<typeof vi.fn>;
  findTaskById: ReturnType<typeof vi.fn>;
  annotatorGoldPairs: ReturnType<typeof vi.fn>;
  countGoldSamplesInCampaign: ReturnType<typeof vi.fn>;
}

const TX = { tx: true };

let campaigns: CampaignsMock;
let tasks: TasksMock;
let abandonment: { expireStaleForCampaign: ReturnType<typeof vi.fn> };
let service: TaskService;

beforeEach(() => {
  campaigns = {
    findBySlug: vi.fn(),
    // Default: a campaign with no qualityConfig — so the gate-1
    // predicate uses defaults (fleiss-kappa @ 0.6). The N=3
    // escalation test feeds dissimilar labels so the predicate
    // fails and the original "escalate" assertion still holds.
    findById: vi.fn().mockResolvedValue({
      id: 'cmp-1',
      taskKind: 'CLASSIFICATION',
      workflowConfig: { nAnnotators: 3 },
    }),
  };
  tasks = {
    // Pass-through: the transaction-bound repository is this mock.
    inTransaction: vi.fn((fn: (t: unknown, tx: unknown) => unknown) => fn(tasks, TX)),
    seedTasks: vi.fn(),
    listTasksForCampaign: vi.fn(),
    submittedCountsForCampaign: vi.fn().mockResolvedValue(new Map<string, number>()),
    findActiveAssignmentForUser: vi.fn(),
    findNextEligibleTask: vi.fn(),
    // Default: cap doesn't bind (totalSlots=0 → cap=0 → callerShare+1>0
    // would falsely bind, so seed with totalSlots=1 and callerShare=0
    // → cap=⌈1/1⌉ × 1.5=1.5 → caller's first task slips under).
    biasCapInputs: vi
      .fn()
      .mockResolvedValue({ totalSlots: 1, nActiveAnnotators: 1, callerShare: 0 }),
    createAssignment: vi.fn(),
    findAssignmentById: vi.fn(),
    // True: the conditional update found the row still open.
    markAssignmentSubmitted: vi.fn().mockResolvedValue(true),
    countSubmittedAssignmentsAtGate: vi.fn(),
    // Default: N submissions with DISAGREEING labels so the gate-1
    // predicate fails and the task escalates (preserves the
    // existing escalation test). Individual tests override this
    // to exercise the PASS path.
    submissionPayloadsAtGate: vi
      .fn()
      .mockResolvedValue([{ label: 'a' }, { label: 'b' }, { label: 'c' }]),
    updateGateState: vi.fn(),
    setAssignmentStatus: vi.fn(),
    findTaskById: vi.fn(),
    annotatorGoldPairs: vi.fn().mockResolvedValue([]),
    countGoldSamplesInCampaign: vi.fn().mockResolvedValue(0),
  };
  abandonment = { expireStaleForCampaign: vi.fn().mockResolvedValue(0) };
  service = new TaskService(
    campaigns as unknown as CampaignRepository,
    tasks as unknown as TaskRepository,
    abandonment as unknown as TaskAbandonmentService,
  );
});

// --- Seed -------------------------------------------------------------------

describe('TaskService.seed', () => {
  it('seeds tasks against a RUNNING campaign with the campaign nAnnotators', async () => {
    campaigns.findBySlug.mockResolvedValue(runningCampaign(3));
    tasks.seedTasks.mockResolvedValue({ created: 2, skipped: 0 });

    const result = await service.seed({ slug: 'pilot', sampleRefs: ['a', 'b'] });

    expect(tasks.seedTasks).toHaveBeenCalledWith('cmp-1', 3, [
      { sampleRef: 'a', isGoldStandard: false },
      { sampleRef: 'b', isGoldStandard: false },
    ]);
    expect(result).toEqual({ created: 2, skipped: 0 });
  });

  it('refuses to seed against a DRAFT campaign', async () => {
    const c = runningCampaign(1);
    (c as { status: string }).status = 'DRAFT';
    campaigns.findBySlug.mockResolvedValue(c);

    await expect(service.seed({ slug: 'pilot', sampleRefs: ['a'] })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404s when the campaign does not exist', async () => {
    campaigns.findBySlug.mockResolvedValue(null);
    await expect(service.seed({ slug: 'nope', sampleRefs: ['a'] })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects gold-marked rows that lack a goldStandardLabel (#291)', async () => {
    campaigns.findBySlug.mockResolvedValue(runningCampaign(3));
    await expect(
      service.seed({
        slug: 'pilot',
        sampleRefs: [{ sampleRef: 's-1', isGoldStandard: true }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a mix of regular + gold rows on seed (#291)', async () => {
    campaigns.findBySlug.mockResolvedValue(runningCampaign(3));
    tasks.seedTasks.mockResolvedValue({ created: 2, skipped: 0 });

    await service.seed({
      slug: 'pilot',
      sampleRefs: [
        'plain-ref',
        { sampleRef: 'gold-ref', isGoldStandard: true, goldStandardLabel: { label: 'pneumonia' } },
      ],
    });

    expect(tasks.seedTasks).toHaveBeenCalledWith('cmp-1', 3, [
      { sampleRef: 'plain-ref', isGoldStandard: false },
      {
        sampleRef: 'gold-ref',
        isGoldStandard: true,
        goldStandardLabel: { label: 'pneumonia' },
      },
    ]);
  });
});

// --- annotatorQuality (#291) ------------------------------------------------

describe('TaskService.annotatorQuality', () => {
  it('returns a null score when the annotator has scored no gold samples', async () => {
    campaigns.findBySlug.mockResolvedValue(runningCampaign(3));
    tasks.annotatorGoldPairs.mockResolvedValue([]);
    tasks.countGoldSamplesInCampaign.mockResolvedValue(4);

    const r = await service.annotatorQuality({
      slug: 'pilot',
      annotatorUserId: ANNOTATOR_UUID,
    });

    expect(r.goldSamplesScored).toBe(0);
    expect(r.goldSamplesTotal).toBe(4);
    expect(r.irrAgainstGold).toBeNull();
    expect(r.metric).toBe('fleiss-kappa');
  });

  it('computes IRR-vs-gold for a perfectly-calibrated annotator', async () => {
    campaigns.findBySlug.mockResolvedValue(runningCampaign(3));
    tasks.annotatorGoldPairs.mockResolvedValue([
      { submission: { label: 'a' }, gold: { label: 'a' } },
      { submission: { label: 'b' }, gold: { label: 'b' } },
      { submission: { label: 'a' }, gold: { label: 'a' } },
      { submission: { label: 'b' }, gold: { label: 'b' } },
    ]);
    tasks.countGoldSamplesInCampaign.mockResolvedValue(4);

    const r = await service.annotatorQuality({
      slug: 'pilot',
      annotatorUserId: ANNOTATOR_UUID,
    });

    expect(r.goldSamplesScored).toBe(4);
    expect(r.irrAgainstGold).toBe(1);
  });
});

// --- listForCampaign --------------------------------------------------------

describe('TaskService.listForCampaign', () => {
  it("populates submittedCount per task from the campaign's SUBMITTED rows", async () => {
    const taskA = taskRow({ id: 'task-A', nAnnotatorsRequired: 3, gateState: 'INDEPENDENT' });
    const taskB = taskRow({
      id: 'task-B',
      nAnnotatorsRequired: 3,
      gateState: 'AWAITING_ARBITRATION',
    });
    const taskC = taskRow({ id: 'task-C', nAnnotatorsRequired: 3 });
    campaigns.findBySlug.mockResolvedValue(runningCampaign(3));
    tasks.listTasksForCampaign.mockResolvedValue([taskA, taskB, taskC]);
    tasks.submittedCountsForCampaign.mockResolvedValue(
      new Map([
        ['task-A|INDEPENDENT', 2],
        ['task-A|AWAITING_ARBITRATION', 1], // ignored — task-A is still at INDEPENDENT
        ['task-B|AWAITING_ARBITRATION', 1],
        // task-C has no SUBMITTED rows.
      ]),
    );

    const result = await service.listForCampaign('pilot');

    expect(result.find((t) => t.id === 'task-A')?.submittedCount).toBe(2);
    expect(result.find((t) => t.id === 'task-B')?.submittedCount).toBe(1);
    expect(result.find((t) => t.id === 'task-C')?.submittedCount).toBe(0);
  });
});

// --- pullNext (router) ------------------------------------------------------

describe('TaskService.pullNext', () => {
  beforeEach(() => {
    campaigns.findBySlug.mockResolvedValue(runningCampaign(1));
  });

  it('requires a campaign in RUNNING status', async () => {
    const c = runningCampaign(1);
    (c as { status: string }).status = 'COMPLETED';
    campaigns.findBySlug.mockResolvedValue(c);

    await expect(
      service.pullNext({
        slug: 'pilot',
        user: userPayload(ANNOTATOR_SUB),
        userGroups: ['annotator'],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('403s when the caller has no annotation-role group', async () => {
    await expect(
      service.pullNext({
        slug: 'pilot',
        user: userPayload(ANNOTATOR_SUB),
        userGroups: ['host'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns null assignment when no eligible task exists for the gate', async () => {
    tasks.findActiveAssignmentForUser.mockResolvedValue(null);
    tasks.findNextEligibleTask.mockResolvedValue(null);

    const result = await service.pullNext({
      slug: 'pilot',
      user: userPayload(ANNOTATOR_SUB),
      userGroups: ['annotator'],
    });

    expect(result.assignment).toBeNull();
  });

  it("re-issues the caller's in-flight assignment idempotently", async () => {
    const task = taskRow();
    const existing = {
      ...assignmentRow({ assignedAt: new Date() }),
      task,
    } as AnnotationTaskAssignment & {
      task: AnnotationTask;
    };
    tasks.findActiveAssignmentForUser.mockResolvedValue(existing);

    const result = await service.pullNext({
      slug: 'pilot',
      user: userPayload(ANNOTATOR_SUB),
      userGroups: ['annotator'],
    });

    expect(tasks.createAssignment).not.toHaveBeenCalled();
    expect(result.assignment?.id).toBe('asn-1');
    // A reload costs one read: no expiry scan, no transaction.
    expect(abandonment.expireStaleForCampaign).not.toHaveBeenCalled();
    expect(tasks.inTransaction).not.toHaveBeenCalled();
  });

  it('creates a new assignment when nothing is in flight (FIFO via repo ordering)', async () => {
    const task = taskRow();
    tasks.findActiveAssignmentForUser.mockResolvedValue(null);
    tasks.findNextEligibleTask.mockResolvedValue(task);
    tasks.createAssignment.mockResolvedValue(assignmentRow());

    const result = await service.pullNext({
      slug: 'pilot',
      user: userPayload(ANNOTATOR_SUB),
      userGroups: ['annotator'],
    });

    expect(tasks.createAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        assigneeRole: 'annotator',
        gateAtAssignment: 'INDEPENDENT',
      }),
    );
    expect(result.assignment?.taskId).toBe('task-1');
  });

  it('routes arbitration-annotator to AWAITING_ARBITRATION-gate tasks', async () => {
    tasks.findActiveAssignmentForUser.mockResolvedValue(null);
    tasks.findNextEligibleTask.mockResolvedValue(taskRow({ gateState: 'AWAITING_ARBITRATION' }));
    tasks.createAssignment.mockResolvedValue(
      assignmentRow({
        gateAtAssignment: 'AWAITING_ARBITRATION',
        assigneeRole: 'arbitration-annotator',
      }),
    );

    const result = await service.pullNext({
      slug: 'pilot',
      user: userPayload(ARBITER_SUB),
      userGroups: ['arbitration-annotator'],
    });

    expect(tasks.findNextEligibleTask).toHaveBeenCalledWith(
      expect.objectContaining({ gate: 'AWAITING_ARBITRATION' }),
    );
    expect(result.assignment?.gateAtAssignment).toBe('AWAITING_ARBITRATION');
  });

  it('prefers INDEPENDENT for a multi-role caller (preserves SOP ordering)', async () => {
    tasks.findActiveAssignmentForUser.mockResolvedValue(null);
    tasks.findNextEligibleTask.mockResolvedValue(null);

    await service.pullNext({
      slug: 'pilot',
      user: userPayload(EXPERT_SUB),
      userGroups: ['annotator', 'arbitration-annotator', 'expert-reviewer'],
    });

    expect(tasks.findNextEligibleTask).toHaveBeenCalledWith(
      expect.objectContaining({ gate: 'INDEPENDENT' }),
    );
  });

  // --- bias-prevention 1.5× cap (ADR-0009 predicate 4) ---------------------

  it('refuses to assign when the caller would exceed the bias-prevention cap', async () => {
    tasks.findActiveAssignmentForUser.mockResolvedValue(null);
    // 8 slots, 2 active annotators → cap = ceil(8/2) × 1.5 = 6.
    // Caller already at 6 → next assignment would be 7th → over cap.
    tasks.biasCapInputs.mockResolvedValueOnce({
      totalSlots: 8,
      nActiveAnnotators: 2,
      callerShare: 6,
    });

    const result = await service.pullNext({
      slug: 'pilot',
      user: userPayload(ANNOTATOR_SUB),
      userGroups: ['annotator'],
    });

    expect(result.assignment).toBeNull();
    // Router never even reaches findNextEligibleTask when the cap binds.
    expect(tasks.findNextEligibleTask).not.toHaveBeenCalled();
  });

  it('lets a multi-role caller in when their share is still below the cap', async () => {
    const task = taskRow();
    tasks.findActiveAssignmentForUser.mockResolvedValue(null);
    // 8 slots, 2 active annotators → cap = 6. Caller at 5 → 6 just fits.
    tasks.biasCapInputs.mockResolvedValueOnce({
      totalSlots: 8,
      nActiveAnnotators: 2,
      callerShare: 5,
    });
    tasks.findNextEligibleTask.mockResolvedValue(task);
    tasks.createAssignment.mockResolvedValue(assignmentRow());

    const result = await service.pullNext({
      slug: 'pilot',
      user: userPayload(ANNOTATOR_SUB),
      userGroups: ['annotator'],
    });

    expect(result.assignment?.taskId).toBe('task-1');
  });

  it('does not bind when the caller is the only annotator and there is enough work', async () => {
    const task = taskRow();
    tasks.findActiveAssignmentForUser.mockResolvedValue(null);
    // 8 slots, only this annotator working (n=1) → cap = 8 × 1.5 = 12.
    // Caller already at 4 → 5 ≤ 12 → fine.
    tasks.biasCapInputs.mockResolvedValueOnce({
      totalSlots: 8,
      nActiveAnnotators: 1,
      callerShare: 4,
    });
    tasks.findNextEligibleTask.mockResolvedValue(task);
    tasks.createAssignment.mockResolvedValue(assignmentRow());

    const result = await service.pullNext({
      slug: 'pilot',
      user: userPayload(ANNOTATOR_SUB),
      userGroups: ['annotator'],
    });

    expect(result.assignment).not.toBeNull();
  });

  it('does not apply the independent-reading cap at the arbitration gate', async () => {
    tasks.findActiveAssignmentForUser.mockResolvedValue(null);
    tasks.findNextEligibleTask.mockResolvedValue(taskRow({ gateState: 'AWAITING_ARBITRATION' }));
    tasks.createAssignment.mockResolvedValue(
      assignmentRow({ gateAtAssignment: 'AWAITING_ARBITRATION' }),
    );

    const result = await service.pullNext({
      slug: 'pilot',
      user: userPayload(ANNOTATOR_SUB),
      userGroups: ['arbitration-annotator'],
    });

    expect(tasks.biasCapInputs).not.toHaveBeenCalled();
    expect(result.assignment).not.toBeNull();
  });

  // --- expiry inside pull-next (#647) ---------------------------------------

  it("expires the campaign's stale assignments before, and outside, the pull transaction", async () => {
    const order: string[] = [];
    abandonment.expireStaleForCampaign.mockImplementation(async () => {
      order.push('expire');
      return 1;
    });
    tasks.inTransaction.mockImplementation((fn: (t: unknown, tx: unknown) => unknown) => {
      order.push('pull-tx');
      return fn(tasks, TX);
    });
    tasks.findActiveAssignmentForUser.mockResolvedValue(null);
    tasks.findNextEligibleTask.mockResolvedValue(taskRow());
    tasks.createAssignment.mockResolvedValue(assignmentRow());

    await service.pullNext({
      slug: 'pilot',
      user: userPayload(ANNOTATOR_SUB),
      userGroups: ['annotator'],
    });

    expect(abandonment.expireStaleForCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ campaign: expect.objectContaining({ id: 'cmp-1' }) }),
    );
    expect(order).toEqual(['expire', 'pull-tx']);
  });

  it("does not re-issue the caller's own assignment once it is past the time limit", async () => {
    const task = taskRow();
    const stale = {
      ...assignmentRow({ assignedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }),
      task,
    };
    // Before expiry the stale row is still in flight; the expiry then
    // releases it, so the re-check inside the transaction finds none.
    tasks.findActiveAssignmentForUser.mockResolvedValueOnce(stale).mockResolvedValueOnce(null);
    tasks.findNextEligibleTask.mockResolvedValue(task);
    tasks.createAssignment.mockResolvedValue(assignmentRow({ id: 'asn-2' }));

    const result = await service.pullNext({
      slug: 'pilot',
      user: userPayload(ANNOTATOR_SUB),
      userGroups: ['annotator'],
    });

    expect(abandonment.expireStaleForCampaign).toHaveBeenCalledTimes(1);
    expect(result.assignment?.id).toBe('asn-2');
  });

  it('passes the activity window (2 × taskTimeoutHours) to the cap inputs', async () => {
    const c = runningCampaign(1);
    (c as { workflowConfig: unknown }).workflowConfig = { nAnnotators: 1, taskTimeoutHours: 6 };
    campaigns.findBySlug.mockResolvedValue(c);
    tasks.findActiveAssignmentForUser.mockResolvedValue(null);
    tasks.findNextEligibleTask.mockResolvedValue(null);
    const before = Date.now();

    await service.pullNext({
      slug: 'pilot',
      user: userPayload(ANNOTATOR_SUB),
      userGroups: ['annotator'],
    });

    const { activeSince } = tasks.biasCapInputs.mock.calls[0]![0] as { activeSince: Date };
    const windowMs = before - activeSince.getTime();
    expect(windowMs).toBeGreaterThanOrEqual(12 * 60 * 60 * 1000 - 1000);
    expect(windowMs).toBeLessThanOrEqual(12 * 60 * 60 * 1000 + 1000);
  });
});

// --- submit (gate state machine) -------------------------------------------

describe('TaskService.submit', () => {
  it('N=1: independent submission completes the task in one step', async () => {
    const task = taskRow({ nAnnotatorsRequired: 1 });
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    tasks.markAssignmentSubmitted.mockResolvedValue(
      assignmentRow({ status: 'SUBMITTED', submittedAt: new Date() }),
    );
    tasks.countSubmittedAssignmentsAtGate.mockResolvedValue(1);
    tasks.updateGateState.mockResolvedValue(taskRow({ gateState: 'COMPLETED' }));

    const result = await service.submit({
      assignmentId: 'asn-1',
      submission: { ans: 'foo' },
      user: userPayload(ANNOTATOR_SUB),
    });

    expect(tasks.updateGateState).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedFrom: 'INDEPENDENT',
        to: 'COMPLETED',
        stampCompletedAt: true,
      }),
    );
    expect(result.newGateState).toBe('COMPLETED');
  });

  it('N=3: first independent submission does not advance the gate yet', async () => {
    const task = taskRow({ nAnnotatorsRequired: 3 });
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    tasks.markAssignmentSubmitted.mockResolvedValue(true);
    tasks.countSubmittedAssignmentsAtGate.mockResolvedValue(1);

    const result = await service.submit({
      assignmentId: 'asn-1',
      submission: {},
      user: userPayload(ANNOTATOR_SUB),
    });

    expect(tasks.updateGateState).not.toHaveBeenCalled();
    expect(result.newGateState).toBeNull();
  });

  it('N=3: third independent submission with DISAGREEING labels escalates to AWAITING_ARBITRATION', async () => {
    const task = taskRow({ nAnnotatorsRequired: 3 });
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    tasks.markAssignmentSubmitted.mockResolvedValue(true);
    tasks.countSubmittedAssignmentsAtGate.mockResolvedValue(3);
    // Default mock seeds three disagreeing labels — IRR < 0.6 → escalate.
    tasks.updateGateState.mockResolvedValue(taskRow({ gateState: 'AWAITING_ARBITRATION' }));

    const result = await service.submit({
      assignmentId: 'asn-1',
      submission: { label: 'c' },
      user: userPayload(ANNOTATOR_SUB),
    });

    expect(tasks.updateGateState).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedFrom: 'INDEPENDENT',
        to: 'AWAITING_ARBITRATION',
      }),
    );
    expect(result.newGateState).toBe('AWAITING_ARBITRATION');
  });

  it('N=3: third independent submission with UNANIMOUS labels skips arbitration → COMPLETED', async () => {
    const task = taskRow({ nAnnotatorsRequired: 3 });
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    tasks.markAssignmentSubmitted.mockResolvedValue(true);
    tasks.countSubmittedAssignmentsAtGate.mockResolvedValue(3);
    tasks.submissionPayloadsAtGate.mockResolvedValue([
      { label: 'pneumonia' },
      { label: 'pneumonia' },
      { label: 'pneumonia' },
    ]);
    tasks.updateGateState.mockResolvedValue(taskRow({ gateState: 'COMPLETED' }));

    const result = await service.submit({
      assignmentId: 'asn-1',
      submission: { label: 'pneumonia' },
      user: userPayload(ANNOTATOR_SUB),
    });

    expect(tasks.updateGateState).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedFrom: 'INDEPENDENT',
        to: 'COMPLETED',
        stampCompletedAt: true,
      }),
    );
    expect(result.newGateState).toBe('COMPLETED');
  });

  it('N=3: SEGMENTATION campaign always escalates (predicate deferred until #214)', async () => {
    const task = taskRow({ nAnnotatorsRequired: 3 });
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    tasks.markAssignmentSubmitted.mockResolvedValue(true);
    tasks.countSubmittedAssignmentsAtGate.mockResolvedValue(3);
    campaigns.findById.mockResolvedValueOnce({
      id: 'cmp-1',
      taskKind: 'SEGMENTATION',
      workflowConfig: { nAnnotators: 3 },
    });
    // Even unanimous labels can't pass — segmentation needs masks.
    tasks.submissionPayloadsAtGate.mockResolvedValue([
      { label: 'lesion' },
      { label: 'lesion' },
      { label: 'lesion' },
    ]);
    tasks.updateGateState.mockResolvedValue(taskRow({ gateState: 'AWAITING_ARBITRATION' }));

    const result = await service.submit({
      assignmentId: 'asn-1',
      submission: { label: 'lesion' },
      user: userPayload(ANNOTATOR_SUB),
    });

    expect(result.newGateState).toBe('AWAITING_ARBITRATION');
  });

  it('arbitration submission completes the task (per ADR-0008)', async () => {
    const task = taskRow({
      nAnnotatorsRequired: 3,
      gateState: 'AWAITING_ARBITRATION',
    });
    tasks.findAssignmentById.mockResolvedValue({
      ...assignmentRow({
        gateAtAssignment: 'AWAITING_ARBITRATION',
        assigneeRole: 'arbitration-annotator',
      }),
      task,
    });
    tasks.markAssignmentSubmitted.mockResolvedValue(true);
    tasks.countSubmittedAssignmentsAtGate.mockResolvedValue(1);
    tasks.updateGateState.mockResolvedValue(taskRow({ gateState: 'COMPLETED' }));

    const result = await service.submit({
      assignmentId: 'asn-1',
      submission: {},
      user: userPayload(ANNOTATOR_SUB),
    });

    expect(tasks.updateGateState).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedFrom: 'AWAITING_ARBITRATION',
        to: 'COMPLETED',
        stampCompletedAt: true,
      }),
    );
    expect(result.newGateState).toBe('COMPLETED');
  });

  it('403s when the assignment belongs to a different user', async () => {
    const task = taskRow();
    tasks.findAssignmentById.mockResolvedValue({
      ...assignmentRow({ assigneeUserId: 'someone-else-uuid' }),
      task,
    });

    await expect(
      service.submit({
        assignmentId: 'asn-1',
        submission: {},
        user: userPayload(ANNOTATOR_SUB),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('409s when the task gate has moved on (stale assignment)', async () => {
    const task = taskRow({ gateState: 'AWAITING_ARBITRATION' });
    tasks.findAssignmentById.mockResolvedValue({
      ...assignmentRow({ gateAtAssignment: 'INDEPENDENT' }),
      task,
    });

    await expect(
      service.submit({
        assignmentId: 'asn-1',
        submission: {},
        user: userPayload(ANNOTATOR_SUB),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s when re-submitting an already-submitted assignment', async () => {
    const task = taskRow();
    tasks.findAssignmentById.mockResolvedValue({
      ...assignmentRow({ status: 'SUBMITTED' }),
      task,
    });

    await expect(
      service.submit({
        assignmentId: 'asn-1',
        submission: {},
        user: userPayload(ANNOTATOR_SUB),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // --- #231 completeness validation -----------------------------------------

  it('409s when another pull expired the assignment after the status checks (#669 review)', async () => {
    const task = taskRow({ nAnnotatorsRequired: 3 });
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    // The conditional update finds the row already EXPIRED.
    tasks.markAssignmentSubmitted.mockResolvedValue(false);

    await expect(
      service.submit({ assignmentId: 'asn-1', submission: {}, user: userPayload(ANNOTATOR_SUB) }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tasks.countSubmittedAssignmentsAtGate).not.toHaveBeenCalled();
    expect(tasks.updateGateState).not.toHaveBeenCalled();
  });

  it('hard-block: 422 when submission is incomplete', async () => {
    const task = taskRow();
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    campaigns.findById.mockResolvedValueOnce({
      id: 'cmp-1',
      slug: 'pilot',
      taskKind: 'CLASSIFICATION',
      workflowConfig: { nAnnotators: 3, completenessMode: 'hard-block' },
    });

    await expect(
      service.submit({
        assignmentId: 'asn-1',
        submission: { not_a_label: 'x' },
        user: userPayload(ANNOTATOR_SUB),
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tasks.markAssignmentSubmitted).not.toHaveBeenCalled();
  });

  it('hard-block: accepts a complete submission', async () => {
    const task = taskRow({ nAnnotatorsRequired: 1 });
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    campaigns.findById.mockResolvedValueOnce({
      id: 'cmp-1',
      slug: 'pilot',
      taskKind: 'CLASSIFICATION',
      workflowConfig: { nAnnotators: 1, completenessMode: 'hard-block' },
    });
    tasks.markAssignmentSubmitted.mockResolvedValue(true);
    tasks.countSubmittedAssignmentsAtGate.mockResolvedValue(1);
    tasks.updateGateState.mockResolvedValue(taskRow({ gateState: 'COMPLETED' }));

    const result = await service.submit({
      assignmentId: 'asn-1',
      submission: { label: 'pneumonia' },
      user: userPayload(ANNOTATOR_SUB),
    });
    expect(tasks.markAssignmentSubmitted).toHaveBeenCalled();
    expect(result.newGateState).toBe('COMPLETED');
  });

  it('hard-block: accepts noFindings: true on classification', async () => {
    const task = taskRow({ nAnnotatorsRequired: 1 });
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    campaigns.findById.mockResolvedValueOnce({
      id: 'cmp-1',
      slug: 'pilot',
      taskKind: 'CLASSIFICATION',
      workflowConfig: { nAnnotators: 1, completenessMode: 'hard-block' },
    });
    tasks.markAssignmentSubmitted.mockResolvedValue(true);
    tasks.countSubmittedAssignmentsAtGate.mockResolvedValue(1);
    tasks.updateGateState.mockResolvedValue(taskRow({ gateState: 'COMPLETED' }));

    await service.submit({
      assignmentId: 'asn-1',
      submission: { noFindings: true },
      user: userPayload(ANNOTATOR_SUB),
    });
    expect(tasks.markAssignmentSubmitted).toHaveBeenCalled();
  });

  it('soft-warn: incomplete payload is accepted (default mode)', async () => {
    const task = taskRow({ nAnnotatorsRequired: 1 });
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    // Default campaign mock has no completenessMode → soft-warn.
    tasks.markAssignmentSubmitted.mockResolvedValue(true);
    tasks.countSubmittedAssignmentsAtGate.mockResolvedValue(1);
    tasks.updateGateState.mockResolvedValue(taskRow({ gateState: 'COMPLETED' }));

    await service.submit({
      assignmentId: 'asn-1',
      submission: { irrelevant: 'x' },
      user: userPayload(ANNOTATOR_SUB),
    });
    expect(tasks.markAssignmentSubmitted).toHaveBeenCalled();
  });

  // --- #230 instructions acknowledgement -------------------------------------

  it('409s when the campaign has published instructions but the submission omits the ack', async () => {
    const task = taskRow({ nAnnotatorsRequired: 1 });
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    campaigns.findById.mockResolvedValueOnce({
      id: 'cmp-1',
      slug: 'pilot',
      taskKind: 'CLASSIFICATION',
      workflowConfig: { nAnnotators: 1 },
      currentInstructionsVersion: 'abc123',
    });

    await expect(
      service.submit({
        assignmentId: 'asn-1',
        submission: { label: 'pneumonia' },
        user: userPayload(ANNOTATOR_SUB),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tasks.markAssignmentSubmitted).not.toHaveBeenCalled();
  });

  it('409s when the ack version is stale (instructions updated mid-flight)', async () => {
    const task = taskRow({ nAnnotatorsRequired: 1 });
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    campaigns.findById.mockResolvedValueOnce({
      id: 'cmp-1',
      slug: 'pilot',
      taskKind: 'CLASSIFICATION',
      workflowConfig: { nAnnotators: 1 },
      currentInstructionsVersion: 'def456',
    });

    await expect(
      service.submit({
        assignmentId: 'asn-1',
        submission: { label: 'pneumonia' },
        acknowledgedInstructionsVersion: 'abc123',
        user: userPayload(ANNOTATOR_SUB),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tasks.markAssignmentSubmitted).not.toHaveBeenCalled();
  });

  it('persists the ack version on the assignment when the submission matches the current version', async () => {
    const task = taskRow({ nAnnotatorsRequired: 1 });
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    campaigns.findById.mockResolvedValueOnce({
      id: 'cmp-1',
      slug: 'pilot',
      taskKind: 'CLASSIFICATION',
      workflowConfig: { nAnnotators: 1 },
      currentInstructionsVersion: 'abc123',
    });
    tasks.markAssignmentSubmitted.mockResolvedValue(true);
    tasks.countSubmittedAssignmentsAtGate.mockResolvedValue(1);
    tasks.updateGateState.mockResolvedValue(taskRow({ gateState: 'COMPLETED' }));

    await service.submit({
      assignmentId: 'asn-1',
      submission: { label: 'pneumonia' },
      acknowledgedInstructionsVersion: 'abc123',
      user: userPayload(ANNOTATOR_SUB),
    });

    expect(tasks.markAssignmentSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: 'asn-1',
        acknowledgedInstructionsVersion: 'abc123',
      }),
    );
  });

  it('does not enforce the ack when the campaign has no published instructions', async () => {
    const task = taskRow({ nAnnotatorsRequired: 1 });
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    // Default campaign mock has currentInstructionsVersion = undefined ≡ null.
    tasks.markAssignmentSubmitted.mockResolvedValue(true);
    tasks.countSubmittedAssignmentsAtGate.mockResolvedValue(1);
    tasks.updateGateState.mockResolvedValue(taskRow({ gateState: 'COMPLETED' }));

    await service.submit({
      assignmentId: 'asn-1',
      submission: { label: 'pneumonia' },
      user: userPayload(ANNOTATOR_SUB),
    });
    expect(tasks.markAssignmentSubmitted).toHaveBeenCalled();
  });
});

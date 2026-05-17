import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
}

interface TasksMock {
  seedTasks: ReturnType<typeof vi.fn>;
  listTasksForCampaign: ReturnType<typeof vi.fn>;
  submittedCountsForCampaign: ReturnType<typeof vi.fn>;
  findActiveAssignmentForUser: ReturnType<typeof vi.fn>;
  findNextEligibleTask: ReturnType<typeof vi.fn>;
  createAssignment: ReturnType<typeof vi.fn>;
  findAssignmentById: ReturnType<typeof vi.fn>;
  markAssignmentSubmitted: ReturnType<typeof vi.fn>;
  countSubmittedAssignmentsAtGate: ReturnType<typeof vi.fn>;
  updateGateState: ReturnType<typeof vi.fn>;
  setAssignmentStatus: ReturnType<typeof vi.fn>;
  findTaskById: ReturnType<typeof vi.fn>;
}

let campaigns: CampaignsMock;
let tasks: TasksMock;
let service: TaskService;

beforeEach(() => {
  campaigns = { findBySlug: vi.fn() };
  tasks = {
    seedTasks: vi.fn(),
    listTasksForCampaign: vi.fn(),
    submittedCountsForCampaign: vi.fn().mockResolvedValue(new Map<string, number>()),
    findActiveAssignmentForUser: vi.fn(),
    findNextEligibleTask: vi.fn(),
    createAssignment: vi.fn(),
    findAssignmentById: vi.fn(),
    markAssignmentSubmitted: vi.fn(),
    countSubmittedAssignmentsAtGate: vi.fn(),
    updateGateState: vi.fn(),
    setAssignmentStatus: vi.fn(),
    findTaskById: vi.fn(),
  };
  service = new TaskService(
    campaigns as unknown as CampaignRepository,
    tasks as unknown as TaskRepository,
  );
});

// --- Seed -------------------------------------------------------------------

describe('TaskService.seed', () => {
  it('seeds tasks against a RUNNING campaign with the campaign nAnnotators', async () => {
    campaigns.findBySlug.mockResolvedValue(runningCampaign(3));
    tasks.seedTasks.mockResolvedValue({ created: 2, skipped: 0 });

    const result = await service.seed({ slug: 'pilot', sampleRefs: ['a', 'b'] });

    expect(tasks.seedTasks).toHaveBeenCalledWith('cmp-1', 3, ['a', 'b']);
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
});

// --- listForCampaign --------------------------------------------------------

describe('TaskService.listForCampaign', () => {
  it("populates submittedCount per task from the campaign's SUBMITTED rows", async () => {
    const taskA = taskRow({ id: 'task-A', nAnnotatorsRequired: 3, gateState: 'INDEPENDENT' });
    const taskB = taskRow({ id: 'task-B', nAnnotatorsRequired: 3, gateState: 'AWAITING_ARBITRATION' });
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
    const existing = { ...assignmentRow(), task } as AnnotationTaskAssignment & {
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
    tasks.markAssignmentSubmitted.mockResolvedValue(assignmentRow({ status: 'SUBMITTED' }));
    tasks.countSubmittedAssignmentsAtGate.mockResolvedValue(1);

    const result = await service.submit({
      assignmentId: 'asn-1',
      submission: {},
      user: userPayload(ANNOTATOR_SUB),
    });

    expect(tasks.updateGateState).not.toHaveBeenCalled();
    expect(result.newGateState).toBeNull();
  });

  it('N=3: third independent submission escalates to AWAITING_ARBITRATION', async () => {
    const task = taskRow({ nAnnotatorsRequired: 3 });
    tasks.findAssignmentById.mockResolvedValue({ ...assignmentRow(), task });
    tasks.markAssignmentSubmitted.mockResolvedValue(assignmentRow({ status: 'SUBMITTED' }));
    tasks.countSubmittedAssignmentsAtGate.mockResolvedValue(3);
    tasks.updateGateState.mockResolvedValue(taskRow({ gateState: 'AWAITING_ARBITRATION' }));

    const result = await service.submit({
      assignmentId: 'asn-1',
      submission: {},
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
    tasks.markAssignmentSubmitted.mockResolvedValue(assignmentRow({ status: 'SUBMITTED' }));
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
});

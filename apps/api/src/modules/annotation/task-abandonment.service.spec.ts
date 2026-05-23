import type { AuditEmitter } from '@oci/audit';
import type { AnnotationGateState, AnnotationTask, AnnotationTaskAssignment } from '@oci/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskAbandonmentService } from './task-abandonment.service.js';
import { TaskRepository } from './task.repository.js';

interface TasksMock {
  findAbandonmentCandidates: ReturnType<typeof vi.fn>;
  markAssignmentExpired: ReturnType<typeof vi.fn>;
}

interface AuditMock {
  emit: ReturnType<typeof vi.fn>;
  emitSync: ReturnType<typeof vi.fn>;
}

function candidate(args: {
  id?: string;
  assignedAtMs: number;
  status?: 'PENDING' | 'IN_PROGRESS';
  campaignTimeoutHours?: number;
}): AnnotationTaskAssignment & {
  task: AnnotationTask & { campaign: { id: string; slug: string; workflowConfig: unknown } };
} {
  return {
    id: args.id ?? 'asn-1',
    taskId: 'task-1',
    assigneeUserId: 'user-1',
    assigneeRole: 'annotator',
    gateAtAssignment: 'INDEPENDENT' as AnnotationGateState,
    status: args.status ?? 'IN_PROGRESS',
    submission: null,
    assignedAt: new Date(args.assignedAtMs),
    startedAt: null,
    submittedAt: null,
    expiredAt: null,
    task: {
      id: 'task-1',
      campaignId: 'cmp-1',
      sampleRef: 'sample-1',
      nAnnotatorsRequired: 3,
      gateState: 'INDEPENDENT' as AnnotationGateState,
      skipReason: null,
      createdAt: new Date(args.assignedAtMs - 1000),
      updatedAt: new Date(args.assignedAtMs - 1000),
      completedAt: null,
      campaign: {
        id: 'cmp-1',
        slug: 'pilot',
        workflowConfig:
          args.campaignTimeoutHours !== undefined
            ? { nAnnotators: 3, taskTimeoutHours: args.campaignTimeoutHours }
            : { nAnnotators: 3 },
      },
    },
  } as unknown as AnnotationTaskAssignment & {
    task: AnnotationTask & { campaign: { id: string; slug: string; workflowConfig: unknown } };
  };
}

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-05-17T20:00:00Z').getTime();

let tasks: TasksMock;
let audit: AuditMock;
let service: TaskAbandonmentService;

beforeEach(() => {
  tasks = {
    findAbandonmentCandidates: vi.fn(),
    markAssignmentExpired: vi.fn().mockResolvedValue(true),
  };
  audit = {
    emit: vi.fn().mockResolvedValue(undefined),
    emitSync: vi.fn().mockResolvedValue({}),
  };
  service = new TaskAbandonmentService(
    tasks as unknown as TaskRepository,
    audit as unknown as AuditEmitter,
  );
});

describe('TaskAbandonmentService.runOnce', () => {
  it('expires + audit-emits assignments past their campaign timeout', async () => {
    tasks.findAbandonmentCandidates.mockResolvedValue([
      candidate({ id: 'asn-old', assignedAtMs: NOW - 30 * HOUR_MS }), // default 24h → expired
    ]);

    const result = await service.runOnce({ nowMs: NOW });

    expect(tasks.markAssignmentExpired).toHaveBeenCalledWith('asn-old');
    expect(audit.emitSync).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'annotation',
        action: 'task.assignment.expired',
        subjectId: 'asn-old',
      }),
    );
    expect(result).toEqual({ scanned: 1, expired: 1, skipped: 0 });
  });

  it('respects per-campaign taskTimeoutHours', async () => {
    tasks.findAbandonmentCandidates.mockResolvedValue([
      // Campaign set to 4h; assignment 3h old → NOT expired.
      candidate({ id: 'asn-young', assignedAtMs: NOW - 3 * HOUR_MS, campaignTimeoutHours: 4 }),
      // Campaign set to 4h; assignment 5h old → expired.
      candidate({ id: 'asn-aged', assignedAtMs: NOW - 5 * HOUR_MS, campaignTimeoutHours: 4 }),
    ]);

    const result = await service.runOnce({ nowMs: NOW });

    expect(tasks.markAssignmentExpired).toHaveBeenCalledTimes(1);
    expect(tasks.markAssignmentExpired).toHaveBeenCalledWith('asn-aged');
    expect(result.expired).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('skips a row when the conditional UPDATE finds nothing (raced by a submit)', async () => {
    tasks.findAbandonmentCandidates.mockResolvedValue([
      candidate({ id: 'asn-raced', assignedAtMs: NOW - 30 * HOUR_MS }),
    ]);
    tasks.markAssignmentExpired.mockResolvedValueOnce(false);

    const result = await service.runOnce({ nowMs: NOW });

    expect(audit.emitSync).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, expired: 0, skipped: 1 });
  });

  it("swallows audit emit failures so the sweeper doesn't stop mid-batch", async () => {
    tasks.findAbandonmentCandidates.mockResolvedValue([
      candidate({ id: 'asn-1', assignedAtMs: NOW - 30 * HOUR_MS }),
      candidate({ id: 'asn-2', assignedAtMs: NOW - 30 * HOUR_MS }),
    ]);
    audit.emitSync.mockRejectedValueOnce(new Error('audit queue down'));

    const result = await service.runOnce({ nowMs: NOW });

    expect(tasks.markAssignmentExpired).toHaveBeenCalledTimes(2);
    expect(audit.emitSync).toHaveBeenCalledTimes(2);
    expect(result.expired).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('handles an empty candidate set without emitting anything', async () => {
    tasks.findAbandonmentCandidates.mockResolvedValue([]);
    const result = await service.runOnce({ nowMs: NOW });
    expect(result).toEqual({ scanned: 0, expired: 0, skipped: 0 });
    expect(audit.emitSync).not.toHaveBeenCalled();
  });
});

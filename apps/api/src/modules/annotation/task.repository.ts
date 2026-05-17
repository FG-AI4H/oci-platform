import { Inject, Injectable } from '@nestjs/common';
import type {
  AnnotationAssignmentStatus,
  AnnotationGateState,
  AnnotationTask,
  AnnotationTaskAssignment,
} from '@oci/database';
import { PrismaService } from '../../prisma.service.js';

/**
 * Slice-2 repository for AnnotationTask + AnnotationTaskAssignment
 * (#215). Holds the Prisma client surface so the service layer stays
 * persistence-agnostic (per the project repository convention).
 */
@Injectable()
export class TaskRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // --- AnnotationTask ----------------------------------------------------

  /**
   * Idempotent bulk seed. `createMany` with `skipDuplicates: true`
   * relies on the `(campaign_id, sample_ref)` unique index, so a
   * second call with overlapping refs counts toward `skipped` rather
   * than throwing.
   */
  async seedTasks(
    campaignId: string,
    nAnnotatorsRequired: number,
    sampleRefs: readonly string[],
  ): Promise<{ created: number; skipped: number }> {
    const data = sampleRefs.map((sampleRef) => ({
      campaignId,
      sampleRef,
      nAnnotatorsRequired,
    }));
    const result = await this.prisma.client.annotationTask.createMany({
      data,
      skipDuplicates: true,
    });
    return { created: result.count, skipped: sampleRefs.length - result.count };
  }

  async findTaskById(id: string): Promise<AnnotationTask | null> {
    return this.prisma.client.annotationTask.findUnique({ where: { id } });
  }

  async listTasksForCampaign(campaignId: string, limit = 100): Promise<AnnotationTask[]> {
    return this.prisma.client.annotationTask.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Returns a `(taskId|gate) → submittedCount` map for every
   * SUBMITTED assignment in the campaign. The service cross-
   * references this against each task's current `gateState` so the
   * count surfaced on the manager dashboard is "submitted at the
   * task's current gate" — which advances + resets as the task
   * moves through INDEPENDENT → AWAITING_ARBITRATION → AWAITING_EXPERT.
   */
  async submittedCountsForCampaign(campaignId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.client.annotationTaskAssignment.findMany({
      where: { status: 'SUBMITTED', task: { campaignId } },
      select: { taskId: true, gateAtAssignment: true },
    });
    const byTaskAndGate = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.taskId}|${r.gateAtAssignment}`;
      byTaskAndGate.set(key, (byTaskAndGate.get(key) ?? 0) + 1);
    }
    return byTaskAndGate;
  }

  async countSubmittedAssignmentsAtGate(
    taskId: string,
    gate: AnnotationGateState,
  ): Promise<number> {
    return this.prisma.client.annotationTaskAssignment.count({
      where: { taskId, gateAtAssignment: gate, status: 'SUBMITTED' },
    });
  }

  async updateGateState(args: {
    taskId: string;
    expectedFrom: AnnotationGateState;
    to: AnnotationGateState;
    stampCompletedAt?: boolean;
    skipReason?: string | null;
  }): Promise<AnnotationTask> {
    const data: {
      gateState: AnnotationGateState;
      completedAt?: Date;
      skipReason?: string | null;
    } = { gateState: args.to };
    if (args.stampCompletedAt) data.completedAt = new Date();
    if (args.skipReason !== undefined) data.skipReason = args.skipReason;

    // Conditional update — guards against a parallel writer having
    // already moved the row. updateMany returns the affected count;
    // 0 means the precondition failed and the service surfaces 409.
    const result = await this.prisma.client.annotationTask.updateMany({
      where: { id: args.taskId, gateState: args.expectedFrom },
      data,
    });
    if (result.count === 0) {
      const fresh = await this.findTaskById(args.taskId);
      if (!fresh) throw new Error(`Task ${args.taskId} disappeared during gate update`);
      return fresh;
    }
    const fresh = await this.findTaskById(args.taskId);
    if (!fresh) throw new Error(`Task ${args.taskId} disappeared after gate update`);
    return fresh;
  }

  // --- AnnotationTaskAssignment ------------------------------------------

  /**
   * Find the caller's active assignment for the (campaign, gate)
   * pair. "Active" means PENDING or IN_PROGRESS. SUBMITTED rows are
   * historical; EXPIRED rows are abandonment cleanups.
   *
   * The current shape supports the slice-2 invariant "one annotator
   * holds at most one active assignment in flight per campaign+gate";
   * slice 3 will lift this if/when batch assignment lands.
   */
  async findActiveAssignmentForUser(args: {
    campaignId: string;
    gate: AnnotationGateState;
    assigneeUserId: string;
  }): Promise<(AnnotationTaskAssignment & { task: AnnotationTask }) | null> {
    return this.prisma.client.annotationTaskAssignment.findFirst({
      where: {
        gateAtAssignment: args.gate,
        assigneeUserId: args.assigneeUserId,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        task: { campaignId: args.campaignId },
      },
      include: { task: true },
      orderBy: { assignedAt: 'asc' },
    });
  }

  /**
   * FIFO eligible-task lookup for the router. Returns the
   * earliest-created task whose `gateState === gate`, where the
   * caller (`assigneeUserId`) does NOT already hold an active
   * assignment, AND the task has fewer than the gate's required
   * number of in-flight assignments (slots-still-open check).
   *
   * Slice 2 caps "in-flight per task per gate" at
   * `nAnnotatorsRequired - submittedCount`, so we don't over-assign
   * a near-complete task. The full predicate chain from ADR-0009
   * Decision 1 (experience-ranking, bias-prevention, stratification)
   * is slice 3.
   */
  async findNextEligibleTask(args: {
    campaignId: string;
    gate: AnnotationGateState;
    assigneeUserId: string;
  }): Promise<AnnotationTask | null> {
    // Pull a small candidate page in FIFO order, then filter in
    // application code. The result-set size is bounded by N (per
    // task we keep at most N concurrent assignments), so a page of
    // 50 is sufficient for any campaign N ≤ 12 (the soft cap).
    const candidates = await this.prisma.client.annotationTask.findMany({
      where: { campaignId: args.campaignId, gateState: args.gate },
      orderBy: { createdAt: 'asc' },
      take: 50,
      include: {
        assignments: {
          where: { gateAtAssignment: args.gate },
          select: { assigneeUserId: true, status: true },
        },
      },
    });
    for (const task of candidates) {
      const submitted = task.assignments.filter((a) => a.status === 'SUBMITTED').length;
      const inFlight = task.assignments.filter(
        (a) => a.status === 'PENDING' || a.status === 'IN_PROGRESS',
      ).length;
      const slotsLeft = task.nAnnotatorsRequired - submitted - inFlight;
      if (slotsLeft <= 0) continue;
      const callerAlreadyOnTask = task.assignments.some(
        (a) => a.assigneeUserId === args.assigneeUserId,
      );
      if (callerAlreadyOnTask) continue;
      // Strip the included assignments — the caller wants a plain
      // AnnotationTask shape.
      const { assignments: _drop, ...plain } = task;
      void _drop;
      return plain;
    }
    return null;
  }

  async createAssignment(args: {
    taskId: string;
    assigneeUserId: string;
    assigneeRole: string;
    gateAtAssignment: AnnotationGateState;
  }): Promise<AnnotationTaskAssignment> {
    return this.prisma.client.annotationTaskAssignment.create({
      data: {
        taskId: args.taskId,
        assigneeUserId: args.assigneeUserId,
        assigneeRole: args.assigneeRole,
        gateAtAssignment: args.gateAtAssignment,
        status: 'PENDING',
      },
    });
  }

  async findAssignmentById(
    id: string,
  ): Promise<(AnnotationTaskAssignment & { task: AnnotationTask }) | null> {
    return this.prisma.client.annotationTaskAssignment.findUnique({
      where: { id },
      include: { task: true },
    });
  }

  async markAssignmentSubmitted(args: {
    assignmentId: string;
    submission: Record<string, unknown>;
  }): Promise<AnnotationTaskAssignment> {
    return this.prisma.client.annotationTaskAssignment.update({
      where: { id: args.assignmentId },
      data: {
        status: 'SUBMITTED',
        // Cast through unknown because Prisma 7's `InputJsonValue` is a
        // tagged structural type that's only assignable from `Json`,
        // not from `Record<string, unknown>`. The runtime shape is
        // identical; we'd need RFC 8785 canonicalisation to narrow it.
        submission: args.submission as unknown as object,
        submittedAt: new Date(),
      },
    });
  }

  async setAssignmentStatus(
    assignmentId: string,
    status: AnnotationAssignmentStatus,
  ): Promise<AnnotationTaskAssignment> {
    return this.prisma.client.annotationTaskAssignment.update({
      where: { id: assignmentId },
      data: { status, ...(status === 'IN_PROGRESS' ? { startedAt: new Date() } : {}) },
    });
  }
}

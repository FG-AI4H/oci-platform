import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuditEmitter, AuditPrismaPort } from '@oci/audit';
import type { AnnotationTask, AnnotationTaskAssignment, Prisma } from '@oci/database';
import { AUDIT_EMITTER } from '../audit/audit.module.js';
import { TaskRepository } from './task.repository.js';

/**
 * Task-abandonment sweeper (#229).
 *
 * An annotator who picks up a task and never submits would otherwise
 * hold the slot indefinitely. Each campaign declares a
 * `taskTimeoutHours` in its workflow config (default 24h, range
 * [1h, 168h] per the issue). This service scans for active
 * assignments past that horizon and transitions them to EXPIRED.
 *
 * Slice-2 decisions deliberately deferred to slice 3:
 *   - "Front of the queue" re-pick rate for the freed task — needs
 *     router-side ordering (slice 3 routing predicates 3 + 4).
 *   - "Skip the original abandoner if ≥ 50% of the way through" —
 *     same place, slice 3.
 *   - Supervisor dashboard for per-campaign abandonment rate —
 *     separate UI work; the data is on the row already
 *     (`status = EXPIRED`, `expiredAt`).
 *
 * Two paths expire assignments:
 *   - `expireStaleForCampaign` runs inside every pull-next (#647), in
 *     the pull's transaction. It is the path that works everywhere:
 *     no deployed environment runs Redis, so the scheduler is off there.
 *   - `runOnce` is the BullMQ sweep, active only when `REDIS_URL` is
 *     set. It still frees slots in campaigns nobody is pulling from.
 *
 * Audit emission: each expiry emits
 * `annotation.task.assignment.expired` synchronously so the
 * regulator-grade trail captures the abandonment.
 */
@Injectable()
export class TaskAbandonmentService {
  private readonly logger = new Logger(TaskAbandonmentService.name);

  constructor(
    @Inject(TaskRepository) private readonly tasks: TaskRepository,
    @Inject(AUDIT_EMITTER) private readonly audit: AuditEmitter,
  ) {}

  /**
   * Expire one campaign's assignments that are past its
   * `taskTimeoutHours`, inside the caller's transaction. Each expiry's
   * audit row is written in the same transaction, so an audit failure
   * rolls the expiry back with the rest of the pull rather than leaving
   * an unaudited state change. Returns the number expired.
   *
   * At most `PULL_EXPIRY_LIMIT` rows per pull. Every audit insert takes
   * the audit chain's transaction-scoped advisory lock, so a large
   * backlog (a whole cohort walking away over a weekend) expired in one
   * pull would hold that lock platform-wide and could run the pull past
   * Prisma's interactive-transaction timeout, failing every retry the
   * same way. Later pulls clear the rest.
   */
  async expireStaleForCampaign(args: {
    campaign: { id: string; slug: string; workflowConfig: unknown };
    tasks: TaskRepository;
    tx: Prisma.TransactionClient;
    nowMs?: number;
  }): Promise<number> {
    const now = args.nowMs ?? Date.now();
    const timeoutHours = readTaskTimeoutHours(args.campaign.workflowConfig);
    const rows = await args.tasks.findStaleAssignmentsForCampaign({
      campaignId: args.campaign.id,
      olderThan: new Date(now - timeoutHours * HOUR_MS),
      limit: PULL_EXPIRY_LIMIT,
    });
    let expired = 0;
    for (const row of rows) {
      // Conditional: a concurrent pull or submit may have moved the
      // row since the read. Count 0 means someone else handled it.
      if (!(await args.tasks.markAssignmentExpired(row.id))) continue;
      expired += 1;
      await this.audit.emitSync(
        {
          module: 'annotation',
          action: 'task.assignment.expired',
          subjectType: 'annotation-task-assignment',
          subjectId: row.id,
          payload: expiredPayload(row, args.campaign.slug, timeoutHours),
        },
        args.tx as unknown as AuditPrismaPort,
      );
    }
    if (expired > 0) {
      this.logger.log(`pull-next expiry — campaign=${args.campaign.slug} expired=${expired}`);
    }
    return expired;
  }

  /**
   * One sweep pass. Pulls a bounded batch of stale-looking rows,
   * filters them by each parent campaign's actual timeout, and
   * expires the rest. Returns counters for telemetry.
   *
   * The batch limit doubles as a backpressure cap — under load the
   * sweeper drains as fast as the scheduler ticks but never exceeds
   * one query's worth of database work per tick.
   */
  async runOnce(args?: { batchLimit?: number; nowMs?: number }): Promise<{
    scanned: number;
    expired: number;
    skipped: number;
  }> {
    const limit = args?.batchLimit ?? 200;
    const now = args?.nowMs ?? Date.now();

    // The widest possible window we'd ever expire: minimum allowed
    // timeout is 1h, so anything assigned more than 1h ago COULD be
    // expired depending on its campaign's setting. Filter to that
    // floor on the DB side; the service then applies the per-campaign
    // value precisely.
    const widest = new Date(now - HOUR_MS);
    const rows = await this.tasks.findAbandonmentCandidates({
      olderThan: widest,
      limit,
    });

    let expired = 0;
    let skipped = 0;
    for (const row of rows) {
      const timeoutHours = readTaskTimeoutHours(row.task.campaign.workflowConfig);
      const horizon = row.assignedAt.getTime() + timeoutHours * HOUR_MS;
      if (horizon > now) {
        // Still within its campaign's window — leave it alone.
        skipped += 1;
        continue;
      }
      const flipped = await this.tasks.markAssignmentExpired(row.id);
      if (!flipped) {
        // Raced with a submission. Skip silently — the row is now
        // SUBMITTED, which is the desired outcome.
        skipped += 1;
        continue;
      }
      expired += 1;
      try {
        await this.audit.emitSync({
          module: 'annotation',
          action: 'task.assignment.expired',
          subjectType: 'annotation-task-assignment',
          subjectId: row.id,
          payload: expiredPayload(row, row.task.campaign.slug, timeoutHours),
        });
      } catch (err) {
        // Audit failures are logged + swallowed so a transient audit
        // queue blip doesn't block the abandonment sweep. The
        // primary effect — freeing the slot — already committed.
        this.logger.error(
          `audit emit failed for expired assignment ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (rows.length > 0) {
      this.logger.log(
        `abandonment sweep — scanned=${rows.length} expired=${expired} skipped=${skipped}`,
      );
    }
    return { scanned: rows.length, expired, skipped };
  }
}

const HOUR_MS = 60 * 60 * 1000;
const PULL_EXPIRY_LIMIT = 20;

// Call sites keep the `{ module, action, … }` literal so the
// ADR-0014 audit-coverage grep can see them; only the payload is shared.
function expiredPayload(
  row: AnnotationTaskAssignment & { task: AnnotationTask },
  campaignSlug: string,
  timeoutHours: number,
): Record<string, unknown> {
  return {
    taskId: row.taskId,
    campaignSlug,
    sampleRef: row.task.sampleRef,
    gateAtAssignment: row.gateAtAssignment,
    assigneeRole: row.assigneeRole,
    assignedAt: row.assignedAt.toISOString(),
    timeoutHours,
    previousStatus: row.status,
  };
}

function readTaskTimeoutHours(workflowConfig: unknown): number {
  if (
    workflowConfig &&
    typeof workflowConfig === 'object' &&
    'taskTimeoutHours' in workflowConfig
  ) {
    const v = (workflowConfig as { taskTimeoutHours: unknown }).taskTimeoutHours;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 168) {
      return v;
    }
  }
  // Default matches CampaignWorkflowConfigSchema's `.default(24)`.
  // Campaigns created before #229 landed don't have the field set;
  // they get the same 24h horizon any new campaign would.
  return 24;
}

import { payloadHash } from './hash.js';
import type { AuditEventInput, AuditEventRecord, RetentionClass } from './types.js';

/**
 * Minimum surface of a Prisma-like client we need. Typing against the
 * full generated PrismaClient would couple `@oci/audit` to
 * `@oci/database`; instead, callers pass any client that exposes a
 * compatible `auditEvent.create` and `$transaction`. Keeps this
 * package leaf in the dep graph and trivially mockable in tests.
 */
export interface AuditPrismaPort {
  auditEvent: {
    create: (args: {
      data: {
        module: string;
        action: string;
        subjectType: string;
        subjectId: string;
        actorUserId?: string | null;
        actorRoles?: string[];
        payload: Record<string, unknown>;
        payloadHash: string;
        retentionClass?: RetentionClass;
        occurredAt?: Date;
      };
    }) => Promise<AuditEventRecord>;
  };
  $transaction: <T>(fn: (tx: AuditPrismaPort) => Promise<T>) => Promise<T>;
}

/**
 * Optional BullMQ-backed queue surface. The renewal cron pattern
 * (apps/api/src/modules/renewal/renewal.scheduler.ts) sets one up;
 * `apps/api/src/modules/audit/audit.module.ts` wires it through. When
 * no queue is configured the emitter falls back to inline persistence
 * with a logged warning — Phase A / local-dev / CI shouldn't require
 * Redis to record audit events.
 */
export interface AuditQueuePort {
  enqueue: (input: AuditEventInput) => Promise<void>;
}

export interface AuditLoggerPort {
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
}

export interface AuditEmitterOptions {
  prisma: AuditPrismaPort;
  queue?: AuditQueuePort;
  logger?: AuditLoggerPort;
}

/**
 * `AuditEmitter` is the single surface modules import. Two contracts:
 *
 *   - `emit(input)` — fire-and-forget. Pushes onto the BullMQ queue if
 *     wired; otherwise persists inline (logged as degraded mode).
 *     Never throws on transient failure — callers must not gate
 *     business logic on this.
 *
 *   - `emitSync(input, tx?)` — synchronous INSERT. Used for events
 *     that must commit atomically with the parent transaction (e.g.
 *     DUA signing, access grant). When `tx` is provided the row is
 *     persisted within that transaction; if it rolls back, the audit
 *     row rolls back too.
 *
 * Postgres triggers compute `previousHash` + `recordHash` on insert;
 * the application only computes `payloadHash` (RFC 8785 over payload)
 * so the off-platform verifier can reproduce it from the export bundle.
 */
export class AuditEmitter {
  constructor(private readonly opts: AuditEmitterOptions) {}

  async emit(input: AuditEventInput): Promise<void> {
    if (this.opts.queue) {
      try {
        await this.opts.queue.enqueue(input);
        return;
      } catch (err) {
        this.opts.logger?.error('audit.emit: queue enqueue failed, falling back to inline insert', {
          err: errorMessage(err),
          module: input.module,
          action: input.action,
        });
      }
    } else {
      this.opts.logger?.warn(
        'audit.emit: no BullMQ queue wired — persisting inline. ' +
          'Set REDIS_URL + provide a queue to AuditEmitter for at-least-once delivery.',
        { module: input.module, action: input.action },
      );
    }
    try {
      await this.emitSync(input);
    } catch (err) {
      // Fire-and-forget contract: log and swallow. The chain
      // verifier will surface gaps; we never block the request path.
      this.opts.logger?.error('audit.emit: inline insert failed', {
        err: errorMessage(err),
        module: input.module,
        action: input.action,
      });
    }
  }

  async emitSync(input: AuditEventInput, tx?: AuditPrismaPort): Promise<AuditEventRecord> {
    const client = tx ?? this.opts.prisma;
    const hash = payloadHash(input.payload);
    const data: Parameters<AuditPrismaPort['auditEvent']['create']>[0]['data'] = {
      module: input.module,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      payload: input.payload,
      payloadHash: hash,
    };
    if (input.actorUserId !== undefined) data.actorUserId = input.actorUserId;
    if (input.actorRoles !== undefined) data.actorRoles = [...input.actorRoles];
    if (input.retentionClass !== undefined) data.retentionClass = input.retentionClass;
    if (input.occurredAt !== undefined) data.occurredAt = input.occurredAt;

    return client.auditEvent.create({ data });
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

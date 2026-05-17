import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { AuditEmitter, type AuditPrismaPort, type AuditQueuePort } from '@oci/audit';
import type { Queue, Worker } from 'bullmq';
import { PrismaService } from '../../prisma.service.js';

export const AUDIT_EMITTER = Symbol.for('AUDIT_EMITTER');

/**
 * BullMQ bridge — declared first so `AuditModule` below can list it as
 * a provider. Spins up the worker only when `REDIS_URL` is present;
 * otherwise `emit()` runs inline (graceful degrade, matches the
 * renewal scheduler pattern).
 */
@Injectable()
class AuditQueueBridge implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AuditQueueBridge.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(@Inject(AUDIT_EMITTER) private readonly emitter: AuditEmitter) {}

  async onModuleInit(): Promise<void> {
    if (process.env.OCI_DISABLE_AUDIT_QUEUE === '1') {
      this.logger.log('audit queue disabled by OCI_DISABLE_AUDIT_QUEUE=1; emit() runs inline');
      return;
    }
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn(
        'audit queue: REDIS_URL not set — emit() runs inline. Set REDIS_URL for at-least-once delivery.',
      );
      return;
    }
    const { Queue, Worker } = await import('bullmq');
    const connection = parseRedisConnection(redisUrl);
    const queueName = 'audit-emit';

    this.queue = new Queue(queueName, { connection });
    this.worker = new Worker(
      queueName,
      async (job) => {
        await this.emitter.emitSync(job.data);
      },
      { connection, concurrency: 4 },
    );
    this.worker.on('failed', (_job, err) => {
      this.logger.error(`audit-emit job failed: ${err.message}`);
    });

    const queueRef = this.queue;
    const port: AuditQueuePort = {
      enqueue: async (input) => {
        await queueRef.add('audit-event', input, {
          removeOnComplete: 1000,
          removeOnFail: 1000,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
        });
      },
    };
    // Side-channel: extend the emitter with a queue port now that
    // Redis is up. AuditEmitter reads `this.opts.queue` on every call,
    // so a post-construction mutation is safe and lets us avoid a
    // circular DI graph (Queue → Emitter → Queue) at construction.
    (this.emitter as unknown as { opts: { queue?: AuditQueuePort } }).opts.queue = port;
    this.logger.log(`audit queue wired — name="${queueName}", concurrency=4`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}

/**
 * `AuditModule` — wires the `AuditEmitter` once for the whole API
 * (ADR-0014, #257). Marked `@Global()` so every domain module can
 * inject the emitter without re-importing the module.
 *
 * Critical events (DUA signing, access grants, role transitions) use
 * `emitter.emitSync(input, tx)` directly so the audit row commits with
 * the parent transaction. The queue path is for high-volume / non-
 * critical events.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: AUDIT_EMITTER,
      useFactory: (prisma: PrismaService) => {
        const logger = new Logger('AuditEmitter');
        return new AuditEmitter({
          prisma: prisma.client as unknown as AuditPrismaPort,
          logger: {
            warn: (msg, ctx) => logger.warn(ctx ? `${msg} ${JSON.stringify(ctx)}` : msg),
            error: (msg, ctx) => logger.error(ctx ? `${msg} ${JSON.stringify(ctx)}` : msg),
          },
        });
      },
      inject: [PrismaService],
    },
    AuditQueueBridge,
  ],
  exports: [AUDIT_EMITTER],
})
export class AuditModule {}

interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: object;
}

function parseRedisConnection(url: string): RedisConnectionOptions {
  const u = new URL(url);
  const opts: RedisConnectionOptions = {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
  };
  if (u.username) opts.username = decodeURIComponent(u.username);
  if (u.password) opts.password = decodeURIComponent(u.password);
  if (u.protocol === 'rediss:') opts.tls = {};
  return opts;
}

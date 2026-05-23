import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Queue, Worker, JobsOptions } from 'bullmq';
import { TaskAbandonmentService } from './task-abandonment.service.js';

/**
 * BullMQ-backed sweeper for the task-abandonment timeout (#229).
 *
 * Activation rules mirror the renewal cron (apps/api/src/modules/
 * renewal/renewal.scheduler.ts):
 *   - `OCI_DISABLE_TASK_ABANDONMENT_CRON=1` → fully off (tests,
 *     local-dev where you want to inspect rows manually).
 *   - `REDIS_URL` not set → log a warning and stay off (graceful
 *     degrade so a partially-provisioned env doesn't fail to boot).
 *   - Otherwise → BullMQ Queue + Worker; job repeats every 5 min by
 *     default (`OCI_TASK_ABANDONMENT_CRON` overrides the cron
 *     pattern).
 *
 * Idempotent: the underlying conditional UPDATE only flips rows that
 * are still PENDING / IN_PROGRESS, so two concurrent ticks are safe.
 */
@Injectable()
export class TaskAbandonmentScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TaskAbandonmentScheduler.name);

  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(TaskAbandonmentService) private readonly abandonment: TaskAbandonmentService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.OCI_DISABLE_TASK_ABANDONMENT_CRON === '1') {
      this.logger.log('task-abandonment cron disabled by OCI_DISABLE_TASK_ABANDONMENT_CRON=1');
      return;
    }
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn(
        'task-abandonment cron: REDIS_URL not set — scheduler is off. Set REDIS_URL to activate.',
      );
      return;
    }

    const { Queue, Worker } = await import('bullmq');
    const connection = parseRedisConnection(redisUrl);
    const queueName = 'task-abandonment';

    this.queue = new Queue(queueName, { connection });
    this.worker = new Worker(queueName, async () => this.abandonment.runOnce(), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (_job, err) => {
      this.logger.error(`task-abandonment job failed: ${err.message}`);
    });

    // 5-min default. Frequent enough that a 1h-timeout campaign's
    // expirations land within 5 % of the actual horizon; sparse
    // enough that we're not hammering Postgres.
    const cron = process.env.OCI_TASK_ABANDONMENT_CRON ?? '*/5 * * * *';
    const opts: JobsOptions = { removeOnComplete: 100, removeOnFail: 100 };
    await this.queue.upsertJobScheduler(
      'sweep',
      { pattern: cron, tz: 'UTC' },
      { name: 'sweep-pass', data: {}, opts },
    );
    this.logger.log(`task-abandonment cron scheduled — pattern="${cron}" UTC`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * Force a single sweep on demand. Exposed for the future
   * supervisor admin button and for integration tests; bypasses
   * BullMQ entirely.
   */
  async triggerNow(): Promise<{ scanned: number; expired: number; skipped: number }> {
    return this.abandonment.runOnce();
  }
}

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

import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { Queue, Worker, JobsOptions } from 'bullmq';
import { RenewalService } from './renewal.service.js';

/**
 * BullMQ-backed daily scheduler for the renewal cron (#130).
 *
 * Activation rule:
 *   - `OCI_DISABLE_RENEWAL_CRON=1` → fully off (test/CI/local-dev).
 *   - `REDIS_URL` not set → log a warning and stay off (graceful
 *     degrade so a partially-provisioned env doesn't fail to boot).
 *   - Otherwise → BullMQ Queue + Worker; job is scheduled with a
 *     repeat cron at 02:00 UTC daily.
 *
 * Job payload is empty — the work spans every approved row, so the
 * worker just calls `RenewalService.runOnce()`. Idempotent across
 * multiple worker replicas because the read paths filter on
 * `expiryNoticeSentAt: null` and the auto-revoke updates the row to
 * REVOKED before the next replica looks.
 */
@Injectable()
export class RenewalScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RenewalScheduler.name);

  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(@Inject(RenewalService) private readonly renewal: RenewalService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.OCI_DISABLE_RENEWAL_CRON === '1') {
      this.logger.log('renewal cron disabled by OCI_DISABLE_RENEWAL_CRON=1');
      return;
    }
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn(
        'renewal cron: REDIS_URL not set — scheduler is off. Set REDIS_URL to activate.',
      );
      return;
    }

    // Lazy-import bullmq so the SDK isn't loaded in environments where
    // the scheduler is disabled (CI / test). Saves ~30ms cold start.
    const { Queue, Worker } = await import('bullmq');
    const connection = parseRedisConnection(redisUrl);
    const queueName = 'renewal';

    this.queue = new Queue(queueName, { connection });
    this.worker = new Worker(
      queueName,
      async () => {
        const result = await this.renewal.runOnce();
        return result;
      },
      { connection, concurrency: 1 },
    );

    this.worker.on('failed', (_job, err) => {
      this.logger.error(`renewal job failed: ${err.message}`);
    });

    // Schedule the daily run if not already scheduled. BullMQ's
    // upsertJobScheduler is idempotent — calling it on every boot is
    // safe (it doesn't double-fire).
    const cron = process.env.OCI_RENEWAL_CRON ?? '0 2 * * *'; // 02:00 UTC
    const opts: JobsOptions = { removeOnComplete: 100, removeOnFail: 100 };
    await this.queue.upsertJobScheduler(
      'daily',
      { pattern: cron, tz: 'UTC' },
      { name: 'daily-pass', data: {}, opts },
    );
    this.logger.log(`renewal cron scheduled — pattern="${cron}" UTC`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * Force a single pass on demand. Exposed for the future admin
   * endpoint and for the integration test below; bypasses BullMQ.
   */
  async triggerNow(): Promise<{ noticesSent: number; autoRevoked: number; errors: number }> {
    return this.renewal.runOnce();
  }
}

interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: object;
}

/**
 * Parse a `redis[s]://[user:pass@]host:port` URL into BullMQ-shape
 * connection options. The full URL form (with auth + TLS) is what
 * AWS ElastiCache hands you; CDK provisions it that way.
 */
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

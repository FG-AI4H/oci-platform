import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Queue, Worker, JobsOptions } from 'bullmq';
import { CalibrationService } from './calibration.service.js';

/**
 * BullMQ-backed periodic calibration recompute (#292).
 *
 * Activation rules mirror the abandonment sweeper:
 *   - `OCI_DISABLE_CALIBRATION_CRON=1` → fully off (tests, local-dev)
 *   - `REDIS_URL` not set → warn + stay off (graceful degrade)
 *   - Otherwise → BullMQ Queue + Worker, every 6h by default
 *     (`OCI_CALIBRATION_CRON` overrides).
 *
 * Idempotent: the underlying conditional SELECT-then-INSERT only raises
 * flags that aren't already ACTIVE, so two concurrent ticks are safe.
 */
@Injectable()
export class CalibrationScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CalibrationScheduler.name);

  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(@Inject(CalibrationService) private readonly calibration: CalibrationService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.OCI_DISABLE_CALIBRATION_CRON === '1') {
      this.logger.log('calibration cron disabled by OCI_DISABLE_CALIBRATION_CRON=1');
      return;
    }
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn(
        'calibration cron: REDIS_URL not set — scheduler is off. Set REDIS_URL to activate.',
      );
      return;
    }

    const { Queue, Worker } = await import('bullmq');
    const connection = parseRedisConnection(redisUrl);
    const queueName = 'calibration-recompute';

    this.queue = new Queue(queueName, { connection });
    this.worker = new Worker(queueName, async () => this.calibration.runOnce(), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (_job, err) => {
      this.logger.error(`calibration job failed: ${err.message}`);
    });

    // 6-hour default — calibration is a slow-moving signal and we
    // don't want to thrash Postgres. Override via env for staging
    // recalibration runs.
    const cron = process.env.OCI_CALIBRATION_CRON ?? '0 */6 * * *';
    const opts: JobsOptions = { removeOnComplete: 100, removeOnFail: 100 };
    await this.queue.upsertJobScheduler(
      'recompute',
      { pattern: cron, tz: 'UTC' },
      { name: 'recompute-pass', data: {}, opts },
    );
    this.logger.log(`calibration cron scheduled — pattern="${cron}" UTC`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Force-trigger a recompute on demand (admin button / tests). */
  async triggerNow(): Promise<Awaited<ReturnType<CalibrationService['runOnce']>>> {
    return this.calibration.runOnce();
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

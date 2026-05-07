import { prisma } from '@oci/database';
import pino from 'pino';
import { runOneHarvestCycle } from './harvest.js';

/**
 * Federation harvester entrypoint (PR E.3). Long-running Fargate
 * service: a top-level loop that runs one harvest cycle every
 * `LOOP_INTERVAL_MS`, then waits.
 *
 * Why a continuous loop instead of EventBridge → SQS → Lambda or
 * EventBridge → ECS RunTask:
 *   - The harvest is short (<1 min for a small peer set) but bursty
 *     when a manifest is large. A long-running container with a
 *     constant connection pool to Aurora keeps p99 down.
 *   - SQS would buy us ad-hoc admin triggers. We don't need those
 *     for E.3 (and once we do, the worker can ALSO subscribe to a
 *     queue without changing this loop).
 *
 * Concurrency: each cycle's optimistic claim (see runOneHarvestCycle)
 * makes two workers safe to coexist; a future scale-out for hot peers
 * is just `desiredCount += 1`.
 *
 * Env:
 *   LOOP_INTERVAL_MS         Sleep between cycles. Default 60_000.
 *   HARVEST_INTERVAL_MINUTES Time a peer has to be "due" before being
 *                            picked up. Default 30.
 *   FETCH_TIMEOUT_MS         Per-fetch timeout. Default 30_000.
 *   LOG_LEVEL                pino level. Default "info".
 */
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'worker-ingest' },
});

const LOOP_INTERVAL_MS = parseIntEnv('LOOP_INTERVAL_MS', 60_000);
const HARVEST_INTERVAL_MS = parseIntEnv('HARVEST_INTERVAL_MINUTES', 30) * 60 * 1000;
const FETCH_TIMEOUT_MS = parseIntEnv('FETCH_TIMEOUT_MS', 30_000);

function parseIntEnv(name: string, fallback: number): number {
  const raw = Reflect.get(process.env, name);
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  const n = Number(raw);
  // 0 is a legitimate value (immediate-due harvest, useful in tests
  // and on first deploy when peers should be picked up right away).
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

let stopping = false;
process.on('SIGTERM', () => {
  logger.info('worker:sigterm-received');
  stopping = true;
});
process.on('SIGINT', () => {
  logger.info('worker:sigint-received');
  stopping = true;
});

async function loop(): Promise<void> {
  logger.info(
    { loopMs: LOOP_INTERVAL_MS, harvestMs: HARVEST_INTERVAL_MS, fetchMs: FETCH_TIMEOUT_MS },
    'worker:starting',
  );
  while (!stopping) {
    const startedAt = Date.now();
    try {
      const summary = await runOneHarvestCycle({
        prisma,
        fetchImpl: globalThis.fetch,
        logger,
        intervalMs: HARVEST_INTERVAL_MS,
        fetchTimeoutMs: FETCH_TIMEOUT_MS,
      });
      logger.info({ summary, elapsedMs: Date.now() - startedAt }, 'harvest:cycle-complete');
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : err, elapsedMs: Date.now() - startedAt },
        'harvest:cycle-failed',
      );
    }
    if (stopping) break;
    await sleep(LOOP_INTERVAL_MS);
  }
  logger.info('worker:stopped');
  await prisma.$disconnect().catch(() => {
    /* shutdown — best effort */
  });
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // Don't keep the process alive solely for the sleep when SIGTERM
    // arrives mid-wait.
    t.unref();
  });
}

loop().catch((err) => {
  logger.fatal({ err }, 'worker:fatal');
  process.exit(1);
});

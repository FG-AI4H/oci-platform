import {
  AuditEmitter,
  payloadHash,
  type AuditEventInput,
  type AuditEventRecord,
  type AuditPrismaPort,
  type AuditTransactionPort,
} from '@oci/audit';
import { PrismaClient } from '@oci/database';
import { PrismaPg } from '@prisma/adapter-pg';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import {
  dockerAvailable as checkDocker,
  deployMigrations,
  startPostgres,
} from '../../test-support/migrated-postgres.js';
import { AuditPseudonymiser } from './audit-pseudonym.js';
import { AuditReaderRepository } from './audit-reader.repository.js';
import { AuditReaderService } from './audit-reader.service.js';

/**
 * #774 — the order in which the chain trigger links rows, and the time
 * zone it formats `occurred_at` in, against a real Postgres.
 *
 * Two databases in one container, both migrated up to the migration
 * before the fix:
 *
 * - `repro` keeps the trigger as it was and shows both faults: a row
 *   linked to a stale predecessor while another insert waits on the
 *   chain lock, and a row written by a non-UTC session that the verifier
 *   cannot reproduce. Then it is upgraded: the old break stays where it
 *   is, and what is written from then on verifies from there.
 * - the default database gets rows from the old trigger, then the fix
 *   deployed the way a release deploys it (`prisma migrate deploy`). The
 *   old rows keep verifying, and new rows written by many concurrent
 *   transactions (some rolled back), by non-UTC sessions, and in the
 *   interleaving that broke the old trigger, verify too. Tampering is
 *   still found.
 *
 * Needs a Docker daemon; skipped on a laptop without one, never in CI.
 */
const dockerAvailable = await checkDocker('audit-chain-order.int.spec');

const FIX = '20261125120000_audit_chain_order_utc_774';
const ALICE = '6f1f7b0e-4a53-4c1e-9a8e-2b8f2b1f0c11';
const AUCKLAND = 'Pacific/Auckland';
const TX = { maxWait: 120_000, timeout: 120_000 };

type Raw = Pick<PrismaClient, '$executeRawUnsafe'>;

class RolledBack extends Error {}

function client(url: string, timeZone?: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      max: 40,
      ...(timeZone ? { options: `-c TimeZone=${timeZone}` } : {}),
    }),
  });
}

function reader(prisma: PrismaClient, emitter: AuditEmitter): AuditReaderService {
  return new AuditReaderService(
    new AuditReaderRepository({ client: prisma } as unknown as PrismaService),
    new AuditPseudonymiser(),
    emitter,
  );
}

function event(action: string, subjectId: string, payload: Record<string, unknown>) {
  return {
    module: 'test',
    action,
    subjectType: 'thing',
    subjectId,
    actorUserId: ALICE,
    payload,
  } satisfies AuditEventInput;
}

/** An insert as a reviewed SQL statement writes one (ADR-0028): every default, no actor. */
async function rawInsert(db: Raw, subjectId: string, payload: Record<string, unknown>) {
  await db.$executeRawUnsafe(
    `INSERT INTO platform.audit_events (module, action, subject_type, subject_id, actor_roles, payload, payload_hash)
     VALUES ('test', 'chain.raw', 'thing', $1, ARRAY['operator'], $2::jsonb, $3)`,
    subjectId,
    JSON.stringify(payload),
    payloadHash(payload),
  );
}

interface Link {
  sequenceNumber: bigint;
  previousHash: string | null;
  recordHash: string;
}

async function links(prisma: PrismaClient, from = 0n): Promise<Link[]> {
  return prisma.auditEvent.findMany({
    where: { sequenceNumber: { gte: from } },
    orderBy: { sequenceNumber: 'asc' },
    select: { sequenceNumber: true, previousHash: true, recordHash: true },
  });
}

/**
 * Every way the stored links can disagree with sequence order, counted
 * over the whole trail rather than stopping at the first, as the
 * verifier does: rows that do not point at the row before them, rows
 * that share a predecessor (a fork), and holes in the numbering.
 */
function linkFaults(rows: Link[]): { misLinked: number; forks: number; gaps: number } {
  let misLinked = 0;
  let gaps = 0;
  const seen = new Set<string>();
  let forks = 0;
  rows.forEach((row, i) => {
    const before = rows[i - 1];
    if (before && row.previousHash !== before.recordHash) misLinked += 1;
    if (before && row.sequenceNumber !== before.sequenceNumber + 1n) gaps += 1;
    const key = row.previousHash ?? '';
    if (seen.has(key)) forks += 1;
    seen.add(key);
  });
  return { misLinked, forks, gaps };
}

async function lockWaiters(prisma: PrismaClient): Promise<number> {
  const [row] = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
  );
  return row?.n ?? 0;
}

async function untilLockWaiter(prisma: PrismaClient): Promise<void> {
  const deadline = Date.now() + 20_000;
  while ((await lockWaiters(prisma)) === 0) {
    if (Date.now() > deadline) throw new Error('no insert ever waited on the chain lock');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * The interleaving that broke the old trigger, made deterministic: a
 * transaction writes an event and keeps the chain lock; a second writer
 * starts its insert (which takes its sequence number, then waits on the
 * lock); the first transaction writes another event and commits.
 */
async function interleave(
  prisma: PrismaClient,
  emitter: AuditEmitter,
  tag: string,
): Promise<{ first: AuditEventRecord; second: AuditEventRecord; waiter: AuditEventRecord }> {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let wroteFirst!: () => void;
  const firstWritten = new Promise<void>((r) => (wroteFirst = r));

  const holder = prisma.$transaction(async (tx) => {
    const port = tx as unknown as AuditTransactionPort;
    const first = await emitter.emitSync(event('interleave.first', tag, { tag, n: 1 }), port);
    wroteFirst();
    await gate;
    const second = await emitter.emitSync(event('interleave.second', tag, { tag, n: 2 }), port);
    return { first, second };
  }, TX);
  await firstWritten;
  const waiting = emitter.emitSync(event('interleave.waiter', tag, { tag, n: 3 }));
  await untilLockWaiter(prisma);
  release();
  const [{ first, second }, waiter] = await Promise.all([holder, waiting]);
  return { first, second, waiter };
}

/**
 * One round of `parallel` transactions, each on its own connection,
 * writing one to three events through the writer and as raw SQL, with
 * a pause while it holds the lock, every sixth one rolled back.
 */
async function concurrentRound(
  prisma: PrismaClient,
  emitter: AuditEmitter,
  round: number,
  parallel: number,
  maxRows = 3,
): Promise<{ committed: number; rolledBack: number }> {
  let committed = 0;
  let rolledBack = 0;
  await Promise.all(
    Array.from({ length: parallel }, async (_, writer) => {
      const rows = 1 + (writer % maxRows);
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SELECT 1 FROM pg_sleep(${(writer % 4) / 1000})`);
          for (let n = 0; n < rows; n += 1) {
            const payload = { round, writer, n };
            if ((writer + n) % 2 === 0) {
              await emitter.emitSync(
                event('chain.concurrent', `r${round}-w${writer}`, payload),
                tx as unknown as AuditTransactionPort,
              );
            } else {
              await rawInsert(tx, `r${round}-w${writer}`, payload);
            }
            await tx.$executeRawUnsafe(`SELECT 1 FROM pg_sleep(0.001)`);
          }
          if (writer % 6 === 5) throw new RolledBack();
        }, TX);
        committed += rows;
      } catch (err) {
        if (!(err instanceof RolledBack)) throw err;
        rolledBack += rows;
      }
    }),
  );
  return { committed, rolledBack };
}

describe.skipIf(!dockerAvailable)('audit chain order and time zone (#774)', () => {
  let container: StartedPostgreSqlContainer;
  const clients: PrismaClient[] = [];
  let reproUrl: string;
  let url: string;

  function open(at: string, timeZone?: string): PrismaClient {
    const c = client(at, timeZone);
    clients.push(c);
    return c;
  }

  beforeAll(async () => {
    process.env.OCI_AUDIT_PSEUDONYM_KEY = 'integration-test-pseudonym-key-0123456789';
    container = await startPostgres();
    url = container.getConnectionUri();
    const admin = open(url);
    await admin.$executeRawUnsafe(`CREATE DATABASE repro`);
    const parsed = new URL(url);
    parsed.pathname = '/repro';
    reproUrl = parsed.toString();
    deployMigrations(reproUrl, { before: FIX });
    deployMigrations(url, { before: FIX });
  }, 240_000);

  afterAll(async () => {
    delete process.env.OCI_AUDIT_PSEUDONYM_KEY;
    await Promise.all(clients.map((c) => c.$disconnect()));
    await container?.stop();
  });

  describe('the trigger before the fix', () => {
    let prisma: PrismaClient;
    let emitter: AuditEmitter;

    beforeAll(() => {
      prisma = open(reproUrl);
      emitter = new AuditEmitter({ prisma: prisma as unknown as AuditPrismaPort });
    });

    it('links a row to a stale predecessor while another insert waits on the lock', async () => {
      const { first, second, waiter } = await interleave(prisma, emitter, 'repro');
      // The waiter took its number before the second row did, so it sits
      // between them in sequence order, but the second row was linked
      // while the waiter's row did not exist yet.
      expect(waiter.sequenceNumber).toBe(first.sequenceNumber + 1n);
      expect(second.sequenceNumber).toBe(first.sequenceNumber + 2n);
      expect(waiter.previousHash).toBe(first.recordHash);
      expect(second.previousHash).toBe(first.recordHash);
      expect(await reader(prisma, emitter).verify({})).toMatchObject({
        status: 'broken',
        firstBreak: { id: second.id, kind: 'previous-hash', actual: first.recordHash },
      });
    });

    it('stores a hash for a non-UTC session that the verifier does not reproduce', async () => {
      const auckland = open(reproUrl, AUCKLAND);
      await rawInsert(auckland, 'tz', { zone: AUCKLAND });
      const row = await prisma.auditEvent.findFirstOrThrow({
        where: { subjectId: 'tz' },
      });
      expect(
        await reader(prisma, emitter).verify({ fromSequence: row.sequenceNumber.toString() }),
      ).toMatchObject({ status: 'broken', firstBreak: { id: row.id, kind: 'record-hash' } });
    });

    it('a trail the old trigger already broke: the break stays, rows written after the upgrade verify from there', async () => {
      await concurrentRound(prisma, emitter, 0, 24);
      const lastOld = (await links(prisma)).at(-1)!;
      deployMigrations(reproUrl);
      await concurrentRound(prisma, emitter, 1, 24);

      const fresh = await links(prisma, lastOld.sequenceNumber + 1n);
      expect(linkFaults([lastOld, ...fresh])).toEqual({ misLinked: 0, forks: 0, gaps: 0 });
      const audit = reader(prisma, emitter);
      expect(
        await audit.verify({ fromSequence: (lastOld.sequenceNumber + 1n).toString() }),
      ).toMatchObject({
        status: 'intact',
        checked: fresh.length,
        anchor: { sequenceNumber: lastOld.sequenceNumber.toString() },
      });
      expect((await audit.verify({})).status).toBe('broken');
    }, 300_000);
  });

  describe('a populated trail upgraded to the fixed trigger', () => {
    let prisma: PrismaClient;
    let emitter: AuditEmitter;
    let before: Link[];

    beforeAll(() => {
      prisma = open(url);
      emitter = new AuditEmitter({ prisma: prisma as unknown as AuditPrismaPort });
    });

    async function expectIntact(): Promise<void> {
      const all = await links(prisma);
      expect(await reader(prisma, emitter).verify({})).toMatchObject({
        status: 'intact',
        checked: all.length,
        complete: true,
        firstBreak: null,
      });
    }

    it('rows the old trigger wrote one at a time verify before the upgrade', async () => {
      for (let i = 0; i < 4; i += 1) {
        await emitter.emitSync(event('legacy.emit', `legacy-${i}`, { i }));
        await rawInsert(prisma, `legacy-raw-${i}`, { i });
      }
      await emitter.emitSync({
        ...event('legacy.explicit-time', 'legacy-t', { t: 1 }),
        occurredAt: new Date('2026-11-20T09:15:30.123Z'),
      });
      await prisma.$transaction(async (tx) => {
        const port = tx as unknown as AuditTransactionPort;
        await emitter.emitSync(event('legacy.tx', 'legacy-tx', { n: 1 }), port);
        await emitter.emitSync(event('legacy.tx', 'legacy-tx', { n: 2 }), port);
      });
      before = await links(prisma);
      expect(before).toHaveLength(11);
      await expectIntact();
    });

    it('the upgrade applies the fix and leaves every existing row as it was, still verifying', async () => {
      deployMigrations(url);
      const applied = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL`,
        FIX,
      );
      expect(applied[0]?.n).toBe(1);
      expect(await links(prisma)).toEqual(before);
      await expectIntact();
    });

    it('a row written while another waits on the lock links to the true predecessor', async () => {
      const { first, second, waiter } = await interleave(prisma, emitter, 'fixed');
      expect(second.sequenceNumber).toBe(first.sequenceNumber + 1n);
      expect(second.previousHash).toBe(first.recordHash);
      expect(waiter.sequenceNumber).toBe(second.sequenceNumber + 1n);
      expect(waiter.previousHash).toBe(second.recordHash);
      await expectIntact();
    });

    it('many concurrent transactions, some rolled back, leave a chain with no break, fork or gap', async () => {
      const start = (await links(prisma)).at(-1)!.sequenceNumber + 1n;
      let committed = 0;
      let rolledBack = 0;
      for (let round = 0; round < 4; round += 1) {
        const r = await concurrentRound(prisma, emitter, round, 24);
        committed += r.committed;
        rolledBack += r.rolledBack;
      }
      expect(rolledBack).toBeGreaterThan(0);

      const written = await links(prisma, start);
      expect(written).toHaveLength(committed);
      expect(written[0]!.sequenceNumber).toBe(start);
      expect(linkFaults(written)).toEqual({ misLinked: 0, forks: 0, gaps: 0 });
      await expectIntact();
    }, 300_000);

    it('rows written by a session in another time zone verify', async () => {
      const auckland = open(url, AUCKLAND);
      const auditAuckland = new AuditEmitter({ prisma: auckland as unknown as AuditPrismaPort });
      await rawInsert(auckland, 'tz-session', { zone: AUCKLAND });
      await auditAuckland.emitSync(event('tz.session', 'tz-session', { zone: AUCKLAND }));
      await auditAuckland.emitSync({
        ...event('tz.session.explicit', 'tz-session', { zone: AUCKLAND }),
        occurredAt: new Date('2026-12-17T08:00:00.007Z'),
      });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${AUCKLAND}'`);
        await rawInsert(tx, 'tz-local', { zone: AUCKLAND, local: true });
        await emitter.emitSync(
          event('tz.local', 'tz-local', { zone: AUCKLAND }),
          tx as unknown as AuditTransactionPort,
        );
      });
      await rawInsert(prisma, 'tz-utc', { zone: 'UTC' });

      // The verifier's own formatting: the stored value as UTC.
      const explicit = await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'tz.session.explicit' },
      });
      expect(explicit.occurredAt.toISOString()).toBe('2026-12-17T08:00:00.007Z');
      await expectIntact();
    });

    it('a REPEATABLE READ transaction whose snapshot misses a newer row fails rather than fork', async () => {
      let snapshotTaken!: () => void;
      const taken = new Promise<void>((r) => (snapshotTaken = r));
      let otherCommitted!: () => void;
      const committed = new Promise<void>((r) => (otherCommitted = r));

      const stale = prisma.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM platform.audit_events`);
          snapshotTaken();
          await committed;
          await emitter.emitSync(
            event('rr.stale', 'rr', { n: 1 }),
            tx as unknown as AuditTransactionPort,
          );
        },
        { ...TX, isolationLevel: 'RepeatableRead' },
      );
      // Keep the rejection handled while the other writer runs.
      const outcome = stale.then(
        () => null,
        (err: unknown) => err,
      );
      await taken;
      await emitter.emitSync(event('rr.newer', 'rr', { n: 2 }));
      otherCommitted();

      const err = await outcome;
      expect(err).toBeInstanceOf(Error);
      expect(String((err as Error).message)).toMatch(/sequence_number/);
      await expectIntact();
    });

    describe('tampering after the upgrade is still found', () => {
      /** Runs `sql` with the table's triggers off, as only a database superuser can. */
      async function tamper(sql: string): Promise<void> {
        await prisma.$transaction([
          prisma.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
          prisma.$executeRawUnsafe(sql),
        ]);
      }

      it('a changed payload, at that row', async () => {
        const target = await prisma.auditEvent.findFirstOrThrow({
          where: { action: 'chain.concurrent' },
          orderBy: { sequenceNumber: 'desc' },
        });
        await tamper(
          `UPDATE platform.audit_events SET payload = '{"forged":true}' WHERE id = '${target.id}'`,
        );
        expect(await reader(prisma, emitter).verify({})).toMatchObject({
          status: 'broken',
          firstBreak: { id: target.id, kind: 'payload-hash' },
        });
        await tamper(
          `UPDATE platform.audit_events SET payload = '${JSON.stringify(target.payload)}' WHERE id = '${target.id}'`,
        );
        await expectIntact();
      });

      it('a changed time stamp, at that row', async () => {
        const target = await prisma.auditEvent.findFirstOrThrow({
          where: { action: 'tz.session' },
        });
        await tamper(
          `UPDATE platform.audit_events SET occurred_at = occurred_at + interval '1 hour' WHERE id = '${target.id}'`,
        );
        expect(await reader(prisma, emitter).verify({})).toMatchObject({
          status: 'broken',
          firstBreak: { id: target.id, kind: 'record-hash' },
        });
      });
    });
  });
});

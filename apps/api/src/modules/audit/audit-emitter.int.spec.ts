import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditEmitter, type AuditPrismaPort } from '@oci/audit';
import { PrismaClient } from '@oci/database';
import { PrismaPg } from '@prisma/adapter-pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { getContainerRuntimeClient } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * #628 — `emitSync` against a real Postgres with every migration
 * applied, so the hash-chain trigger and the Prisma client validation
 * both run. The unit spec in `@oci/audit` mocks the client and so
 * cannot catch a Prisma-side "Argument `recordHash` is missing".
 *
 * Needs a Docker daemon. CI (`CI=true`) always has one and runs this
 * spec; a laptop without Docker skips it rather than failing `pnpm test`.
 */
const dockerAvailable = await getContainerRuntimeClient().then(
  () => true,
  () => false,
);
if (!dockerAvailable && process.env.CI) {
  throw new Error('audit-emitter.int.spec: no Docker daemon reachable in CI');
}

const DATABASE_PKG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../packages/database',
);

describe.skipIf(!dockerAvailable)('AuditEmitter.emitSync against Postgres (#628)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let emitter: AuditEmitter;

  beforeAll(async () => {
    // Same major as infra/local/docker-compose.yml and Aurora.
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const url = container.getConnectionUri();
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: DATABASE_PKG,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    emitter = new AuditEmitter({ prisma: prisma as unknown as AuditPrismaPort });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('persists rows whose recordHash the trigger computed and whose previousHash links the chain', async () => {
    const actorUserId = '6f1f7b0e-4a53-4c1e-9a8e-2b8f2b1f0c11';
    const first = await emitter.emitSync({
      module: 'test',
      action: 'chain.first',
      subjectType: 'thing',
      subjectId: 'a',
      actorUserId,
      payload: { n: 1 },
    });
    const second = await emitter.emitSync({
      module: 'test',
      action: 'chain.second',
      subjectType: 'thing',
      subjectId: 'b',
      payload: { n: 2 },
    });

    expect(first.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.previousHash).toBeNull();
    expect(second.previousHash).toBe(first.recordHash);

    // Recompute the trigger's canonical form (migration
    // 20260517100000_audit_events_257) so the stored hash is proven
    // correct, not merely non-empty.
    for (const row of [first, second]) {
      const canonical = [
        row.module,
        row.action,
        row.subjectType,
        row.subjectId,
        row.occurredAt.toISOString(),
        row.sequenceNumber.toString(),
        row.actorUserId ?? '',
        row.payloadHash,
        row.previousHash ?? '',
      ].join('|');
      expect(row.recordHash).toBe(createHash('sha256').update(canonical).digest('hex'));
    }

    // What came back from INSERT … RETURNING is what is stored.
    const stored = await prisma.auditEvent.findUniqueOrThrow({ where: { id: second.id } });
    expect(stored.recordHash).toBe(second.recordHash);
    expect(stored.previousHash).toBe(first.recordHash);
  });

  it('rolls the audit row back with the surrounding transaction', async () => {
    const before = await prisma.auditEvent.count();
    await expect(
      prisma.$transaction(async (tx) => {
        await emitter.emitSync(
          {
            module: 'test',
            action: 'tx.rolled-back',
            subjectType: 'thing',
            subjectId: 'c',
            payload: {},
          },
          tx as unknown as AuditPrismaPort,
        );
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');
    expect(await prisma.auditEvent.count()).toBe(before);
  });
});

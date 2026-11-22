import { AuditEmitter, payloadHash, recordHash, type AuditPrismaPort } from '@oci/audit';
import type { PrismaClient } from '@oci/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  startMigratedPostgres,
} from '../../test-support/migrated-postgres.js';
import { AuditPseudonymiser } from './audit-pseudonym.js';
import { AuditReaderRepository } from './audit-reader.repository.js';
import { AuditReaderService } from './audit-reader.service.js';

/**
 * #653 — the reader against a real Postgres with every migration
 * applied: events written through the real writer (and one the way a
 * one-off statement writes it, ADR-0028), chained by the real trigger,
 * verified by the reader, then altered directly in the table, past the
 * append-only triggers, as someone with database access could.
 *
 * Needs a Docker daemon; skipped on a laptop without one, never in CI.
 */
const dockerAvailable = await checkDocker('audit-chain.int.spec');

const ALICE = '6f1f7b0e-4a53-4c1e-9a8e-2b8f2b1f0c11';
const BOB = '7a2e8c1f-5b64-4d2f-8b9f-3c9a3c2a1d22';

describe.skipIf(!dockerAvailable)('audit trail reader against Postgres (#653)', () => {
  let db: MigratedPostgres;
  let prisma: PrismaClient;
  let reader: AuditReaderService;
  let ids: string[];

  /** Runs `sql` with the table's triggers off, as only a database superuser can. */
  async function tamper(sql: string): Promise<void> {
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
      prisma.$executeRawUnsafe(sql),
    ]);
  }

  beforeAll(async () => {
    db = await startMigratedPostgres();
    prisma = db.prisma;
    const emitter = new AuditEmitter({ prisma: prisma as unknown as AuditPrismaPort });
    process.env.OCI_AUDIT_PSEUDONYM_KEY = 'integration-test-pseudonym-key-0123456789';
    reader = new AuditReaderService(
      new AuditReaderRepository({ client: prisma } as unknown as PrismaService),
      new AuditPseudonymiser(),
      emitter,
    );

    const written = [];
    written.push(
      await emitter.emitSync({
        module: 'prediction',
        action: 'modelcard.created',
        subjectType: 'model-card',
        subjectId: 'card-1',
        actorUserId: ALICE,
        actorRoles: ['host'],
        payload: { slug: 'card-1', version: '1.0.0' },
      }),
    );
    written.push(
      await emitter.emitSync({
        module: 'identity',
        action: 'role.granted',
        subjectType: 'user',
        subjectId: BOB,
        actorUserId: ALICE,
        payload: { actorUsername: 'alice', targetUsername: 'bob', group: 'regulator' },
      }),
    );
    // As a one-off statement writes it (ADR-0028): no actor, payload hash
    // computed outside the emitter, chained by the trigger all the same.
    const sqlPayload = { run: 'r-1', statement: 'noop' };
    await prisma.$executeRawUnsafe(
      `INSERT INTO platform.audit_events (module, action, subject_type, subject_id, actor_roles, payload, payload_hash)
       VALUES ('platform', 'sql.statement_applied', 'one-off-run', 'r-1', ARRAY['operator'], $1::jsonb, $2)`,
      JSON.stringify(sqlPayload),
      payloadHash(sqlPayload),
    );
    for (let i = 2; i <= 4; i += 1) {
      written.push(
        await emitter.emitSync({
          module: 'prediction',
          action: 'modelcard.status.changed',
          subjectType: 'model-card',
          subjectId: 'card-1',
          actorUserId: i % 2 === 0 ? BOB : ALICE,
          payload: { slug: 'card-1', step: i },
        }),
      );
    }
    const all = await prisma.auditEvent.findMany({ orderBy: { sequenceNumber: 'asc' } });
    ids = all.map((r) => r.id);
    expect(ids).toHaveLength(6);
  }, 180_000);

  afterAll(async () => {
    delete process.env.OCI_AUDIT_PSEUDONYM_KEY;
    await db?.stop();
  });

  it('the record-hash rule in @oci/audit gives what the trigger stored, for every row', async () => {
    const rows = await prisma.auditEvent.findMany({ orderBy: { sequenceNumber: 'asc' } });
    for (const row of rows) expect(recordHash(row)).toBe(row.recordHash);
  });

  it('verifies the chain written by the writer and the trigger as intact', async () => {
    expect(await reader.verify({})).toMatchObject({
      status: 'intact',
      checked: 6,
      anchor: null,
      complete: true,
      firstBreak: null,
    });
  });

  it('detects a payload changed in place, at that row', async () => {
    const target = ids[3]!;
    const original = await prisma.auditEvent.findUniqueOrThrow({ where: { id: target } });
    await tamper(
      `UPDATE platform.audit_events SET payload = '{"slug":"card-1","step":99}' WHERE id = '${target}'`,
    );
    expect(await reader.verify({})).toMatchObject({
      status: 'broken',
      checked: 4,
      firstBreak: {
        id: target,
        sequenceNumber: original.sequenceNumber.toString(),
        kind: 'payload-hash',
        actual: original.payloadHash,
      },
    });
    await tamper(
      `UPDATE platform.audit_events SET payload = '${JSON.stringify(original.payload)}' WHERE id = '${target}'`,
    );
    expect((await reader.verify({})).status).toBe('intact');
  });

  it('detects a covered field changed in place, at that row', async () => {
    const target = ids[1]!;
    await tamper(`UPDATE platform.audit_events SET subject_id = 'someone-else' WHERE id = '${target}'`);
    expect(await reader.verify({})).toMatchObject({
      status: 'broken',
      firstBreak: { id: target, kind: 'record-hash' },
    });
    await tamper(`UPDATE platform.audit_events SET subject_id = '${BOB}' WHERE id = '${target}'`);
    expect((await reader.verify({})).status).toBe('intact');
  });

  it('detects a row rewritten with a recomputed record hash, at the next row', async () => {
    const target = ids[4]!;
    const original = await prisma.auditEvent.findUniqueOrThrow({ where: { id: target } });
    const other = original.actorUserId === ALICE ? BOB : ALICE;
    const forged = { ...original, actorUserId: other };
    await tamper(
      `UPDATE platform.audit_events SET actor_user_id = '${other}', record_hash = '${recordHash(forged)}' WHERE id = '${target}'`,
    );
    expect(await reader.verify({})).toMatchObject({
      status: 'broken',
      firstBreak: { id: ids[5], kind: 'previous-hash', actual: original.recordHash },
    });
    // A range that starts at the forged row anchors on the row before it,
    // which is intact, and stops before the next one: it passes.
    expect(
      await reader.verify({
        fromSequence: original.sequenceNumber.toString(),
        toSequence: original.sequenceNumber.toString(),
      }),
    ).toMatchObject({ status: 'intact', checked: 1 });
    await tamper(
      `UPDATE platform.audit_events SET actor_user_id = '${original.actorUserId}', record_hash = '${original.recordHash}' WHERE id = '${target}'`,
    );
    expect((await reader.verify({})).status).toBe('intact');
  });

  it('lists through the real queries: filters, cursor, and a regulator’s pseudonyms', async () => {
    const admin = { sub: ALICE, groups: ['admin'] };
    const regulator = { sub: BOB, groups: ['regulator'] };

    const firstPage = await reader.list({ limit: 4, order: 'desc' }, admin);
    expect(firstPage.events).toHaveLength(4);
    const rest = await reader.list(
      { limit: 4, order: 'desc', cursor: firstPage.nextCursor! },
      admin,
    );
    expect(rest.events).toHaveLength(2);
    expect(rest.nextCursor).toBeNull();

    const system = await reader.list({ limit: 50, order: 'asc', actor: 'system' }, admin);
    expect(system.events.map((e) => e.eventType)).toEqual(['platform.sql.statement_applied']);

    const asRegulator = await reader.list({ limit: 50, order: 'asc' }, regulator);
    const grant = asRegulator.events.find((e) => e.eventType === 'identity.role.granted')!;
    expect(grant.actor.kind).toBe('pseudonym');
    expect(JSON.stringify(asRegulator)).not.toContain(ALICE);
    expect(JSON.stringify(asRegulator)).not.toContain(BOB);

    const pseudonym = grant.actor.kind === 'pseudonym' ? grant.actor.id : '';
    const byActor = await reader.list({ limit: 50, order: 'asc', actor: pseudonym }, regulator);
    expect(byActor.events.length).toBeGreaterThan(0);
    expect(byActor.events.every((e) => e.actor.kind === 'pseudonym' && e.actor.id === pseudonym)).toBe(
      true,
    );

    const aboutBob = await reader.list(
      { limit: 50, order: 'asc', subjectId: grant.subjectId },
      regulator,
    );
    expect(aboutBob.events.map((e) => e.id)).toEqual([grant.id]);
  });

  it('records an export in the trail, chained like any other event', async () => {
    const file = await reader.export('csv', { subjectType: 'model-card' }, { sub: BOB, groups: ['regulator'] });
    const recorded = await prisma.auditEvent.findFirstOrThrow({
      where: { module: 'audit', action: 'events.exported' },
    });
    expect(recorded.subjectId).toBe(file.exportId);
    expect(recorded.payload).toMatchObject({ format: 'csv', eventCount: 4, contentSha256: file.sha256 });
    expect(await reader.verify({})).toMatchObject({ status: 'intact', checked: 7 });
  });

  it('detects a deleted row, at the row after it', async () => {
    const target = ids[2]!;
    await tamper(`DELETE FROM platform.audit_events WHERE id = '${target}'`);
    expect(await reader.verify({})).toMatchObject({
      status: 'broken',
      firstBreak: { id: ids[3], kind: 'previous-hash' },
    });
  });
});

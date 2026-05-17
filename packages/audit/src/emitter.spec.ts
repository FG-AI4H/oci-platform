import { describe, expect, it, vi } from 'vitest';
import { AuditEmitter, type AuditPrismaPort, type AuditQueuePort } from './emitter.js';

function fakePrisma(): { client: AuditPrismaPort; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'evt-1',
    sequenceNumber: 1n,
    occurredAt: new Date('2026-05-17T10:00:00Z'),
    module: args.data.module,
    action: args.data.action,
    subjectType: args.data.subjectType,
    subjectId: args.data.subjectId,
    actorUserId: (args.data.actorUserId ?? null) as string | null,
    actorRoles: (args.data.actorRoles ?? []) as string[],
    payload: args.data.payload,
    payloadHash: args.data.payloadHash,
    previousHash: null,
    recordHash: 'hash-set-by-trigger',
    retentionClass: (args.data.retentionClass ?? 'standard-7y') as
      | 'short-1y'
      | 'standard-7y'
      | 'legal-hold',
  }));
  const client = {
    auditEvent: { create },
    $transaction: vi.fn(async (fn) => fn(client as unknown as AuditPrismaPort)),
  } as unknown as AuditPrismaPort;
  return { client, create: create as ReturnType<typeof vi.fn> };
}

describe('AuditEmitter.emitSync', () => {
  it('computes payloadHash and forwards the input to the Prisma create call', async () => {
    const { client, create } = fakePrisma();
    const emitter = new AuditEmitter({ prisma: client });
    await emitter.emitSync({
      module: 'catalog',
      action: 'dataset.published',
      subjectType: 'dataset',
      subjectId: 'ds-1',
      actorUserId: '00000000-0000-0000-0000-000000000001',
      actorRoles: ['operator'],
      payload: { name: 'demo' },
    });
    expect(create).toHaveBeenCalledOnce();
    const data = (create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.module).toBe('catalog');
    expect(data.actorRoles).toEqual(['operator']);
    expect(typeof data.payloadHash).toBe('string');
    expect((data.payloadHash as string).length).toBe(64); // sha256 hex
  });

  it('persists through a passed-in transaction when provided', async () => {
    const root = fakePrisma();
    const tx = fakePrisma();
    const emitter = new AuditEmitter({ prisma: root.client });
    await emitter.emitSync(
      {
        module: 'identity',
        action: 'role.granted',
        subjectType: 'user',
        subjectId: 'u-1',
        payload: { role: 'curator' },
      },
      tx.client,
    );
    expect(tx.create).toHaveBeenCalledOnce();
    expect(root.create).not.toHaveBeenCalled();
  });
});

describe('AuditEmitter.emit', () => {
  it('enqueues onto the BullMQ port when wired and does not call Prisma directly', async () => {
    const { client, create } = fakePrisma();
    const enqueue = vi.fn(async () => undefined);
    const queue: AuditQueuePort = { enqueue };
    const emitter = new AuditEmitter({ prisma: client, queue });
    await emitter.emit({
      module: 'access-request',
      action: 'submitted',
      subjectType: 'access-request',
      subjectId: 'ar-1',
      payload: { datasetId: 'ds-1' },
    });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it('falls back to inline persistence when the queue fails (degraded mode)', async () => {
    const { client, create } = fakePrisma();
    const enqueue = vi.fn(async () => {
      throw new Error('redis down');
    });
    const logger = { warn: vi.fn(), error: vi.fn() };
    const emitter = new AuditEmitter({ prisma: client, queue: { enqueue }, logger });
    await emitter.emit({
      module: 'access-request',
      action: 'submitted',
      subjectType: 'access-request',
      subjectId: 'ar-1',
      payload: {},
    });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalled();
  });

  it('never throws from emit even when the inline insert fails (fire-and-forget contract)', async () => {
    const failingPrisma: AuditPrismaPort = {
      auditEvent: {
        create: vi.fn(async () => {
          throw new Error('db unreachable');
        }) as unknown as AuditPrismaPort['auditEvent']['create'],
      },
      $transaction: vi.fn(),
    };
    const logger = { warn: vi.fn(), error: vi.fn() };
    const emitter = new AuditEmitter({ prisma: failingPrisma, logger });
    await expect(
      emitter.emit({
        module: 'x',
        action: 'y',
        subjectType: 's',
        subjectId: '1',
        payload: {},
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

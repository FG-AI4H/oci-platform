import { createHash } from 'node:crypto';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { payloadHash, recordHash, type AuditEmitter, type AuditEventInput } from '@oci/audit';
import type { AuditEvent } from '@oci/database';
import { AUDIT_EXPORT_MAX, type AuditEventsQuery } from '@oci/shared-types';
import { describe, expect, it, vi } from 'vitest';
import type { AuditPseudonymiser } from './audit-pseudonym.js';
import type { AuditReaderRepository, AuditRowFilter } from './audit-reader.repository.js';
import {
  AuditReaderService,
  decodeCursor,
  encodeCursor,
  hidePeople,
} from './audit-reader.service.js';

const ALICE = '6f1f7b0e-4a53-4c1e-9a8e-2b8f2b1f0c11';
const BOB = '7a2e8c1f-5b64-4d2f-8b9f-3c9a3c2a1d22';

function row(
  seq: number,
  over: Partial<AuditEvent> = {},
  previous: string | null = null,
): AuditEvent {
  const payload = (over.payload ?? { slug: `card-${seq}` }) as Record<string, unknown>;
  const base = {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    occurredAt: new Date(Date.UTC(2026, 10, 22, 9, 0, seq)),
    emittedAt: new Date(Date.UTC(2026, 10, 22, 9, 0, seq)),
    sequenceNumber: BigInt(seq),
    module: 'prediction',
    action: 'modelcard.created',
    subjectType: 'model-card',
    subjectId: `card-${seq}`,
    actorUserId: ALICE,
    actorRoles: ['host'],
    retentionClass: 'standard-7y',
    previousHash: previous,
    ...over,
    payload,
    payloadHash: payloadHash(payload),
  };
  return { ...base, recordHash: recordHash(base) } as AuditEvent;
}

function chainOf(...rows: AuditEvent[]): AuditEvent[] {
  let prev: string | null = null;
  return rows.map((r) => {
    const fixed = { ...r, previousHash: prev };
    const out = { ...fixed, recordHash: recordHash(fixed) };
    prev = out.recordHash;
    return out;
  });
}

/** In-memory stand-in for the repository: the int spec runs the real one. */
function fakeRepo(rows: AuditEvent[]) {
  const matches = (r: AuditEvent, f: AuditRowFilter) =>
    (!f.subjectTypes || f.subjectTypes.includes(r.subjectType)) &&
    (!f.excludeSubjectTypes || !f.excludeSubjectTypes.includes(r.subjectType)) &&
    (!f.subjectIds || f.subjectIds.includes(r.subjectId)) &&
    (f.actorUserIds === undefined ||
      (f.actorUserIds === null
        ? r.actorUserId === null
        : r.actorUserId !== null && f.actorUserIds.includes(r.actorUserId))) &&
    (!f.module || f.module === r.module) &&
    (!f.action || f.action === r.action);
  const repo = {
    page: vi.fn(async ({ filter, order, after, take }) => {
      const sorted = rows
        .filter((r) => matches(r, filter))
        .filter((r) =>
          after === null
            ? true
            : order === 'desc'
              ? r.sequenceNumber < after
              : r.sequenceNumber > after,
        )
        .sort((a, b) =>
          Number(
            order === 'desc'
              ? b.sequenceNumber - a.sequenceNumber
              : a.sequenceNumber - b.sequenceNumber,
          ),
        );
      return sorted.slice(0, take);
    }),
    distinctActorIds: vi.fn(async () => [
      ...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => x !== null)),
    ]),
    distinctSubjectIds: vi.fn(async (types: readonly string[]) => [
      ...new Set(rows.filter((r) => types.includes(r.subjectType)).map((r) => r.subjectId)),
    ]),
    sequenceSpan: vi.fn(),
    eventBefore: vi.fn(async (seq: bigint) => {
      const before = rows.filter((r) => r.sequenceNumber < seq).at(-1);
      return before
        ? { sequenceNumber: before.sequenceNumber, recordHash: before.recordHash }
        : null;
    }),
    chainBatch: vi.fn(async (from: bigint, to: bigint | null, take: number) =>
      rows
        .filter((r) => r.sequenceNumber >= from && (to === null || r.sequenceNumber <= to))
        .slice(0, take),
    ),
  };
  return repo;
}

const pseudo = (configured = true) =>
  ({
    configured,
    pseudonym: (v: string) =>
      configured ? `ps-${createHash('sha256').update(v).digest('hex').slice(0, 24)}` : null,
  }) as unknown as AuditPseudonymiser;

function service(rows: AuditEvent[], configured = true) {
  const repo = fakeRepo(rows);
  const emitted: AuditEventInput[] = [];
  const audit = {
    emitSync: vi.fn(async (input: AuditEventInput) => {
      emitted.push(input);
      return {};
    }),
  } as unknown as AuditEmitter;
  const svc = new AuditReaderService(
    repo as unknown as AuditReaderRepository,
    pseudo(configured),
    audit,
  );
  return { svc, repo, emitted, p: pseudo(configured) };
}

const admin = { sub: ALICE, groups: ['admin'] };
const regulator = { sub: BOB, groups: ['regulator'] };
const q = (over: Partial<AuditEventsQuery> = {}): AuditEventsQuery => ({
  limit: 50,
  order: 'desc',
  ...over,
});

describe('AuditReaderService — what each reader sees', () => {
  const identityRow = row(3, {
    module: 'identity',
    action: 'role.granted',
    subjectType: 'user',
    subjectId: BOB,
    payload: { actorUsername: 'alice@example.org', targetUsername: 'bob', group: 'regulator' },
  });
  const rows = chainOf(row(1), row(2, { actorUserId: null }), identityRow);

  it('shows an admin the actor, the subject and the payload as stored', async () => {
    const page = await service(rows).svc.list(q(), admin);
    expect(page.actorView).toBe('identified');
    const ev = page.events[0]!;
    expect(ev.eventType).toBe('identity.role.granted');
    expect(ev.actor).toEqual({ kind: 'user', id: ALICE });
    expect(ev.subjectId).toBe(BOB);
    expect(ev.payload).toEqual(identityRow.payload);
    expect(ev.pseudonymised).toEqual([]);
    expect(ev.recordHash).toBe(rows[2]!.recordHash);
    expect(ev.previousHash).toBe(rows[1]!.recordHash);
  });

  it('shows a regulator pseudonyms for the actor, a person subject and person fields', async () => {
    const { svc, p } = service(rows);
    const page = await svc.list(q(), regulator);
    expect(page.actorView).toBe('pseudonymous');
    const ev = page.events[0]!;
    expect(ev.actor).toEqual({ kind: 'pseudonym', id: p.pseudonym(ALICE) });
    expect(ev.subjectId).toBe(p.pseudonym(BOB));
    expect(ev.payload).toEqual({
      actorUsername: p.pseudonym('alice@example.org'),
      targetUsername: p.pseudonym('bob'),
      group: 'regulator',
    });
    expect(ev.pseudonymised).toEqual([
      '/subjectId',
      '/payload/actorUsername',
      '/payload/targetUsername',
    ]);
    expect(JSON.stringify(page)).not.toContain(ALICE);
    expect(JSON.stringify(page)).not.toContain('alice@example.org');
    // Events with no actor stay "system"; other subjects are shown as they are.
    expect(page.events[1]!.actor).toEqual({ kind: 'system' });
    expect(page.events[2]!.subjectId).toBe('card-1');
  });

  it('shows people to someone in both groups: admin is the operator', async () => {
    const page = await service(rows).svc.list(q(), { sub: ALICE, groups: ['regulator', 'admin'] });
    expect(page.actorView).toBe('identified');
  });

  it('withholds people from a regulator when no key is configured', async () => {
    const page = await service(rows, false).svc.list(q(), regulator);
    expect(page.actorView).toBe('withheld');
    expect(page.events[0]!.actor).toEqual({ kind: 'withheld' });
    expect(page.events[0]!.subjectId).toBe('withheld');
    expect(JSON.stringify(page)).not.toContain(ALICE);
    expect(JSON.stringify(page)).not.toContain('bob"');
  });
});

describe('AuditReaderService — filters', () => {
  const rows = chainOf(
    row(1),
    row(2, { actorUserId: BOB }),
    row(3, { module: 'identity', action: 'role.granted', subjectType: 'user', subjectId: BOB }),
    row(4, { actorUserId: null, module: 'platform', action: 'sql.statement_applied' }),
  );

  it('lets a regulator filter by an actor pseudonym and finds that actor only', async () => {
    const { svc, p } = service(rows);
    const page = await svc.list(q({ actor: p.pseudonym(BOB)! }), regulator);
    expect(page.events.map((e) => e.sequenceNumber)).toEqual(['2']);
  });

  it('refuses a regulator a real user id as the actor filter', async () => {
    await expect(service(rows).svc.list(q({ actor: BOB }), regulator)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses an admin a pseudonym filter', async () => {
    const { svc, p } = service(rows);
    await expect(svc.list(q({ actor: p.pseudonym(BOB)! }), admin)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('returns nothing for an unknown pseudonym', async () => {
    const page = await service(rows).svc.list(
      q({ actor: 'ps-000000000000000000000000' }),
      regulator,
    );
    expect(page.events).toEqual([]);
  });

  it('keeps a regulator who types a real user id as the object id away from that person', async () => {
    const page = await service(rows).svc.list(q({ subjectId: BOB }), regulator);
    expect(page.events).toEqual([]);
  });

  it('lets a regulator open the events about a person by pseudonym', async () => {
    const { svc, p } = service(rows);
    const page = await svc.list(q({ subjectId: p.pseudonym(BOB)! }), regulator);
    expect(page.events.map((e) => e.sequenceNumber)).toEqual(['3']);
  });

  it('filters system events and module.action names', async () => {
    const { svc } = service(rows);
    expect(
      (await svc.list(q({ actor: 'system' }), admin)).events.map((e) => e.sequenceNumber),
    ).toEqual(['4']);
    expect(
      (await svc.list(q({ action: 'identity.role.granted' }), admin)).events.map(
        (e) => e.sequenceNumber,
      ),
    ).toEqual(['3']);
    expect((await svc.list(q({ action: 'prediction' }), admin)).events).toHaveLength(2);
  });

  it('pages with an opaque cursor', async () => {
    const { svc } = service(rows);
    const first = await svc.list(q({ limit: 3 }), admin);
    expect(first.events.map((e) => e.sequenceNumber)).toEqual(['4', '3', '2']);
    const second = await svc.list(q({ limit: 3, cursor: first.nextCursor! }), admin);
    expect(second.events.map((e) => e.sequenceNumber)).toEqual(['1']);
    expect(second.nextCursor).toBeNull();
    expect(decodeCursor(encodeCursor(123n))).toBe(123n);
    expect(() => decodeCursor('bm9wZQ')).toThrow(BadRequestException);
  });
});

describe('AuditReaderService — verify', () => {
  it('reports intact, then the first tampered event', async () => {
    const rows = chainOf(row(1), row(2), row(3), row(4));
    expect(await service(rows).svc.verify({})).toMatchObject({
      status: 'intact',
      checked: 4,
      anchor: null,
      complete: true,
    });
    rows[2] = { ...rows[2]!, payload: { slug: 'changed' } };
    const result = await service(rows).svc.verify({});
    expect(result).toMatchObject({
      status: 'broken',
      checked: 3,
      firstBreak: { sequenceNumber: '3', kind: 'payload-hash' },
    });
  });

  it('anchors a range on the event before it', async () => {
    const rows = chainOf(row(1), row(2), row(3));
    const result = await service(rows).svc.verify({ fromSequence: '2' });
    expect(result).toMatchObject({
      status: 'intact',
      checked: 2,
      anchor: { sequenceNumber: '1', recordHash: rows[0]!.recordHash },
    });
  });

  it('reports an empty range', async () => {
    expect((await service([]).svc.verify({})).status).toBe('empty');
  });
});

describe('AuditReaderService — export', () => {
  const rows = chainOf(row(1), row(2), row(3));

  it('records the export with the sha256 of the file before returning it', async () => {
    const { svc, emitted } = service(rows);
    const file = await svc.export('json', { subjectType: 'model-card' }, regulator);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      module: 'audit',
      action: 'events.exported',
      subjectType: 'audit-export',
      subjectId: file.exportId,
      actorRoles: ['regulator'],
      payload: {
        format: 'json',
        filters: { subjectType: 'model-card' },
        eventCount: 3,
        firstSequence: '1',
        lastSequence: '3',
        actorView: 'pseudonymous',
        contentSha256: file.sha256,
      },
    });
    expect(createHash('sha256').update(file.body).digest('hex')).toBe(file.sha256);
    const doc = JSON.parse(file.body);
    expect(doc.format).toBe('oci-audit-events/v1');
    expect(doc.events.map((e: { sequenceNumber: string }) => e.sequenceNumber)).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(file.body).not.toContain(ALICE);
  });

  it('exports CSV with the same rows', async () => {
    const file = await service(rows).svc.export('csv', {}, admin);
    expect(file.contentType).toMatch(/^text\/csv/);
    expect(file.body.trimEnd().split('\r\n')).toHaveLength(4);
    expect(file.filename).toMatch(/^audit-events-\d{8}T\d{6}Z\.csv$/);
  });

  it('refuses an export above the maximum, and records nothing', async () => {
    const { svc, repo, emitted } = service(rows);
    repo.page.mockResolvedValueOnce(new Array(AUDIT_EXPORT_MAX + 1).fill(rows[0]));
    await expect(svc.export('csv', {}, admin)).rejects.toThrow(UnprocessableEntityException);
    expect(emitted).toHaveLength(0);
  });

  it('fails the export when the record cannot be written', async () => {
    const { svc } = service(rows);
    (svc as unknown as { audit: { emitSync: () => Promise<never> } }).audit.emitSync = () =>
      Promise.reject(new Error('db down'));
    await expect(svc.export('csv', {}, admin)).rejects.toThrow('db down');
  });
});

describe('hidePeople', () => {
  it('replaces person values at any depth, arrays included, and records where', () => {
    const out: string[] = [];
    const hidden = hidePeople(
      { filters: { actor: 'x', subjectId: 'y', from: 'z' }, reviewers: ['a', 'b'], count: 2 },
      '/payload',
      false,
      (v) => `h(${v})`,
      out,
    );
    expect(hidden).toEqual({
      filters: { actor: 'h(x)', subjectId: 'h(y)', from: 'z' },
      reviewers: ['h(a)', 'h(b)'],
      count: 2,
    });
    expect(out).toEqual([
      '/payload/filters/actor',
      '/payload/filters/subjectId',
      '/payload/reviewers/0',
      '/payload/reviewers/1',
    ]);
  });
});

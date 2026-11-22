import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { payloadHash } from './hash.js';
import { recordHash, recordHashInput } from './record.js';
import { AuditChainVerifier, type AuditChainRow } from './verify.js';

/** Builds rows the way the writer and the trigger do. */
function chain(count: number, start: string | null = null): AuditChainRow[] {
  const rows: AuditChainRow[] = [];
  let previous = start;
  for (let i = 0; i < count; i += 1) {
    const payload = { n: i, slug: `thing-${i}` };
    const base = {
      id: `id-${i}`,
      module: 'test',
      action: 'thing.happened',
      subjectType: 'thing',
      subjectId: `thing-${i}`,
      occurredAt: new Date(Date.UTC(2026, 10, 22, 9, 0, i, 123)),
      // Gaps are normal: a rolled-back insert still consumes a value.
      sequenceNumber: BigInt(10 + i * 2),
      actorUserId: i % 2 === 0 ? '6f1f7b0e-4a53-4c1e-9a8e-2b8f2b1f0c11' : null,
      payload,
      payloadHash: payloadHash(payload),
      previousHash: previous,
    };
    const row = { ...base, recordHash: recordHash(base) };
    rows.push(row);
    previous = row.recordHash;
  }
  return rows;
}

function verify(rows: AuditChainRow[], anchor: string | null = null) {
  const verifier = new AuditChainVerifier(anchor);
  for (const row of rows) verifier.check(row);
  return verifier;
}

describe('recordHashInput', () => {
  it('is the pipe-joined form the trigger hashes, with empty strings for nulls', () => {
    const input = recordHashInput({
      module: 'm',
      action: 'a.b',
      subjectType: 's',
      subjectId: 'x',
      occurredAt: new Date('2026-11-22T09:00:00.007Z'),
      sequenceNumber: 42n,
      actorUserId: null,
      payloadHash: 'ph',
      previousHash: null,
    });
    expect(input).toBe('m|a.b|s|x|2026-11-22T09:00:00.007Z|42||ph|');
  });

  it('hashes that form with sha256, lower-case hex', () => {
    const fields = {
      module: 'm',
      action: 'a',
      subjectType: 's',
      subjectId: 'x',
      occurredAt: new Date('2026-11-22T09:00:00.000Z'),
      sequenceNumber: 1n,
      actorUserId: 'u',
      payloadHash: 'ph',
      previousHash: 'prev',
    };
    expect(recordHash(fields)).toBe(
      createHash('sha256').update('m|a|s|x|2026-11-22T09:00:00.000Z|1|u|ph|prev').digest('hex'),
    );
  });
});

describe('AuditChainVerifier', () => {
  it('passes an intact chain from the first row of the trail', () => {
    const verifier = verify(chain(5));
    expect(verifier.firstBreak).toBeNull();
    expect(verifier.checked).toBe(5);
  });

  it('passes a range that starts after the anchor row', () => {
    const rows = chain(6);
    const verifier = verify(rows.slice(3), rows[2]?.recordHash ?? null);
    expect(verifier.firstBreak).toBeNull();
    expect(verifier.checked).toBe(3);
  });

  it('reports a range whose anchor does not match its first row', () => {
    const rows = chain(4);
    const verifier = verify(rows.slice(2), 'f'.repeat(64));
    expect(verifier.firstBreak).toMatchObject({ id: 'id-2', kind: 'previous-hash' });
  });

  it('reports a changed field at its row, as a record-hash break', () => {
    const rows = chain(5);
    rows[2] = { ...rows[2]!, subjectId: 'someone-else' };
    const verifier = verify(rows);
    expect(verifier.firstBreak).toMatchObject({
      id: 'id-2',
      sequenceNumber: 14n,
      kind: 'record-hash',
      actual: rows[2]!.recordHash,
    });
    expect(verifier.checked).toBe(3);
  });

  it('reports a changed payload at its row, as a payload-hash break', () => {
    const rows = chain(5);
    rows[3] = { ...rows[3]!, payload: { n: 3, slug: 'rewritten' } };
    expect(verify(rows).firstBreak).toMatchObject({ id: 'id-3', kind: 'payload-hash' });
  });

  it('reports a row rewritten with a recomputed record hash at the next row', () => {
    const rows = chain(5);
    const rewritten = { ...rows[1]!, subjectId: 'someone-else' };
    rows[1] = { ...rewritten, recordHash: recordHash(rewritten) };
    expect(verify(rows).firstBreak).toMatchObject({ id: 'id-2', kind: 'previous-hash' });
  });

  it('reports a deleted row at the row after it', () => {
    const rows = chain(5);
    rows.splice(2, 1);
    expect(verify(rows).firstBreak).toMatchObject({ id: 'id-3', kind: 'previous-hash' });
  });

  it('reports a first row of the trail that points at something', () => {
    const rows = chain(2, 'a'.repeat(64));
    expect(verify(rows).firstBreak).toMatchObject({ id: 'id-0', kind: 'previous-hash' });
  });

  it('keeps the first break and ignores what follows', () => {
    const rows = chain(5);
    rows[1] = { ...rows[1]!, subjectId: 'x' };
    rows[3] = { ...rows[3]!, subjectId: 'y' };
    const verifier = new AuditChainVerifier(null);
    const results = rows.map((row) => verifier.check(row));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(verifier.firstBreak?.id).toBe('id-1');
  });

  it('refuses rows out of sequence order', () => {
    const rows = chain(3);
    const verifier = new AuditChainVerifier(null);
    verifier.check(rows[0]!);
    verifier.check(rows[1]!);
    expect(() => verifier.check(rows[0]!)).toThrow(/increasing sequence order/);
  });
});

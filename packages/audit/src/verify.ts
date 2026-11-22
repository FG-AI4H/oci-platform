import { canonicalSha256 } from './hash.js';
import { recordHash, type AuditRecordFields } from './record.js';

/** A stored audit event as a verifier reads it back. */
export interface AuditChainRow extends AuditRecordFields {
  id: string;
  /** The stored payload, as the database returns it. */
  payload: unknown;
  recordHash: string;
}

/**
 * What did not hold at the first row that failed.
 *
 * - `previous-hash`: the row does not point at the record hash of the
 *   row before it. A row was deleted or inserted out of turn, or the
 *   row before it was rewritten with a recomputed record hash.
 * - `record-hash`: the stored record hash is not the hash of the row's
 *   own fields. A field the record hash covers was changed.
 * - `payload-hash`: the stored payload hash is not the hash of the
 *   stored payload. The payload was changed (the record hash covers
 *   the payload hash only, so this is the only check that sees it).
 */
export type AuditChainBreakKind = 'previous-hash' | 'record-hash' | 'payload-hash';

export interface AuditChainBreak {
  id: string;
  sequenceNumber: bigint;
  kind: AuditChainBreakKind;
  /** The value the rule gives. */
  expected: string | null;
  /** The value stored. */
  actual: string | null;
}

/**
 * Walks stored audit events in sequence order and reports the first
 * row at which the chain does not hold, with the writer's rules:
 * `payloadHash` (RFC 8785, `hash.ts`) and the trigger's record hash
 * (`record.ts`). Feed it in batches; it keeps only the previous hash.
 *
 * `anchor` is the stored record hash of the row just before the first
 * one fed in, or `null` when the first row fed in is the first row of
 * the trail (its `previousHash` must then be null too).
 */
export class AuditChainVerifier {
  private previous: string | null;
  private broken: AuditChainBreak | null = null;
  private count = 0;
  private lastSequence: bigint | null = null;

  constructor(anchor: string | null) {
    this.previous = anchor;
  }

  /** Rows checked so far, the failing row included. */
  get checked(): number {
    return this.count;
  }

  get firstBreak(): AuditChainBreak | null {
    return this.broken;
  }

  /**
   * Checks the next row. Returns the break when this row is the first
   * to fail; once a break is found, further rows are ignored.
   */
  check(row: AuditChainRow): AuditChainBreak | null {
    if (this.lastSequence !== null && row.sequenceNumber <= this.lastSequence) {
      throw new Error(
        `AuditChainVerifier: rows must come in increasing sequence order (${row.sequenceNumber} after ${this.lastSequence})`,
      );
    }
    this.lastSequence = row.sequenceNumber;
    if (this.broken) return null;
    this.count += 1;

    const found = firstFailure(row, this.previous);
    this.previous = row.recordHash;
    if (found) this.broken = found;
    return found;
  }
}

function firstFailure(row: AuditChainRow, previous: string | null): AuditChainBreak | null {
  const at = { id: row.id, sequenceNumber: row.sequenceNumber };
  if (row.previousHash !== previous) {
    return { ...at, kind: 'previous-hash', expected: previous, actual: row.previousHash };
  }
  const expectedRecord = recordHash(row);
  if (row.recordHash !== expectedRecord) {
    return { ...at, kind: 'record-hash', expected: expectedRecord, actual: row.recordHash };
  }
  let expectedPayload: string;
  try {
    expectedPayload = canonicalSha256(row.payload);
  } catch {
    // A stored value RFC 8785 cannot express (it never came from the writer).
    return { ...at, kind: 'payload-hash', expected: null, actual: row.payloadHash };
  }
  if (row.payloadHash !== expectedPayload) {
    return { ...at, kind: 'payload-hash', expected: expectedPayload, actual: row.payloadHash };
  }
  return null;
}

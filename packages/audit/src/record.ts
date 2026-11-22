import { createHash } from 'node:crypto';

/**
 * The fields of a stored audit event that its record hash covers.
 */
export interface AuditRecordFields {
  module: string;
  action: string;
  subjectType: string;
  subjectId: string;
  occurredAt: Date;
  sequenceNumber: bigint;
  actorUserId: string | null;
  payloadHash: string;
  previousHash: string | null;
}

/**
 * The record-hash rule, in TypeScript.
 *
 * The database computes `record_hash` in the BEFORE INSERT trigger of
 * migration `20260517100000_audit_events_257`, so that a row written
 * without this package (by a reviewed SQL statement, ADR-0028) is
 * chained the same way. This is the one copy of that rule outside the
 * database. Readers that recompute a record hash call it; they do not
 * write their own. `audit-chain.int.spec.ts` in the API checks it
 * against what the trigger stores.
 *
 *   sha256(module | action | subject_type | subject_id |
 *          occurred_at as YYYY-MM-DDTHH:MM:SS.mmmZ (UTC) |
 *          sequence_number | actor_user_id or '' |
 *          payload_hash | previous_hash or '')
 *
 * `occurred_at` is a `timestamp(3)` column read as UTC, which is what
 * `Date.prototype.toISOString` prints.
 */
export function recordHashInput(fields: AuditRecordFields): string {
  return [
    fields.module,
    fields.action,
    fields.subjectType,
    fields.subjectId,
    fields.occurredAt.toISOString(),
    fields.sequenceNumber.toString(),
    fields.actorUserId ?? '',
    fields.payloadHash,
    fields.previousHash ?? '',
  ].join('|');
}

/** sha256 of {@link recordHashInput}, lower-case hex, as the trigger stores it. */
export function recordHash(fields: AuditRecordFields): string {
  return createHash('sha256').update(recordHashInput(fields), 'utf8').digest('hex');
}

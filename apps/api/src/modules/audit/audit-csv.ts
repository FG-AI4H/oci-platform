import { canonicalize } from '@oci/audit';
import type { AuditEventView } from '@oci/shared-types';

/** Characters a spreadsheet reads as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell (RFC 4180), safe to open in a spreadsheet.
 *
 * A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage
 * return is prefixed with an apostrophe, so it is shown as text rather
 * than run as a formula (CSV injection). The apostrophe is part of the
 * value in the file; a program reading the file sees it.
 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export const AUDIT_CSV_COLUMNS = [
  'sequenceNumber',
  'occurredAt',
  'eventType',
  'subjectType',
  'subjectId',
  'actorKind',
  'actor',
  'actorRoles',
  'payload',
  'pseudonymised',
  'payloadHash',
  'previousHash',
  'recordHash',
  'retentionClass',
  'id',
] as const;

function actorCells(event: AuditEventView): [string, string] {
  switch (event.actor.kind) {
    case 'user':
    case 'pseudonym':
      return [event.actor.kind, event.actor.id];
    default:
      return [event.actor.kind, ''];
  }
}

/**
 * The export as CSV: a header row, then one row per event, CRLF line
 * ends. The payload is its RFC 8785 form, the input of `payloadHash`
 * where nothing was pseudonymised.
 */
export function toAuditCsv(events: readonly AuditEventView[]): string {
  const lines = [AUDIT_CSV_COLUMNS.join(',')];
  for (const event of events) {
    const [actorKind, actor] = actorCells(event);
    const cells = [
      event.sequenceNumber,
      event.occurredAt,
      event.eventType,
      event.subjectType,
      event.subjectId,
      actorKind,
      actor,
      event.actorRoles.join(';'),
      canonicalize(event.payload),
      event.pseudonymised.join(';'),
      event.payloadHash,
      event.previousHash ?? '',
      event.recordHash,
      event.retentionClass,
      event.id,
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

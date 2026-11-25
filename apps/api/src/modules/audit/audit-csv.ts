import { canonicalize } from '@oci/audit';
import type { AuditEventView } from '@oci/shared-types';
import { csvCell } from '../../common/csv.js';

// The cell rule is shared with the annotation export (#648).
export { csvCell };

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

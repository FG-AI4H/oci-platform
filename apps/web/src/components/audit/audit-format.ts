import type { AuditActor } from '@oci/shared-types';

/**
 * Words the audit components print. English by default; a page in
 * another language passes its own (the evidence summary and the
 * submission page will).
 */
export interface AuditLabels {
  system: string;
  withheld: string;
  /** Prefix of a pseudonymous actor, e.g. "Pseudonym". */
  pseudonym: string;
  actor: string;
  roles: string;
  object: string;
  sequence: string;
  recordHash: string;
  previousHash: string;
  payloadHash: string;
  payload: string;
  noPrevious: string;
  pseudonymisedNote: string;
  details: string;
  empty: string;
  timeline: string;
}

export const AUDIT_LABELS_EN: AuditLabels = {
  system: 'System (no person)',
  withheld: 'Withheld',
  pseudonym: 'Pseudonym',
  actor: 'Actor',
  roles: 'Roles',
  object: 'Object',
  sequence: 'Sequence',
  recordHash: 'Record hash',
  previousHash: 'Previous hash',
  payloadHash: 'Payload hash',
  payload: 'Payload',
  noPrevious: 'none (first event of the trail)',
  pseudonymisedNote:
    'Values replaced by pseudonyms for this reader. The payload hash is that of the stored payload.',
  details: 'Hashes and payload',
  empty: 'No event is recorded for this object.',
  timeline: 'Audit timeline',
};

/** The first 12 hex digits, enough to tell hashes apart at a glance. */
export function shortHash(digest: string | null): string {
  if (digest === null) return '—';
  return digest.length > 12 ? `${digest.slice(0, 12)}…` : digest;
}

export function actorText(actor: AuditActor, labels: AuditLabels = AUDIT_LABELS_EN): string {
  switch (actor.kind) {
    case 'system':
      return labels.system;
    case 'withheld':
      return labels.withheld;
    case 'pseudonym':
      return `${labels.pseudonym} ${actor.id}`;
    case 'user':
      return actor.id;
  }
}

/** `2026-11-22 09:00:05 UTC`: one unambiguous form, whatever the reader's zone. */
export function formatOccurredAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** The payload, indented, for a `<pre>`. */
export function payloadText(payload: unknown): string {
  return JSON.stringify(payload, null, 2) ?? 'null';
}

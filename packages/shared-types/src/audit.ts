import { z } from 'zod';

/**
 * Reading the audit trail (#653, ADR-0014).
 *
 *   GET /v2/audit/events          a page of events, newest first by default
 *   GET /v2/audit/events/verify   recomputes the hash chain over a range
 *   GET /v2/audit/events.csv      the same filters, as a file; the export is
 *   GET /v2/audit/events.json     itself written to the trail
 *
 * Readers: `admin` and `regulator`. An `admin` sees who acted. A
 * `regulator` sees a pseudonym in place of each person: a keyed hash of
 * the identifier, the same for the same person on every page and in
 * every export, and not reversible without the key, which the platform
 * holds and never logs.
 */

/** A pseudonym as a `regulator` sees it: `ps-` and 24 hex digits (96 bits). */
export const AUDIT_PSEUDONYM_PATTERN = /^ps-[0-9a-f]{24}$/;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A query parameter left empty by a form counts as absent. */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalText = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

/**
 * `?actor=`: who acted. `system` for events with no actor (scheduled
 * jobs, one-off statements). Otherwise a user id (as an `admin` sees
 * it) or a pseudonym (as a `regulator` sees it); which one a caller may
 * use is decided by the API, not here.
 */
export const AuditActorFilterSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (v) => v === 'system' || UUID_PATTERN.test(v) || AUDIT_PSEUDONYM_PATTERN.test(v),
    'expected "system", a user id or a pseudonym (ps-…)',
  );

const filterFields = {
  /** The kind of object the event is about: `model-card`, `dataset`, `user`, … */
  subjectType: optionalText(
    z
      .string()
      .trim()
      .max(64)
      .regex(/^[a-z0-9][a-z0-9._-]*$/, 'lower-case letters, digits, dots and dashes'),
  ),
  /** The object's id, exactly as the event stores it. */
  subjectId: optionalText(z.string().trim().max(200)),
  actor: optionalText(AuditActorFilterSchema),
  /**
   * The event, as `module.action` (`prediction.modelcard.created`), or a
   * module alone (`prediction`) for all of its events.
   */
  action: optionalText(
    z
      .string()
      .trim()
      .max(128)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, 'letters, digits, dots, dashes and underscores'),
  ),
  /** Events that occurred at or after this instant (ISO 8601 with an offset). */
  from: optionalText(z.iso.datetime({ offset: true })),
  /** Events that occurred before this instant. */
  to: optionalText(z.iso.datetime({ offset: true })),
};

function fromBeforeTo(q: { from?: string | undefined; to?: string | undefined }): boolean {
  return q.from === undefined || q.to === undefined || Date.parse(q.from) < Date.parse(q.to);
}
const FROM_BEFORE_TO = { message: '"from" must be before "to"', path: ['to'] };

/** Filters shared by the list and the exports. */
export const AuditEventFiltersSchema = z.object(filterFields).refine(fromBeforeTo, FROM_BEFORE_TO);
export type AuditEventFilters = z.infer<typeof AuditEventFiltersSchema>;

export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 200;

export const AuditEventsQuerySchema = z
  .object({
    ...filterFields,
    /** Opaque; the `nextCursor` of the previous page. */
    cursor: optionalText(
      z
        .string()
        .max(64)
        .regex(/^[A-Za-z0-9_-]+$/, 'not a cursor'),
    ),
    limit: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).default(AUDIT_PAGE_DEFAULT),
    ),
    /** `desc` (newest first, the default) or `asc` (as a timeline reads). */
    order: z.preprocess(blankToUndefined, z.enum(['asc', 'desc']).default('desc')),
  })
  .refine(fromBeforeTo, FROM_BEFORE_TO);
export type AuditEventsQuery = z.infer<typeof AuditEventsQuerySchema>;

const sequenceText = z.string().regex(/^\d{1,18}$/, 'a sequence number');

/**
 * `GET /v2/audit/events/verify`. Without parameters the whole trail is
 * checked, up to the per-call limit. A time range is turned into the
 * span of sequence numbers between the first and the last event in it,
 * and every event in that span is checked, whatever its time: the chain
 * runs in sequence order.
 */
export const AuditVerifyQuerySchema = z
  .object({
    fromSequence: optionalText(sequenceText),
    toSequence: optionalText(sequenceText),
    from: filterFields.from,
    to: filterFields.to,
  })
  .refine(fromBeforeTo, FROM_BEFORE_TO)
  .refine(
    (q) =>
      q.fromSequence === undefined ||
      q.toSequence === undefined ||
      BigInt(q.fromSequence) <= BigInt(q.toSequence),
    { message: '"fromSequence" must not be after "toSequence"', path: ['toSequence'] },
  );
export type AuditVerifyQuery = z.infer<typeof AuditVerifyQuerySchema>;

// ---- Responses ------------------------------------------------------------

/** How actors are shown in a response: to an `admin`, to a `regulator`, or not at all. */
export type AuditActorView = 'identified' | 'pseudonymous' | 'withheld';

export type AuditActor =
  /** No person: a scheduled job, a one-off statement. */
  | { kind: 'system' }
  /** Shown to an `admin`: the user id. */
  | { kind: 'user'; id: string }
  /** Shown to a `regulator`. */
  | { kind: 'pseudonym'; id: string }
  /** A person acted, and this deployment cannot pseudonymise: the key is not configured. */
  | { kind: 'withheld' };

export interface AuditEventView {
  id: string;
  /** Position in the chain. A string: it is a 64-bit integer. Gaps are normal. */
  sequenceNumber: string;
  occurredAt: string;
  /** `module.action`, the name the taxonomy uses. */
  eventType: string;
  module: string;
  action: string;
  subjectType: string;
  subjectId: string;
  actor: AuditActor;
  actorRoles: string[];
  /** The stored payload: a JSON object for every event the platform writes. */
  payload: unknown;
  /**
   * JSON Pointers (into this event) of values replaced by a pseudonym
   * for this reader: `/subjectId` for an event about a person,
   * `/payload/targetUsername`, … Empty for an `admin`. Where it is not
   * empty, `payloadHash` is the hash of the stored payload, not of the
   * one shown.
   */
  pseudonymised: string[];
  payloadHash: string;
  previousHash: string | null;
  recordHash: string;
  retentionClass: string;
}

export interface AuditEventPage {
  events: AuditEventView[];
  /** Pass as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
  actorView: AuditActorView;
}

export type AuditChainBreakKind = 'previous-hash' | 'record-hash' | 'payload-hash';

export interface AuditChainVerification {
  /** `empty`: no event in the range. */
  status: 'intact' | 'broken' | 'empty';
  /** Events checked, the failing one included. */
  checked: number;
  firstSequence: string | null;
  lastSequence: string | null;
  /**
   * The event just before the range, whose stored record hash the first
   * event must point at. Null when the range starts at the first event
   * of the trail.
   */
  anchor: { sequenceNumber: string; recordHash: string } | null;
  /**
   * False when the range held more events than one call checks; ask
   * again from `continueFromSequence`.
   */
  complete: boolean;
  continueFromSequence: string | null;
  firstBreak: {
    id: string;
    sequenceNumber: string;
    kind: AuditChainBreakKind;
    expected: string | null;
    actual: string | null;
  } | null;
  verifiedAt: string;
}

/** Body of `GET /v2/audit/events.json`. */
export interface AuditEventsExport {
  format: 'oci-audit-events/v1';
  exportId: string;
  exportedAt: string;
  actorView: AuditActorView;
  filters: AuditEventFilters;
  count: number;
  /** How each hash was computed, so the file can be checked without the platform. */
  rules: { payloadHash: string; recordHash: string };
  /** Oldest first. */
  events: AuditEventView[];
}

/** The most events one export carries; narrow the filters beyond it. */
export const AUDIT_EXPORT_MAX = 10_000;

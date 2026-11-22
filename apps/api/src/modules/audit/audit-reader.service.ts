import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditChainVerifier, type AuditEmitter } from '@oci/audit';
import type { AuditEvent } from '@oci/database';
import {
  AUDIT_EXPORT_MAX,
  AUDIT_PSEUDONYM_PATTERN,
  type AuditActor,
  type AuditActorView,
  type AuditChainVerification,
  type AuditEventFilters,
  type AuditEventPage,
  type AuditEventView,
  type AuditEventsExport,
  type AuditEventsQuery,
  type AuditVerifyQuery,
} from '@oci/shared-types';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { toAuditCsv } from './audit-csv.js';
import { AuditPseudonymiser } from './audit-pseudonym.js';
import { AuditReaderRepository, type AuditRowFilter } from './audit-reader.repository.js';
import { AUDIT_EMITTER } from './audit.tokens.js';

/** Kinds of subject that are a person: their id is pseudonymised for a regulator. */
export const PERSON_SUBJECT_TYPES: readonly string[] = ['user'];

/**
 * Payload keys whose values name or identify a person, pseudonymised for
 * a regulator wherever they appear in a payload: `actorUsername`,
 * `targetUsername`, `targetSub`, `operator`, `reviewer`, `decidedById`,
 * a filter's `actor` and `subjectId`, any `…email`, `…userId`, and their
 * plurals. Over-matching hides a value from a regulator; under-matching
 * shows one, so new person fields must be named to match.
 */
export const PERSON_PAYLOAD_KEY =
  /(?:^actor|subjectid|username|email|userid|byid|sub|operator|reviewer|assignee)s?$/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERIFY_BATCH = 1_000;
/** The most events one verification call checks. */
export const VERIFY_MAX_PER_CALL = 50_000;
const WITHHELD = 'withheld';

export interface AuditReaderCaller {
  sub: string;
  groups: readonly string[];
}

export interface AuditExportFile {
  body: string;
  contentType: string;
  filename: string;
  exportId: string;
  sha256: string;
}

/**
 * The audit trail reader (#653): the list, chain verification, and the
 * exports, with what each kind of reader may see.
 */
@Injectable()
export class AuditReaderService {
  constructor(
    @Inject(AuditReaderRepository) private readonly repo: AuditReaderRepository,
    @Inject(AuditPseudonymiser) private readonly pseudonyms: AuditPseudonymiser,
    @Inject(AUDIT_EMITTER) private readonly audit: AuditEmitter,
  ) {}

  /**
   * An `admin` sees people; anyone else let through (a `regulator`) sees
   * pseudonyms, or nothing when no key is configured. Someone in both
   * groups is an operator and sees people.
   */
  actorView(groups: readonly string[]): AuditActorView {
    if (groups.includes('admin')) return 'identified';
    return this.pseudonyms.configured ? 'pseudonymous' : 'withheld';
  }

  async list(query: AuditEventsQuery, caller: AuditReaderCaller): Promise<AuditEventPage> {
    const view = this.actorView(caller.groups);
    const filter = await this.resolveFilter(query, view);
    if (filter === null) return { events: [], nextCursor: null, actorView: view };

    const rows = await this.repo.page({
      filter,
      order: query.order,
      after: query.cursor === undefined ? null : decodeCursor(query.cursor),
      take: query.limit + 1,
    });
    const more = rows.length > query.limit;
    const shown = more ? rows.slice(0, query.limit) : rows;
    const last = shown.at(-1);
    return {
      events: shown.map((row) => this.toView(row, view)),
      nextCursor: more && last ? encodeCursor(last.sequenceNumber) : null,
      actorView: view,
    };
  }

  /**
   * Recomputes the chain over a range with the writer's rules
   * (`AuditChainVerifier` from `@oci/audit`) and reports the first
   * event at which it does not hold.
   */
  async verify(query: AuditVerifyQuery): Promise<AuditChainVerification> {
    const verifiedAt = new Date().toISOString();
    let lo = query.fromSequence === undefined ? null : BigInt(query.fromSequence);
    let hi = query.toSequence === undefined ? null : BigInt(query.toSequence);
    if (query.from !== undefined || query.to !== undefined) {
      const range: { from?: Date; to?: Date } = {};
      if (query.from !== undefined) range.from = new Date(query.from);
      if (query.to !== undefined) range.to = new Date(query.to);
      const span = await this.repo.sequenceSpan(range);
      if (span.min === null || span.max === null) return emptyVerification(verifiedAt);
      lo = lo === null || lo < span.min ? span.min : lo;
      hi = hi === null || hi > span.max ? span.max : hi;
    }
    const start = lo ?? 0n;
    if (hi !== null && start > hi) return emptyVerification(verifiedAt);

    let batch = await this.repo.chainBatch(start, hi, VERIFY_BATCH);
    const first = batch[0];
    if (!first) return emptyVerification(verifiedAt);

    const anchor = await this.repo.eventBefore(first.sequenceNumber);
    const verifier = new AuditChainVerifier(anchor?.recordHash ?? null);
    let lastSequence = first.sequenceNumber;
    let complete = true;

    outer: while (batch.length > 0) {
      for (const row of batch) {
        if (verifier.checked >= VERIFY_MAX_PER_CALL) {
          complete = false;
          break outer;
        }
        lastSequence = row.sequenceNumber;
        if (verifier.check(row) !== null) break outer;
      }
      if (batch.length < VERIFY_BATCH) break;
      batch = await this.repo.chainBatch(lastSequence + 1n, hi, VERIFY_BATCH);
    }

    const broken = verifier.firstBreak;
    return {
      status: broken ? 'broken' : 'intact',
      checked: verifier.checked,
      firstSequence: first.sequenceNumber.toString(),
      lastSequence: lastSequence.toString(),
      anchor: anchor
        ? { sequenceNumber: anchor.sequenceNumber.toString(), recordHash: anchor.recordHash }
        : null,
      complete,
      continueFromSequence: complete ? null : (lastSequence + 1n).toString(),
      firstBreak: broken
        ? {
            id: broken.id,
            sequenceNumber: broken.sequenceNumber.toString(),
            kind: broken.kind,
            expected: broken.expected,
            actual: broken.actual,
          }
        : null,
      verifiedAt,
    };
  }

  /**
   * The events the filters match, oldest first, as a file. The export
   * is written to the trail before the file is returned, with the
   * sha256 of the file: no export leaves without its record, and the
   * record says exactly what left.
   */
  async export(
    format: 'csv' | 'json',
    filters: AuditEventFilters,
    caller: AuditReaderCaller,
  ): Promise<AuditExportFile> {
    const view = this.actorView(caller.groups);
    const filter = await this.resolveFilter(filters, view);
    const rows =
      filter === null
        ? []
        : await this.repo.page({ filter, order: 'asc', after: null, take: AUDIT_EXPORT_MAX + 1 });
    if (rows.length > AUDIT_EXPORT_MAX) {
      throw new UnprocessableEntityException(
        `More than ${AUDIT_EXPORT_MAX} events match. Narrow the filters, for example the time range.`,
      );
    }
    const events = rows.map((row) => this.toView(row, view));
    const exportId = randomUUID();
    const exportedAt = new Date();
    const cleanFilters = definedOnly(filters);

    let body: string;
    if (format === 'json') {
      const doc: AuditEventsExport = {
        format: 'oci-audit-events/v1',
        exportId,
        exportedAt: exportedAt.toISOString(),
        actorView: view,
        filters: cleanFilters,
        count: events.length,
        rules: HASH_RULES,
        events,
      };
      body = JSON.stringify(doc, null, 2) + '\n';
    } else {
      body = toAuditCsv(events);
    }
    const sha256 = createHash('sha256').update(body, 'utf8').digest('hex');

    await this.audit.emitSync({
      module: 'audit',
      action: 'events.exported',
      subjectType: 'audit-export',
      subjectId: exportId,
      actorUserId: cognitoSubAsUuid(caller.sub),
      actorRoles: caller.groups.filter((g) => g === 'admin' || g === 'regulator'),
      payload: {
        format,
        filters: cleanFilters,
        eventCount: events.length,
        firstSequence: events[0]?.sequenceNumber ?? null,
        lastSequence: events.at(-1)?.sequenceNumber ?? null,
        actorView: view,
        contentSha256: sha256,
      },
    });

    const stamp = exportedAt.toISOString().replaceAll(':', '').replace(/\.\d+Z$/, 'Z');
    return {
      body,
      contentType: format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
      filename: `audit-events-${stamp}.${format}`,
      exportId,
      sha256,
    };
  }

  /**
   * Turns the caller's filters into a query. Returns null when nothing
   * can match (an unknown pseudonym). A regulator filters people by
   * pseudonym only: a real id would tell them which pseudonym it has.
   */
  private async resolveFilter(
    filters: AuditEventFilters,
    view: AuditActorView,
  ): Promise<AuditRowFilter | null> {
    const out: AuditRowFilter = {};
    if (filters.subjectType !== undefined) out.subjectTypes = [filters.subjectType];
    if (filters.action !== undefined) {
      const dot = filters.action.indexOf('.');
      if (dot < 0) out.module = filters.action;
      else {
        out.module = filters.action.slice(0, dot);
        out.action = filters.action.slice(dot + 1);
      }
    }
    if (filters.from !== undefined) out.from = new Date(filters.from);
    if (filters.to !== undefined) out.to = new Date(filters.to);

    if (filters.subjectId !== undefined) {
      const isPseudonym = AUDIT_PSEUDONYM_PATTERN.test(filters.subjectId);
      if (view === 'identified') {
        if (isPseudonym) throw pseudonymFilterRefused();
        out.subjectIds = [filters.subjectId];
      } else if (isPseudonym) {
        if (view === 'withheld') throw pseudonymsUnavailable();
        const types = (out.subjectTypes ?? PERSON_SUBJECT_TYPES).filter((t) =>
          PERSON_SUBJECT_TYPES.includes(t),
        );
        if (types.length === 0) return null;
        const ids = (await this.repo.distinctSubjectIds(types)).filter(
          (id) => this.pseudonyms.pseudonym(id) === filters.subjectId,
        );
        if (ids.length === 0) return null;
        out.subjectTypes = types;
        out.subjectIds = ids;
      } else {
        if (out.subjectTypes?.some((t) => PERSON_SUBJECT_TYPES.includes(t))) {
          throw new BadRequestException(
            'Events about a person are filtered by the pseudonym shown in the trail.',
          );
        }
        out.subjectIds = [filters.subjectId];
        out.excludeSubjectTypes = PERSON_SUBJECT_TYPES;
      }
    }

    if (filters.actor !== undefined) {
      if (filters.actor === 'system') out.actorUserIds = null;
      else if (UUID.test(filters.actor)) {
        if (view !== 'identified') {
          throw new BadRequestException('Actors are filtered by the pseudonym shown in the trail.');
        }
        out.actorUserIds = [filters.actor];
      } else {
        if (view === 'identified') throw pseudonymFilterRefused();
        if (view === 'withheld') throw pseudonymsUnavailable();
        const ids = (await this.repo.distinctActorIds()).filter(
          (id) => this.pseudonyms.pseudonym(id) === filters.actor,
        );
        if (ids.length === 0) return null;
        out.actorUserIds = ids;
      }
    }
    return out;
  }

  private toView(row: AuditEvent, view: AuditActorView): AuditEventView {
    const pseudonymised: string[] = [];
    const hide = (value: string): string =>
      view === 'withheld' ? WITHHELD : (this.pseudonyms.pseudonym(value) ?? WITHHELD);

    let actor: AuditActor;
    if (row.actorUserId === null) actor = { kind: 'system' };
    else if (view === 'identified') actor = { kind: 'user', id: row.actorUserId };
    else if (view === 'withheld') actor = { kind: 'withheld' };
    else actor = { kind: 'pseudonym', id: hide(row.actorUserId) };

    let subjectId = row.subjectId;
    let payload: unknown = row.payload;
    if (view !== 'identified') {
      if (PERSON_SUBJECT_TYPES.includes(row.subjectType)) {
        subjectId = hide(row.subjectId);
        pseudonymised.push('/subjectId');
      }
      payload = hidePeople(row.payload, '/payload', false, hide, pseudonymised);
    }

    return {
      id: row.id,
      sequenceNumber: row.sequenceNumber.toString(),
      occurredAt: row.occurredAt.toISOString(),
      eventType: `${row.module}.${row.action}`,
      module: row.module,
      action: row.action,
      subjectType: row.subjectType,
      subjectId,
      actor,
      actorRoles: row.actorRoles,
      payload,
      pseudonymised,
      payloadHash: row.payloadHash,
      previousHash: row.previousHash,
      recordHash: row.recordHash,
      retentionClass: row.retentionClass,
    };
  }
}

/**
 * Replaces the values of person keys (see `PERSON_PAYLOAD_KEY`), at any
 * depth, and records where. `underPersonKey`: the value sits under such
 * a key (an array of them).
 */
export function hidePeople(
  value: unknown,
  path: string,
  underPersonKey: boolean,
  hide: (v: string) => string,
  out: string[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, i) => hidePeople(item, `${path}/${i}`, underPersonKey, hide, out));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => {
        const innerPath = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
        return [key, hidePeople(inner, innerPath, PERSON_PAYLOAD_KEY.test(key), hide, out)];
      }),
    );
  }
  if (underPersonKey && (typeof value === 'string' || typeof value === 'number')) {
    out.push(path);
    return hide(String(value));
  }
  return value;
}

export const HASH_RULES: AuditEventsExport['rules'] = {
  payloadHash: 'sha256, lower-case hex, of the RFC 8785 (JCS) form of the stored payload',
  recordHash:
    'sha256, lower-case hex, of module|action|subjectType|subjectId|occurredAt (YYYY-MM-DDTHH:MM:SS.mmmZ, UTC)|sequenceNumber|actor user id or empty|payloadHash|previousHash or empty; previousHash is the recordHash of the event before it in sequence order',
};

function emptyVerification(verifiedAt: string): AuditChainVerification {
  return {
    status: 'empty',
    checked: 0,
    firstSequence: null,
    lastSequence: null,
    anchor: null,
    complete: true,
    continueFromSequence: null,
    firstBreak: null,
    verifiedAt,
  };
}

function definedOnly(filters: AuditEventFilters): AuditEventFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined),
  ) as AuditEventFilters;
}

function pseudonymFilterRefused(): BadRequestException {
  return new BadRequestException(
    'Pseudonyms are how a regulator sees people; filter by user id instead.',
  );
}

function pseudonymsUnavailable(): BadRequestException {
  return new BadRequestException('Pseudonyms are not available on this deployment.');
}

export function encodeCursor(sequenceNumber: bigint): string {
  return Buffer.from(`s:${sequenceNumber.toString()}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): bigint {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const match = /^s:(\d{1,18})$/.exec(text);
  if (!match?.[1]) throw new BadRequestException('Not a cursor of this list.');
  return BigInt(match[1]);
}

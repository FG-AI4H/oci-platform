import type { AuditEmitter, AuditEventInput, AuditEventRecord } from '@oci/audit';

/** One call the code under test made, and which of the two contracts it used. */
export interface RecordedAuditEvent extends AuditEventInput {
  via: 'emit' | 'emitSync';
}

/**
 * A stand-in for `AuditEmitter` that records every call instead of writing a
 * row. `emitSync` can be set to throw, to test what a failed synchronous write
 * does to the caller; `emit` never throws, which is its contract.
 */
export class RecordingAuditEmitter {
  readonly events: RecordedAuditEvent[] = [];
  /** When set, `emitSync` records nothing and rejects with this error. */
  emitSyncError: Error | null = null;

  emit(input: AuditEventInput): Promise<void> {
    this.events.push({ ...input, via: 'emit' });
    return Promise.resolve();
  }

  emitSync(input: AuditEventInput): Promise<AuditEventRecord> {
    if (this.emitSyncError) return Promise.reject(this.emitSyncError);
    this.events.push({ ...input, via: 'emitSync' });
    return Promise.resolve({} as AuditEventRecord);
  }

  /** `module.action` of each recorded event, in order. */
  actions(): string[] {
    return this.events.map((e) => `${e.module}.${e.action}`);
  }

  /** The one event with this `module.action`; throws unless there is exactly one. */
  only(action: string): RecordedAuditEvent {
    const found = this.events.filter((e) => `${e.module}.${e.action}` === action);
    if (found.length !== 1) {
      throw new Error(
        `expected one ${action} event, got ${found.length}: ${this.actions().join(', ')}`,
      );
    }
    return found[0] as RecordedAuditEvent;
  }

  asEmitter(): AuditEmitter {
    return this as unknown as AuditEmitter;
  }
}

/**
 * Whether a payload is flat: every value a string, number, boolean or null, or
 * an array of strings. A map of item id to label, or a list of predictions,
 * cannot be expressed in a flat payload, so this together with "no item id
 * appears anywhere" is what shows an event carries no prediction and no label.
 */
export function isFlatPayload(payload: Record<string, unknown>): boolean {
  return Object.values(payload).every(
    (v) =>
      v === null ||
      ['string', 'number', 'boolean'].includes(typeof v) ||
      (Array.isArray(v) && v.every((x) => typeof x === 'string')),
  );
}

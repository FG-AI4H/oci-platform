/**
 * DI token of the platform's `AuditEmitter`. In its own file so that the
 * audit module's own providers can inject it without importing the
 * module file that imports them.
 */
export const AUDIT_EMITTER = Symbol.for('AUDIT_EMITTER');

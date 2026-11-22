import { describe, expect, it } from 'vitest';
import {
  AUDIT_PSEUDONYM_PATTERN,
  AuditEventFiltersSchema,
  AuditEventsQuerySchema,
  AuditVerifyQuerySchema,
} from './audit.js';

describe('AuditEventsQuerySchema', () => {
  it('treats empty form fields as absent and applies the defaults', () => {
    const q = AuditEventsQuerySchema.parse({
      subjectType: '',
      subjectId: ' ',
      actor: '',
      action: '',
      from: '',
      to: '',
      cursor: '',
      limit: '',
      order: '',
    });
    expect(q).toEqual({ limit: 50, order: 'desc' });
  });

  it('accepts the documented filter forms', () => {
    const q = AuditEventsQuerySchema.parse({
      subjectType: 'model-card',
      subjectId: '0b7c7c3e-35e4-4b8e-9a0b-2b1c3d4e5f60',
      actor: 'SYSTEM',
      action: 'prediction.modelcard.created',
      from: '2026-11-01T00:00:00Z',
      to: '2026-11-30T00:00:00+01:00',
      limit: '20',
      order: 'asc',
    });
    expect(q.actor).toBe('system');
    expect(q.limit).toBe(20);
  });

  it('accepts a user id or a pseudonym as the actor, and nothing else', () => {
    expect(
      AuditEventsQuerySchema.safeParse({ actor: '6f1f7b0e-4a53-4c1e-9a8e-2b8f2b1f0c11' }).success,
    ).toBe(true);
    expect(AuditEventsQuerySchema.safeParse({ actor: 'ps-0123456789abcdef01234567' }).success).toBe(
      true,
    );
    expect(AuditEventsQuerySchema.safeParse({ actor: 'alice@example.org' }).success).toBe(false);
  });

  it('refuses a range that ends before it starts', () => {
    const r = AuditEventFiltersSchema.safeParse({
      from: '2026-11-30T00:00:00Z',
      to: '2026-11-01T00:00:00Z',
    });
    expect(r.success).toBe(false);
  });

  it('refuses a limit above the maximum and a malformed cursor', () => {
    expect(AuditEventsQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(AuditEventsQuerySchema.safeParse({ cursor: 'a b' }).success).toBe(false);
  });

  it('refuses a time without an offset', () => {
    expect(AuditEventsQuerySchema.safeParse({ from: '2026-11-01T00:00' }).success).toBe(false);
  });
});

describe('AuditVerifyQuerySchema', () => {
  it('refuses a sequence range that runs backwards', () => {
    expect(AuditVerifyQuerySchema.safeParse({ fromSequence: '9', toSequence: '3' }).success).toBe(
      false,
    );
    expect(AuditVerifyQuerySchema.safeParse({ fromSequence: '3', toSequence: '9' }).success).toBe(
      true,
    );
  });
});

describe('AUDIT_PSEUDONYM_PATTERN', () => {
  it('is ps- and 24 lower-case hex digits', () => {
    expect(AUDIT_PSEUDONYM_PATTERN.test('ps-0123456789abcdef01234567')).toBe(true);
    expect(AUDIT_PSEUDONYM_PATTERN.test('ps-0123456789ABCDEF01234567')).toBe(false);
    expect(AUDIT_PSEUDONYM_PATTERN.test('ps-0123')).toBe(false);
  });
});

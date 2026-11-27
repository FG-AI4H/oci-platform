import { describe, expect, it } from 'vitest';
import { accessGrantEndedAt, isAccessGrantActive, type AccessRequestStatus } from './index.js';

/** #819: an approval gives access until its end date, whatever job has or has not run. */
describe('isAccessGrantActive / accessGrantEndedAt (#819)', () => {
  const now = new Date('2026-11-27T12:00:00.000Z');
  const past = '2026-11-26T12:00:00.000Z';
  const future = '2026-11-28T12:00:00.000Z';

  it('an approval before its end date is in force', () => {
    const grant = { status: 'APPROVED' as const, expiresAt: future };
    expect(isAccessGrantActive(grant, now)).toBe(true);
    expect(accessGrantEndedAt(grant, now)).toBeNull();
  });

  it('an approval past its end date is not, and says when it ended', () => {
    const grant = { status: 'APPROVED' as const, expiresAt: past };
    expect(isAccessGrantActive(grant, now)).toBe(false);
    expect(accessGrantEndedAt(grant, now)).toBe(past);
  });

  it('ends at the end date itself, not a moment later', () => {
    const grant = { status: 'APPROVED' as const, expiresAt: now.toISOString() };
    expect(isAccessGrantActive(grant, now)).toBe(false);
  });

  it.each([null, undefined])('an approval with no end date (%s) does not end', (expiresAt) => {
    const grant = { status: 'APPROVED' as const, expiresAt };
    expect(isAccessGrantActive(grant, now)).toBe(true);
    expect(accessGrantEndedAt(grant, now)).toBeNull();
  });

  it('an end date that cannot be read counts as reached', () => {
    const grant = { status: 'APPROVED' as const, expiresAt: 'not a date' };
    expect(isAccessGrantActive(grant, now)).toBe(false);
    expect(accessGrantEndedAt(grant, now)).toBe('not a date');
  });

  it.each<AccessRequestStatus>(['PENDING', 'DENIED', 'REVOKED'])(
    'a %s request gives no access and has not "ended"',
    (status) => {
      expect(isAccessGrantActive({ status, expiresAt: future }, now)).toBe(false);
      expect(accessGrantEndedAt({ status, expiresAt: past }, now)).toBeNull();
    },
  );

  it('reads the clock when none is given', () => {
    expect(isAccessGrantActive({ status: 'APPROVED', expiresAt: '2000-01-01T00:00:00Z' })).toBe(
      false,
    );
    expect(isAccessGrantActive({ status: 'APPROVED', expiresAt: '2999-01-01T00:00:00Z' })).toBe(
      true,
    );
  });
});

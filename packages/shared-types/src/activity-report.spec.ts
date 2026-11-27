import { describe, expect, it } from 'vitest';
import {
  ActivityReportQuerySchema,
  lastCompleteMonth,
  monthBounds,
  monthOf,
  recentMonths,
} from './activity-report.js';

describe('activity report months (#828)', () => {
  it('a month runs from its first instant to the next month’s, in UTC', () => {
    expect(monthBounds('2026-11')).toEqual({
      from: new Date('2026-11-01T00:00:00.000Z'),
      to: new Date('2026-12-01T00:00:00.000Z'),
    });
  });

  it('December ends on 1 January of the next year', () => {
    expect(monthBounds('2026-12').to).toEqual(new Date('2027-01-01T00:00:00.000Z'));
  });

  it('February follows the calendar, leap years included', () => {
    const days = (month: string) =>
      (monthBounds(month).to.getTime() - monthBounds(month).from.getTime()) / 86_400_000;
    expect(days('2027-02')).toBe(28);
    expect(days('2028-02')).toBe(29);
  });

  it('reads the month of an instant in UTC, not in the server’s zone', () => {
    expect(monthOf(new Date('2026-11-30T23:59:59.999Z'))).toBe('2026-11');
    expect(monthOf(new Date('2026-12-01T00:00:00.000Z'))).toBe('2026-12');
  });

  it('the last complete month is the one before the current one', () => {
    expect(lastCompleteMonth(new Date('2026-11-27T12:00:00.000Z'))).toBe('2026-10');
    expect(lastCompleteMonth(new Date('2027-01-03T00:00:00.000Z'))).toBe('2026-12');
  });

  it('lists recent months newest first, starting with the current one', () => {
    expect(recentMonths(new Date('2027-01-15T00:00:00.000Z'), 3)).toEqual([
      '2027-01',
      '2026-12',
      '2026-11',
    ]);
  });

  it.each(['2026-13', '2026-00', '2026-1', '26-11', '2026-11-01', 'november'])(
    'refuses %s as a month',
    (month) => {
      expect(ActivityReportQuerySchema.safeParse({ month }).success).toBe(false);
    },
  );

  it('an empty month is a month left out', () => {
    expect(ActivityReportQuerySchema.parse({ month: '' })).toEqual({});
    expect(ActivityReportQuerySchema.parse({})).toEqual({});
  });
});

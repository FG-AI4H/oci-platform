import { describe, expect, it } from 'vitest';
import type { Session } from 'next-auth';
import { accountHeaderLinks, primaryHeaderLinks, rowBreakpoint } from './site-header-links';

function session(...groups: string[]): Session {
  return {
    user: { name: 'test', email: 'test@example.com' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
    groups,
    subject: 'test',
  };
}

const keys = (s: Session | null) => primaryHeaderLinks(s).map((link) => link.key);
const hrefOf = (s: Session | null, key: string) =>
  primaryHeaderLinks(s).find((link) => link.key === key)?.href;

describe('primaryHeaderLinks', () => {
  it('shows a visitor the public links only', () => {
    expect(keys(null)).toEqual(['catalog', 'models', 'evaluation']);
  });

  it('shows a plain user neither the review queue nor the audit trail', () => {
    expect(keys(session())).toEqual(['catalog', 'models', 'evaluation', 'annotation']);
    expect(keys(session('participant'))).toEqual(['catalog', 'models', 'evaluation', 'annotation']);
  });

  it('takes an evaluation reviewer to the review queue (#776)', () => {
    const s = session('evaluation-reviewer');
    expect(keys(s)).toContain('reviews');
    expect(keys(s)).not.toContain('auditTrail');
    expect(hrefOf(s, 'reviews')).toBe('/evaluation/routes/reviews');
  });

  it('takes a regulator to the audit trail (#776)', () => {
    const s = session('regulator');
    expect(keys(s)).toContain('auditTrail');
    expect(keys(s)).not.toContain('reviews');
    expect(keys(s)).not.toContain('admin');
    expect(hrefOf(s, 'auditTrail')).toBe('/admin/audit');
  });

  it('leaves an admin header as it was: both pages are on the /admin page', () => {
    const before = ['catalog', 'models', 'evaluation', 'annotation', 'inbox', 'admin'];
    expect(keys(session('admin'))).toEqual(before);
    expect(keys(session('host', 'admin'))).toEqual(before);
    // Holding the roles too adds nothing for an admin.
    expect(keys(session('admin', 'evaluation-reviewer', 'regulator'))).toEqual(before);
  });

  it('gives a reviewer who is also a regulator both entries, once each', () => {
    const list = keys(session('evaluation-reviewer', 'regulator'));
    expect(list.filter((k) => k === 'reviews')).toHaveLength(1);
    expect(list.filter((k) => k === 'auditTrail')).toHaveLength(1);
  });

  it('never repeats a link, whatever the roles', () => {
    const everything = session(
      'admin',
      'host',
      'regulator',
      'evaluation-reviewer',
      'campaign-manager',
    );
    const hrefs = primaryHeaderLinks(everything).map((link) => link.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('keeps the role links after the public ones, and Admin last', () => {
    expect(keys(session('host', 'evaluation-reviewer', 'regulator'))).toEqual([
      'catalog',
      'models',
      'evaluation',
      'annotation',
      'inbox',
      'reviews',
      'auditTrail',
    ]);
  });
});

describe('rowBreakpoint', () => {
  const ROLES = ['host', 'admin', 'regulator', 'evaluation-reviewer'] as const;
  // Every combination of the roles that add a header link.
  const combinations = Array.from({ length: 2 ** ROLES.length }, (_, mask) =>
    ROLES.filter((_, i) => mask & (2 ** i)),
  );

  it('keeps the row from xl up to five links', () => {
    for (const count of [3, 4, 5]) expect(rowBreakpoint(count)).toBe('xl');
  });

  it('holds the menu up to 2xl for six or seven links', () => {
    expect(rowBreakpoint(6)).toBe('2xl');
    expect(rowBreakpoint(7)).toBe('2xl');
  });

  it('keeps the menu at every width beyond seven', () => {
    expect(rowBreakpoint(8)).toBe('never');
  });

  it('shows every role combination a row by 2xl', () => {
    for (const roles of combinations) {
      expect(rowBreakpoint(primaryHeaderLinks(session(...roles)).length)).not.toBe('never');
    }
  });

  it('keeps a visitor, a plain user and every single non-admin role on the xl row', () => {
    expect(rowBreakpoint(keys(null).length)).toBe('xl');
    for (const roles of [[], ['host'], ['regulator'], ['evaluation-reviewer']]) {
      expect(rowBreakpoint(keys(session(...roles)).length)).toBe('xl');
    }
  });

  it('moves the six-link sets, which overflow at xl in French, to 2xl', () => {
    for (const roles of [
      ['host', 'evaluation-reviewer'],
      ['evaluation-reviewer', 'regulator'],
      ['host', 'regulator'],
      ['admin'],
    ]) {
      const count = keys(session(...roles)).length;
      expect(count).toBe(6);
      expect(rowBreakpoint(count)).toBe('2xl');
    }
  });
});

describe('accountHeaderLinks', () => {
  it('is empty for a visitor', () => {
    expect(accountHeaderLinks(null)).toEqual([]);
  });

  it('lists the dashboard and settings for a signed-in caller', () => {
    expect(accountHeaderLinks(session()).map((link) => link.key)).toEqual([
      'dashboard',
      'settings',
    ]);
  });
});

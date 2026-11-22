import { describe, expect, it } from 'vitest';
import type { Session } from 'next-auth';
import en from '../i18n/messages/en';
import fr from '../i18n/messages/fr';
import {
  accountHeaderLinks,
  estimatedRowWidth,
  primaryHeaderLinks,
  rowBreakpoint,
} from './site-header-links';

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

  it('gives an admin the review queue but no second way to the audit trail', () => {
    // Admins reach /admin/audit from the /admin page.
    const s = session('admin');
    expect(keys(s)).toEqual([
      'catalog',
      'models',
      'evaluation',
      'annotation',
      'inbox',
      'reviews',
      'admin',
    ]);
  });

  it('gives an admin who is also a regulator no audit-trail entry either', () => {
    expect(keys(session('admin', 'regulator'))).not.toContain('auditTrail');
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
  // The header's own labels, in each language.
  const labels = (catalogue: typeof en, s: Session | null) =>
    primaryHeaderLinks(s).map((link) => catalogue.Header[link.key]);

  it('estimates nothing for no links, and gaps between links', () => {
    expect(estimatedRowWidth([])).toBe(0);
    expect(estimatedRowWidth(['ab', 'cd'])).toBeGreaterThan(estimatedRowWidth(['abcd']));
  });

  it('keeps the row from xl for a visitor, a reviewer and a regulator, in both languages', () => {
    for (const catalogue of [en, fr]) {
      expect(rowBreakpoint(labels(catalogue, null))).toBe('xl');
      expect(rowBreakpoint(labels(catalogue, session('evaluation-reviewer')))).toBe('xl');
      expect(rowBreakpoint(labels(catalogue, session('regulator')))).toBe('xl');
    }
  });

  it('keeps the row from xl for an admin in English', () => {
    expect(rowBreakpoint(labels(en, session('host', 'admin')))).toBe('xl');
  });

  it('holds the menu up to 2xl for an admin in French, whose links no longer fit at xl', () => {
    expect(rowBreakpoint(labels(fr, session('host', 'admin')))).toBe('2xl');
  });

  it('fits every role combination the header can show by 2xl', () => {
    const everything = session('host', 'admin', 'regulator', 'evaluation-reviewer');
    const allButAdmin = session('host', 'regulator', 'evaluation-reviewer');
    for (const catalogue of [en, fr]) {
      expect(rowBreakpoint(labels(catalogue, everything))).not.toBe('never');
      expect(rowBreakpoint(labels(catalogue, allButAdmin))).not.toBe('never');
    }
  });

  it('gives up on the row when the links would not fit even at 2xl', () => {
    expect(rowBreakpoint(Array.from({ length: 12 }, () => 'Administration'))).toBe('never');
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

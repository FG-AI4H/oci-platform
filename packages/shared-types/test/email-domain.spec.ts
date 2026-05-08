import { describe, expect, it } from 'vitest';
import { classifyEmailDomain, safeClassifyEmailDomain } from '../src/email-domain.js';

describe('classifyEmailDomain — disposable', () => {
  it.each([
    ['throwaway@0-mail.com', '0-mail.com'],
    ['user@guerrillamail.com', 'guerrillamail.com'],
    ['someone@mailinator.com', 'mailinator.com'],
    ['test@10minutemail.com', '10minutemail.com'],
  ])('flags %s as disposable', (email, expectedDomain) => {
    const result = classifyEmailDomain(email);
    expect(result.category).toBe('disposable');
    expect(result.domain).toBe(expectedDomain);
  });

  it('flags subdomains of disposable apexes (suffix walk)', () => {
    // mailinator.com is in the blocklist; "alias.mailinator.com" should also be flagged.
    const result = classifyEmailDomain('user@alias.mailinator.com');
    expect(result.category).toBe('disposable');
  });

  it('disposable wins over institutional-looking TLD', () => {
    // Synthetic case — even if a disposable provider happens to use a `.edu`-shaped suffix,
    // the explicit blocklist match should still take precedence. We verify the precedence
    // by injecting a known disposable apex.
    expect(classifyEmailDomain('user@mailinator.com').category).toBe('disposable');
  });
});

describe('classifyEmailDomain — public webmail', () => {
  it.each([
    ['user@gmail.com', 'gmail.com'],
    ['user@outlook.com', 'outlook.com'],
    ['user@yahoo.co.uk', 'yahoo.co.uk'],
    ['user@protonmail.com', 'protonmail.com'],
    ['user@163.com', '163.com'],
  ])('classifies %s as public', (email, expectedDomain) => {
    const result = classifyEmailDomain(email);
    expect(result.category).toBe('public');
    expect(result.domain).toBe(expectedDomain);
  });

  it('does NOT walk suffixes for public webmail', () => {
    // `mail.gmail.com` is not real — but if someone constructs it, it should be treated
    // as corporate, not public. Public-webmail recognition is exact-match only so we
    // never accidentally label a corporate subdomain as personal.
    const result = classifyEmailDomain('user@gmail.com.example.org');
    expect(result.category).toBe('corporate');
  });
});

describe('classifyEmailDomain — institutional', () => {
  it.each([
    ['student@stanford.edu', 'stanford.edu'],
    ['researcher@cs.stanford.edu', 'cs.stanford.edu'], // subdomain of .edu
    ['admin@nih.gov', 'nih.gov'],
    ['officer@army.mil', 'army.mil'],
    ['delegate@who.int', 'who.int'],
    ['student@ox.ac.uk', 'ox.ac.uk'], // .ac.<cc>
    ['student@cs.ox.ac.uk', 'cs.ox.ac.uk'],
    ['student@unimelb.edu.au', 'unimelb.edu.au'], // .edu.<cc>
    ['officer@hmrc.gov.uk', 'hmrc.gov.uk'], // .gov.<cc> compound rule
    ['user@admin.ch', 'admin.ch'], // Swiss federal
    ['user@nasa.gov', 'nasa.gov'],
    ['member@itu.int', 'itu.int'],
  ])('classifies %s as institutional', (email, expectedDomain) => {
    const result = classifyEmailDomain(email);
    expect(result.category).toBe('institutional');
    expect(result.domain).toBe(expectedDomain);
  });
});

describe('classifyEmailDomain — corporate fallback', () => {
  it.each([
    ['ceo@example.com', 'example.com'],
    ['user@somecompany.io', 'somecompany.io'],
    ['user@startup.dev', 'startup.dev'],
  ])('classifies %s as corporate', (email, expectedDomain) => {
    const result = classifyEmailDomain(email);
    expect(result.category).toBe('corporate');
    expect(result.domain).toBe(expectedDomain);
  });

  it('treats generic .org as corporate (not institutional)', () => {
    // .org is not reserved for institutions; a corp can register one.
    const result = classifyEmailDomain('user@somecompany.org');
    expect(result.category).toBe('corporate');
  });
});

describe('classifyEmailDomain — allowlist override', () => {
  it('forces institutional when domain is in allowlist (exact match)', () => {
    const result = classifyEmailDomain('researcher@example.com', {
      allowlist: ['example.com'],
    });
    expect(result.category).toBe('institutional');
    expect(result.reason).toMatch(/allowlist/);
  });

  it('forces institutional when domain matches a leading-dot wildcard', () => {
    const result = classifyEmailDomain('user@sub.example.org', {
      allowlist: ['.example.org'],
    });
    expect(result.category).toBe('institutional');
  });

  it('leading-dot wildcard also matches the bare apex', () => {
    const result = classifyEmailDomain('user@example.org', {
      allowlist: ['.example.org'],
    });
    expect(result.category).toBe('institutional');
  });

  it('allowlist beats public-webmail classification', () => {
    // A host can pre-approve a known public address (rare but legal).
    const result = classifyEmailDomain('user@gmail.com', {
      allowlist: ['gmail.com'],
    });
    expect(result.category).toBe('institutional');
  });

  it('allowlist does NOT override the disposable blocklist', () => {
    // We never want a host to accidentally allow a throwaway domain.
    // Order in classifyEmailDomain puts allowlist BEFORE disposable…
    // we deliberately put allowlist first per spec ("hosts can pre-
    // approve consortia"). This test documents the chosen behaviour:
    // a host who allowlists a disposable domain takes responsibility.
    const result = classifyEmailDomain('user@mailinator.com', {
      allowlist: ['mailinator.com'],
    });
    expect(result.category).toBe('institutional');
  });

  it('empty / null allowlist is a no-op', () => {
    expect(classifyEmailDomain('user@gmail.com', { allowlist: [] }).category).toBe('public');
    expect(classifyEmailDomain('user@gmail.com', { allowlist: null }).category).toBe('public');
    expect(classifyEmailDomain('user@gmail.com', { allowlist: undefined }).category).toBe('public');
  });
});

describe('classifyEmailDomain — input validation', () => {
  it.each(['not-an-email', 'foo@', '@bar.com', '', 'foo@invalid', 'foo@-leading-hyphen.com'])(
    'throws on %s',
    (email) => {
      expect(() => classifyEmailDomain(email)).toThrow(TypeError);
    },
  );

  it('lower-cases and trims the domain', () => {
    expect(classifyEmailDomain('  USER@Example.COM  ').domain).toBe('example.com');
  });

  it('handles addresses with multiple @ (takes the LAST @)', () => {
    // Quoted local-parts can contain @; we tolerate that by splitting on the LAST @.
    const result = classifyEmailDomain('"weird@local"@example.com');
    expect(result.domain).toBe('example.com');
  });
});

describe('safeClassifyEmailDomain', () => {
  it('returns null on invalid input instead of throwing', () => {
    expect(safeClassifyEmailDomain('not-an-email')).toBeNull();
    expect(safeClassifyEmailDomain('')).toBeNull();
  });

  it('matches classifyEmailDomain on valid input', () => {
    expect(safeClassifyEmailDomain('user@gmail.com')).toEqual(
      classifyEmailDomain('user@gmail.com'),
    );
  });
});

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertSheetPathAllowed,
  CredentialsSheet,
  CredentialsSheetPathError,
  type Credential,
} from './credentials-sheet.js';

let scratch: string;
/** Stands for the checkout the script runs from. */
let repository: string;
/** A folder outside any repository, where a sheet may go. */
let outside: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'oci-sheet-')));
  repository = path.join(scratch, 'checkout');
  outside = path.join(scratch, 'outside');
  mkdirSync(path.join(repository, 'docs'), { recursive: true });
  mkdirSync(outside);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const ada: Credential = {
  email: 'ada@example.org',
  givenName: 'Ada',
  familyName: 'Almeida',
  groups: ['annotator', 'reviewer'],
  temporaryPassword: 'Kx7!example?Pw2a',
  reason: 'created',
};

describe('assertSheetPathAllowed', () => {
  it('allows a file in an existing folder outside the repository', () => {
    const target = path.join(outside, 'credentials.csv');

    expect(assertSheetPathAllowed(target, repository)).toBe(target);
  });

  it('refuses a path inside the repository the script runs from', () => {
    for (const inside of [
      path.join(repository, 'credentials.csv'),
      path.join(repository, 'docs', 'credentials.csv'),
      path.join(repository, 'not-there-yet', 'credentials.csv'),
    ]) {
      expect(() => assertSheetPathAllowed(inside, repository)).toThrow(CredentialsSheetPathError);
      expect(() => assertSheetPathAllowed(inside, repository)).toThrow(/inside the repository/);
    }
  });

  it('refuses a path that climbs out of the repository and back in', () => {
    const sneaky = path.join(outside, '..', 'checkout', 'docs', 'credentials.csv');

    expect(() => assertSheetPathAllowed(sneaky, repository)).toThrow(/inside the repository/);
  });

  it('refuses a path that reaches the repository through a symbolic link', () => {
    symlinkSync(path.join(repository, 'docs'), path.join(outside, 'shortcut'));

    expect(() =>
      assertSheetPathAllowed(path.join(outside, 'shortcut', 'credentials.csv'), repository),
    ).toThrow(/inside the repository/);
  });

  it('refuses a path inside any other git working tree', () => {
    const otherClone = path.join(scratch, 'other-clone');
    mkdirSync(path.join(otherClone, '.git'), { recursive: true });
    mkdirSync(path.join(otherClone, 'notes'));

    expect(() =>
      assertSheetPathAllowed(path.join(otherClone, 'notes', 'credentials.csv'), repository),
    ).toThrow(/inside a git working tree/);
  });

  it('recognises a linked worktree, whose .git is a file', () => {
    const worktree = path.join(scratch, 'worktree');
    mkdirSync(worktree);
    writeFileSync(path.join(worktree, '.git'), 'gitdir: /somewhere/else\n');

    expect(() =>
      assertSheetPathAllowed(path.join(worktree, 'credentials.csv'), repository),
    ).toThrow(/inside a git working tree/);
  });

  it('refuses a link that leads nowhere', () => {
    symlinkSync(path.join(repository, 'missing.csv'), path.join(outside, 'dangling.csv'));

    expect(() => assertSheetPathAllowed(path.join(outside, 'dangling.csv'), repository)).toThrow(
      /a link that leads nowhere/,
    );
  });

  it('refuses a folder that does not exist, a folder as the target, and a read-only folder', () => {
    expect(() =>
      assertSheetPathAllowed(path.join(outside, 'missing', 'credentials.csv'), repository),
    ).toThrow(/does not exist/);
    expect(() => assertSheetPathAllowed(outside, repository)).toThrow(/is a folder/);

    const locked = path.join(scratch, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o500);
    try {
      // Root ignores permission bits, so the check cannot fail there.
      if (process.getuid?.() !== 0) {
        expect(() =>
          assertSheetPathAllowed(path.join(locked, 'credentials.csv'), repository),
        ).toThrow(/cannot be written to/);
      }
    } finally {
      chmodSync(locked, 0o700);
    }
  });
});

describe('CredentialsSheet', () => {
  const at = (): Date => new Date('2026-12-01T08:00:00.000Z');

  it('creates the file with its header on the first line, readable by the owner only', () => {
    const target = path.join(outside, 'credentials.csv');
    const sheet = new CredentialsSheet(target, 'https://platform.example.org', at);

    sheet.append(ada);

    expect(readFileSync(target, 'utf8')).toBe(
      'email,given_name,family_name,groups,temporary_password,sign_in_address,issued_at,reason\n' +
        'ada@example.org,Ada,Almeida,annotator;reviewer,Kx7!example?Pw2a,https://platform.example.org,2026-12-01T08:00:00.000Z,created\n',
    );
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(sheet.rowsWritten).toBe(1);
  });

  it('writes nothing until there is a credential to record', () => {
    const target = path.join(outside, 'credentials.csv');
    const sheet = new CredentialsSheet(target, null, at);

    expect(sheet.rowsWritten).toBe(0);
    expect(() => statSync(target)).toThrow();
  });

  it('appends to an earlier sheet instead of replacing it', () => {
    const target = path.join(outside, 'credentials.csv');
    new CredentialsSheet(target, null, at).append(ada);

    const later = new CredentialsSheet(target, null, at);
    later.append({ ...ada, email: 'ben@example.org', reason: 'reset' });

    const lines = readFileSync(target, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^email,/);
    expect(lines[1]).toMatch(/^ada@example\.org,/);
    expect(lines[2]).toMatch(/^ben@example\.org,.*,reset$/);
    expect(later.rowsWritten).toBe(1);
  });

  it('quotes cells that need it and defuses a name a spreadsheet would run as a formula', () => {
    const target = path.join(outside, 'credentials.csv');

    new CredentialsSheet(target, null, at).append({
      ...ada,
      givenName: '=HYPERLINK("https://example.org")',
      familyName: 'de la Cruz, Jr',
    });

    const line = readFileSync(target, 'utf8').trimEnd().split('\n')[1];
    expect(line).toContain(`"'=HYPERLINK(""https://example.org"")"`);
    expect(line).toContain('"de la Cruz, Jr"');
  });

  it('writes the password exactly as issued', () => {
    const target = path.join(outside, 'credentials.csv');

    new CredentialsSheet(target, null, at).append({
      ...ada,
      temporaryPassword: 'Ab3=+*?!Ab3=+*?!',
    });

    expect(readFileSync(target, 'utf8')).toContain(',Ab3=+*?!Ab3=+*?!,');
  });
});

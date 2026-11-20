import { describe, expect, it } from 'vitest';
import type { Credential } from './credentials-sheet.js';
import { FakeUserDirectory } from './fake-user-directory.js';
import { provisionRoster, resetTemporaryPassword } from './provision.js';
import type { RosterEntry } from './roster.js';
import { DirectoryAccessError, type UserDirectory } from './user-directory.js';

const ada: RosterEntry = {
  line: 2,
  email: 'ada@example.org',
  givenName: 'Ada',
  familyName: 'Almeida',
  groups: ['annotator'],
};
const ben: RosterEntry = {
  line: 3,
  email: 'ben@example.org',
  givenName: 'Ben',
  familyName: 'Brandt',
  groups: ['annotator', 'reviewer'],
};
const cleo: RosterEntry = {
  line: 4,
  email: 'cleo@example.org',
  givenName: 'Cleo',
  familyName: 'Castel',
  groups: [],
};

/** Deterministic stand-in for the generator: pw-1, pw-2, … */
function counter(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `pw-${n}`;
  };
}

function harness(roster: RosterEntry[], suppressMail = false) {
  const directory = new FakeUserDirectory();
  const credentials: Credential[] = [];
  const generatePassword = counter();
  const run = () =>
    provisionRoster({
      roster,
      directory,
      suppressMail,
      generatePassword,
      recordCredential: (c) => credentials.push(c),
    });
  return { directory, credentials, run };
}

describe('provisionRoster', () => {
  it('creates each account with a temporary password, then adds its groups', async () => {
    const { directory, credentials, run } = harness([ada, ben, cleo]);

    const report = await run();

    expect(report.stopped).toBeNull();
    expect(report.outcomes).toEqual([
      { kind: 'created', entry: ada, groupsAdded: ['annotator'] },
      { kind: 'created', entry: ben, groupsAdded: ['annotator', 'reviewer'] },
      { kind: 'created', entry: cleo, groupsAdded: [] },
    ]);

    expect(directory.user('ada@example.org')).toMatchObject({
      status: 'FORCE_CHANGE_PASSWORD',
      givenName: 'Ada',
      familyName: 'Almeida',
      groups: ['annotator'],
      temporaryPassword: 'pw-1',
      invited: true,
    });
    expect(directory.user('ben@example.org')?.groups).toEqual(['annotator', 'reviewer']);
    expect(directory.user('cleo@example.org')?.groups).toEqual([]);

    expect(credentials).toEqual([
      { ...credentialFor(ada), temporaryPassword: 'pw-1' },
      { ...credentialFor(ben), temporaryPassword: 'pw-2' },
      { ...credentialFor(cleo), temporaryPassword: 'pw-3' },
    ]);
  });

  it('creates the account before it adds a group, one person at a time', async () => {
    const { directory, run } = harness([ben]);

    await run();

    expect(directory.calls.map((c) => c.op)).toEqual([
      'findByEmail',
      'createUser',
      'addToGroup',
      'addToGroup',
    ]);
  });

  it('asks the directory to send no invitation when mail is suppressed', async () => {
    const { directory, run } = harness([ada], true);

    await run();

    expect(directory.user('ada@example.org')?.invited).toBe(false);
    expect(directory.calls).toContainEqual({
      op: 'createUser',
      email: 'ada@example.org',
      suppressInvitation: true,
    });
  });

  it('changes nothing on a second run and reports who was already there', async () => {
    const { directory, credentials, run } = harness([ada, ben, cleo]);
    await run();
    const writesAfterFirstRun = directory.writes.length;
    const passwordAfterFirstRun = directory.user('ada@example.org')?.temporaryPassword;

    const second = await run();

    expect(directory.writes).toHaveLength(writesAfterFirstRun);
    expect(second.outcomes).toEqual([
      expect.objectContaining({ kind: 'existing', entry: ada, groupsAdded: [], otherGroups: [] }),
      expect.objectContaining({ kind: 'existing', entry: ben, groupsAdded: [], otherGroups: [] }),
      expect.objectContaining({ kind: 'existing', entry: cleo, groupsAdded: [], otherGroups: [] }),
    ]);
    expect(credentials).toHaveLength(3);
    expect(directory.user('ada@example.org')?.temporaryPassword).toBe(passwordAfterFirstRun);
  });

  it('adds only the missing groups to an account that exists, and removes none', async () => {
    const { directory, credentials, run } = harness([ben]);
    const existing = directory.seed('ben@example.org', { groups: ['reviewer', 'host'] });

    const report = await run();

    expect(report.outcomes).toEqual([
      {
        kind: 'existing',
        entry: ben,
        status: 'CONFIRMED',
        enabled: true,
        groupsAdded: ['annotator'],
        otherGroups: ['host'],
      },
    ]);
    expect(existing.groups).toEqual(['reviewer', 'host', 'annotator']);
    expect(directory.writes).toEqual([
      { op: 'addToGroup', username: existing.username, group: 'annotator' },
    ]);
    expect(credentials).toEqual([]);
  });

  it('leaves the name, status and password of an existing account alone', async () => {
    const { directory, run } = harness([ada]);
    directory.seed('ada@example.org', {
      status: 'UNCONFIRMED',
      givenName: 'A.',
      groups: ['annotator'],
    });

    const report = await run();

    expect(directory.writes).toEqual([]);
    expect(directory.user('ada@example.org')).toMatchObject({
      status: 'UNCONFIRMED',
      givenName: 'A.',
      temporaryPassword: null,
    });
    expect(report.outcomes[0]).toMatchObject({ kind: 'existing', status: 'UNCONFIRMED' });
  });

  it('carries on after a failure that concerns one person only', async () => {
    const { directory, run } = harness([ada, ben]);
    directory.failOn('createUser', 'ada@example.org', new Error('InvalidParameterException'));

    const report = await run();

    expect(report.stopped).toBeNull();
    expect(report.outcomes[0]).toEqual({
      kind: 'failed',
      entry: ada,
      created: false,
      groupsAdded: [],
      message: 'InvalidParameterException',
    });
    expect(report.outcomes[1]).toMatchObject({ kind: 'created', entry: ben });
  });

  it('records the password before the groups, so a group failure loses nothing; a rerun finishes the job', async () => {
    const { directory, credentials, run } = harness([ben]);
    directory.failOn(
      'addToGroup',
      'reviewer',
      new Error('group reviewer is missing from the pool'),
    );

    const first = await run();

    expect(first.outcomes).toEqual([
      {
        kind: 'failed',
        entry: ben,
        created: true,
        groupsAdded: ['annotator'],
        message: 'group reviewer is missing from the pool',
      },
    ]);
    expect(credentials).toHaveLength(1);

    directory.clearFailures();
    const second = await run();

    expect(second.outcomes[0]).toMatchObject({ kind: 'existing', groupsAdded: ['reviewer'] });
    expect(directory.user('ben@example.org')?.groups).toEqual(['annotator', 'reviewer']);
    expect(credentials).toHaveLength(1);
  });

  it('stops at once when the directory cannot be used, and says who was not attempted', async () => {
    const { directory, run } = harness([ada, ben, cleo]);
    directory.failOn(
      'findByEmail',
      'ben@example.org',
      new DirectoryAccessError('ExpiredTokenException: the session has expired'),
    );

    const report = await run();

    expect(report.stopped).toBe('ExpiredTokenException: the session has expired');
    expect(report.outcomes.map((o) => o.kind)).toEqual(['created', 'failed', 'not-attempted']);
    expect(
      directory.calls.some((c) => c.op === 'findByEmail' && c.email === 'cleo@example.org'),
    ).toBe(false);
  });

  it('stops when a password cannot be recorded, and points at --reset-password', async () => {
    const directory = new FakeUserDirectory();

    const report = await provisionRoster({
      roster: [ada, ben],
      directory,
      suppressMail: true,
      generatePassword: counter(),
      recordCredential: () => {
        throw new Error('disk full');
      },
    });

    expect(report.stopped).toContain('--reset-password ada@example.org');
    expect(report.stopped).toContain('disk full');
    expect(report.outcomes.map((o) => o.kind)).toEqual(['failed', 'not-attempted']);
    expect(report.outcomes[0]).toMatchObject({ created: true });
    expect(directory.user('ben@example.org')).toBeUndefined();
  });

  it('treats an account that appears between the lookup and the create as existing', async () => {
    const directory = new FakeUserDirectory();
    const credentials: Credential[] = [];
    // The lookup misses; by the time of the create someone has signed up.
    let lookups = 0;
    const racing: UserDirectory = {
      findByEmail: async (email) => {
        lookups += 1;
        if (lookups === 1) {
          directory.seed(email, { status: 'UNCONFIRMED' });
          return null;
        }
        return directory.findByEmail(email);
      },
      createUser: (user) => directory.createUser(user),
      listGroups: (username) => directory.listGroups(username),
      addToGroup: (username, group) => directory.addToGroup(username, group),
      setTemporaryPassword: (username, password) =>
        directory.setTemporaryPassword(username, password),
    };

    const report = await provisionRoster({
      roster: [ada],
      directory: racing,
      suppressMail: false,
      generatePassword: counter(),
      recordCredential: (c) => credentials.push(c),
    });

    expect(report.outcomes[0]).toMatchObject({
      kind: 'existing',
      status: 'UNCONFIRMED',
      groupsAdded: ['annotator'],
    });
    expect(credentials).toEqual([]);
  });
});

describe('resetTemporaryPassword', () => {
  it('gives an existing account a new temporary password and records it', async () => {
    const directory = new FakeUserDirectory();
    const user = directory.seed('ada@example.org', {
      givenName: 'Ada',
      familyName: 'Almeida',
      groups: ['annotator'],
    });
    const credentials: Credential[] = [];

    const outcome = await resetTemporaryPassword({
      email: 'ada@example.org',
      directory,
      generatePassword: counter(),
      recordCredential: (c) => credentials.push(c),
    });

    expect(outcome).toEqual({
      kind: 'reset',
      email: 'ada@example.org',
      previousStatus: 'CONFIRMED',
    });
    expect(user).toMatchObject({ temporaryPassword: 'pw-1', status: 'FORCE_CHANGE_PASSWORD' });
    expect(directory.writes).toEqual([{ op: 'setTemporaryPassword', username: user.username }]);
    expect(credentials).toEqual([
      {
        email: 'ada@example.org',
        givenName: 'Ada',
        familyName: 'Almeida',
        groups: ['annotator'],
        temporaryPassword: 'pw-1',
        reason: 'reset',
      },
    ]);
  });

  it('changes nothing for an e-mail that has no account', async () => {
    const directory = new FakeUserDirectory();

    const outcome = await resetTemporaryPassword({
      email: 'nobody@example.org',
      directory,
      generatePassword: counter(),
      recordCredential: () => {
        throw new Error('must not be called');
      },
    });

    expect(outcome).toEqual({ kind: 'not-found', email: 'nobody@example.org' });
    expect(directory.writes).toEqual([]);
  });

  it('refuses an account that signs in through an external identity provider', async () => {
    const directory = new FakeUserDirectory();
    directory.seed('fed@example.org', { status: 'EXTERNAL_PROVIDER' });

    const outcome = await resetTemporaryPassword({
      email: 'fed@example.org',
      directory,
      generatePassword: counter(),
      recordCredential: () => {
        throw new Error('must not be called');
      },
    });

    expect(outcome).toEqual({ kind: 'no-password', email: 'fed@example.org' });
    expect(directory.writes).toEqual([]);
  });
});

function credentialFor(entry: RosterEntry): Omit<Credential, 'temporaryPassword'> {
  return {
    email: entry.email,
    givenName: entry.givenName,
    familyName: entry.familyName,
    groups: entry.groups,
    reason: 'created',
  };
}

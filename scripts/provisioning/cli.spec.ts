import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_FAILED, EXIT_OK, EXIT_REFUSED, run, type CliDependencies } from './cli.js';
import { FakeUserDirectory } from './fake-user-directory.js';
import { DirectoryAccessError } from './user-directory.js';

const POOL = 'eu-central-1_EXAMPLE01';
const ROSTER = [
  'email,given_name,family_name,groups',
  'ada@example.org,Ada,Almeida,annotator',
  'ben@example.org,Ben,Brandt,annotator;reviewer',
  'cleo@example.org,Cleo,Castel,',
].join('\n');

let scratch: string;
let repository: string;
let desk: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'oci-provision-')));
  repository = path.join(scratch, 'checkout');
  desk = path.join(scratch, 'desk');
  mkdirSync(repository);
  mkdirSync(desk);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function writeRoster(text = ROSTER): string {
  const file = path.join(desk, 'roster.csv');
  writeFileSync(file, text);
  return file;
}

/** One command line, with its own fake directory unless a shared one is given. */
function command(directory = new FakeUserDirectory(), env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const opened: string[] = [];
  let passwords = 0;
  const deps: CliDependencies = {
    env,
    workingDirectory: desk,
    repositoryRoot: repository,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    openDirectory: (userPoolId) => {
      opened.push(userPoolId);
      return directory;
    },
    generatePassword: () => {
      passwords += 1;
      return `Temp${passwords}!example`;
    },
    now: () => new Date('2026-12-01T08:00:00.000Z'),
  };
  return {
    directory,
    opened,
    out,
    err,
    text: () => [...out, ...err].join('\n'),
    run: (...argv: string[]) => run(argv, deps),
  };
}

describe('provision-users: creating accounts', () => {
  it('creates every account on the roster with its groups, in one command', async () => {
    const roster = writeRoster();
    const sheet = path.join(desk, 'credentials.csv');
    const cli = command();

    const code = await cli.run(roster, '--user-pool-id', POOL, '--credentials-out', sheet);

    expect(code).toBe(EXIT_OK);
    expect(cli.opened).toEqual([POOL]);
    expect(cli.directory.user('ada@example.org')).toMatchObject({
      status: 'FORCE_CHANGE_PASSWORD',
      givenName: 'Ada',
      familyName: 'Almeida',
      groups: ['annotator'],
      invited: true,
    });
    expect(cli.directory.user('ben@example.org')?.groups).toEqual(['annotator', 'reviewer']);
    expect(cli.directory.user('cleo@example.org')?.groups).toEqual([]);
    expect(cli.text()).toContain('3 account(s): 3 created');
  });

  it('writes the passwords to the credentials sheet and never to the terminal', async () => {
    const roster = writeRoster();
    const sheet = path.join(desk, 'credentials.csv');
    const cli = command();

    await cli.run(
      roster,
      '--user-pool-id',
      POOL,
      '--credentials-out',
      sheet,
      '--sign-in-url',
      'https://platform.example.org',
    );

    const lines = readFileSync(sheet, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(
      'ada@example.org,Ada,Almeida,annotator,Temp1!example,https://platform.example.org,2026-12-01T08:00:00.000Z,created',
    );
    expect(cli.directory.user('ada@example.org')?.temporaryPassword).toBe('Temp1!example');
    expect(cli.text()).not.toMatch(/Temp\d!example/);
    expect(cli.text()).toContain(`3 line(s) appended to ${sheet}`);
  });

  it('takes the user pool from COGNITO_USER_POOL_ID when the option is absent', async () => {
    const cli = command(new FakeUserDirectory(), { COGNITO_USER_POOL_ID: POOL });

    const code = await cli.run(writeRoster());

    expect(code).toBe(EXIT_OK);
    expect(cli.opened).toEqual([POOL]);
  });

  it('has no built-in user pool: without one it refuses and calls nothing', async () => {
    const cli = command();

    const code = await cli.run(writeRoster());

    expect(code).toBe(EXIT_REFUSED);
    expect(cli.opened).toEqual([]);
    expect(cli.text()).toContain('pass --user-pool-id or set COGNITO_USER_POOL_ID');
  });

  it('refuses something that is not a user pool id', async () => {
    const cli = command();

    const code = await cli.run(writeRoster(), '--user-pool-id', 'my-pool');

    expect(code).toBe(EXIT_REFUSED);
    expect(cli.opened).toEqual([]);
  });

  it('sends no invitation with --suppress-mail', async () => {
    const cli = command();

    const code = await cli.run(
      writeRoster(),
      '--user-pool-id',
      POOL,
      '--suppress-mail',
      '--credentials-out',
      path.join(desk, 'credentials.csv'),
    );

    expect(code).toBe(EXIT_OK);
    expect(cli.directory.user('ada@example.org')?.invited).toBe(false);
    expect(cli.text()).toContain('invitations suppressed');
  });

  it('refuses --suppress-mail without a credentials sheet, before any call', async () => {
    const cli = command();

    const code = await cli.run(writeRoster(), '--user-pool-id', POOL, '--suppress-mail');

    expect(code).toBe(EXIT_REFUSED);
    expect(cli.opened).toEqual([]);
    expect(cli.text()).toContain('--suppress-mail needs --credentials-out');
  });

  it('points out a roster that grants the admin group', async () => {
    const cli = command();

    await cli.run(
      writeRoster('email,given_name,family_name,groups\nada@example.org,Ada,Almeida,admin'),
      '--user-pool-id',
      POOL,
    );

    expect(cli.text()).toContain('grant the admin group: ada@example.org');
  });

  it('exits non-zero and says so when the directory stops answering', async () => {
    const cli = command();
    cli.directory.failOn(
      'findByEmail',
      'ben@example.org',
      new DirectoryAccessError('ExpiredTokenException: the session has expired'),
    );

    const code = await cli.run(writeRoster(), '--user-pool-id', POOL);

    expect(code).toBe(EXIT_FAILED);
    expect(cli.text()).toContain('1 created');
    expect(cli.text()).toContain('1 failed, 1 not attempted');
    expect(cli.text()).toContain('Stopped early: ExpiredTokenException');
    expect(cli.text()).not.toContain('export-credentials');
  });

  it('says how to pass an open session when the profile asks for an MFA code', async () => {
    const cli = command();
    cli.directory.failOn(
      'findByEmail',
      'ada@example.org',
      new DirectoryAccessError(
        'CredentialsProviderError: Profile ops requires multi-factor authentication, but no MFA code callback was provided.',
      ),
    );

    const code = await cli.run(writeRoster(), '--user-pool-id', POOL);

    expect(code).toBe(EXIT_FAILED);
    expect(cli.text()).toContain('cannot prompt for');
    expect(cli.text()).toContain(
      'aws configure export-credentials --profile <profile> --format env',
    );
  });
});

describe('provision-users: running it again', () => {
  it('changes nothing on a second run and reports what already existed', async () => {
    const roster = writeRoster();
    const sheet = path.join(desk, 'credentials.csv');
    const directory = new FakeUserDirectory();
    await command(directory).run(roster, '--user-pool-id', POOL, '--credentials-out', sheet);
    const writesAfterFirstRun = directory.writes.length;
    const sheetAfterFirstRun = readFileSync(sheet, 'utf8');

    const second = command(directory);
    const code = await second.run(roster, '--user-pool-id', POOL, '--credentials-out', sheet);

    expect(code).toBe(EXIT_OK);
    expect(directory.writes).toHaveLength(writesAfterFirstRun);
    expect(readFileSync(sheet, 'utf8')).toBe(sheetAfterFirstRun);
    expect(second.text()).toContain(
      'No change: all 3 account(s) already existed with their groups.',
    );
    expect(second.out.filter((line) => line.includes('already there'))).toHaveLength(3);
    expect(second.text()).toContain(`nothing to add; ${sheet} was not touched`);
  });

  it('creates only the newcomer when someone is added to the roster', async () => {
    const sheet = path.join(desk, 'credentials.csv');
    const directory = new FakeUserDirectory();
    await command(directory).run(writeRoster(), '--user-pool-id', POOL, '--credentials-out', sheet);
    const writesAfterFirstRun = directory.writes.length;

    const second = command(directory);
    await second.run(
      writeRoster(`${ROSTER}\ndee@example.org,Dee,Duval,annotator`),
      '--user-pool-id',
      POOL,
      '--credentials-out',
      sheet,
    );

    expect(directory.writes.slice(writesAfterFirstRun).map((c) => c.op)).toEqual([
      'createUser',
      'addToGroup',
    ]);
    expect(second.text()).toContain('4 account(s): 1 created, 3 already there and unchanged');
    const lines = readFileSync(sheet, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[4]).toMatch(/^dee@example\.org,/);
  });

  it('does not create an empty sheet when there is nothing to record', async () => {
    const directory = new FakeUserDirectory();
    directory.seed('ada@example.org', { groups: ['annotator'] });
    const sheet = path.join(desk, 'credentials.csv');

    await command(directory).run(
      writeRoster('email,given_name,family_name,groups\nada@example.org,Ada,Almeida,annotator'),
      '--user-pool-id',
      POOL,
      '--credentials-out',
      sheet,
    );

    expect(existsSync(sheet)).toBe(false);
  });
});

describe('provision-users: a roster with a mistake', () => {
  it('refuses an unknown group before any call is made', async () => {
    const sheet = path.join(desk, 'credentials.csv');
    const cli = command();

    const code = await cli.run(
      writeRoster(
        [
          'email,given_name,family_name,groups',
          'ada@example.org,Ada,Almeida,annotator',
          'ben@example.org,Ben,Brandt,radiologist',
        ].join('\n'),
      ),
      '--user-pool-id',
      POOL,
      '--credentials-out',
      sheet,
    );

    expect(code).toBe(EXIT_REFUSED);
    expect(cli.opened).toEqual([]);
    expect(cli.directory.calls).toEqual([]);
    expect(existsSync(sheet)).toBe(false);
    expect(cli.text()).toContain('line 3: unknown group "radiologist"');
    expect(cli.text()).toContain('nothing was done');
  });

  it('refuses a roster that cannot be read', async () => {
    const cli = command();

    const code = await cli.run('missing.csv', '--user-pool-id', POOL);

    expect(code).toBe(EXIT_REFUSED);
    expect(cli.opened).toEqual([]);
    expect(cli.text()).toContain(path.join(desk, 'missing.csv'));
  });
});

describe('provision-users: --dry-run', () => {
  it('makes no call, writes no sheet and says what it would do', async () => {
    const sheet = path.join(desk, 'credentials.csv');
    const cli = command();

    const code = await cli.run(
      writeRoster(),
      '--dry-run',
      '--user-pool-id',
      POOL,
      '--credentials-out',
      sheet,
    );

    expect(code).toBe(EXIT_OK);
    expect(cli.opened).toEqual([]);
    expect(cli.directory.calls).toEqual([]);
    expect(existsSync(sheet)).toBe(false);
    expect(cli.text()).toContain('Dry run: no call is made to Cognito');
    expect(cli.text()).toContain('ben@example.org  Ben Brandt  (annotator, reviewer)');
    expect(cli.text()).toContain('3 account(s) on the roster.');
  });

  it('needs no user pool, so a roster can be checked without AWS access', async () => {
    const cli = command();

    expect(await cli.run(writeRoster(), '--dry-run')).toBe(EXIT_OK);
    expect(cli.opened).toEqual([]);
  });

  it('still refuses a bad roster and a sheet inside the repository', async () => {
    const bad = command();
    expect(
      await bad.run(
        writeRoster('email,given_name,family_name,groups\nada@example.org,Ada,Almeida,nobody'),
        '--dry-run',
      ),
    ).toBe(EXIT_REFUSED);

    const inside = command();
    expect(
      await inside.run(
        writeRoster(),
        '--dry-run',
        '--credentials-out',
        path.join(repository, 'credentials.csv'),
      ),
    ).toBe(EXIT_REFUSED);
  });

  it('is not lost behind a bare "--": the command is refused instead of run for real', async () => {
    const cli = command();

    const code = await cli.run('--', writeRoster(), '--dry-run', '--user-pool-id', POOL);

    expect(code).toBe(EXIT_REFUSED);
    expect(cli.opened).toEqual([]);
    expect(cli.text()).toContain('Remove the "--"');
  });
});

describe('provision-users: where the credentials sheet may go', () => {
  it('refuses a sheet inside the repository before any call is made', async () => {
    const sheet = path.join(repository, 'credentials.csv');
    const cli = command();

    const code = await cli.run(writeRoster(), '--user-pool-id', POOL, '--credentials-out', sheet);

    expect(code).toBe(EXIT_REFUSED);
    expect(cli.opened).toEqual([]);
    expect(cli.directory.calls).toEqual([]);
    expect(existsSync(sheet)).toBe(false);
    expect(cli.text()).toContain('inside the repository');
  });

  it('reads a relative sheet path against the folder the operator is in', async () => {
    const cli = command();

    await cli.run(writeRoster(), '--user-pool-id', POOL, '--credentials-out', 'credentials.csv');

    expect(existsSync(path.join(desk, 'credentials.csv'))).toBe(true);
  });

  it('refuses a relative path when the operator stands inside the repository', async () => {
    const roster = writeRoster();
    const out: string[] = [];
    const opened: string[] = [];

    const code = await run(
      [roster, '--user-pool-id', POOL, '--credentials-out', 'credentials.csv'],
      {
        env: {},
        workingDirectory: repository,
        repositoryRoot: repository,
        out: (line) => out.push(line),
        err: (line) => out.push(line),
        openDirectory: (userPoolId) => {
          opened.push(userPoolId);
          return new FakeUserDirectory();
        },
        generatePassword: () => 'Temp1!example',
        now: () => new Date(),
      },
    );

    expect(code).toBe(EXIT_REFUSED);
    expect(opened).toEqual([]);
  });
});

describe('provision-users: --reset-password', () => {
  it('gives one account a new temporary password and appends it to the sheet', async () => {
    const directory = new FakeUserDirectory();
    const user = directory.seed('ada@example.org', {
      givenName: 'Ada',
      familyName: 'Almeida',
      groups: ['annotator'],
      status: 'FORCE_CHANGE_PASSWORD',
    });
    const sheet = path.join(desk, 'credentials.csv');
    const cli = command(directory);

    const code = await cli.run(
      '--reset-password',
      'Ada@Example.org',
      '--user-pool-id',
      POOL,
      '--credentials-out',
      sheet,
    );

    expect(code).toBe(EXIT_OK);
    expect(directory.writes).toEqual([{ op: 'setTemporaryPassword', username: user.username }]);
    expect(user.temporaryPassword).toBe('Temp1!example');
    expect(readFileSync(sheet, 'utf8').trimEnd().split('\n')[1]).toBe(
      'ada@example.org,Ada,Almeida,annotator,Temp1!example,,2026-12-01T08:00:00.000Z,reset',
    );
    expect(cli.text()).not.toContain('Temp1!example');
    expect(cli.text()).toContain('No mail was sent');
  });

  it('refuses without a credentials sheet, since the password would go nowhere', async () => {
    const cli = command();

    const code = await cli.run('--reset-password', 'ada@example.org', '--user-pool-id', POOL);

    expect(code).toBe(EXIT_REFUSED);
    expect(cli.opened).toEqual([]);
  });

  it('refuses to be combined with a roster', async () => {
    const cli = command();

    const code = await cli.run(
      writeRoster(),
      '--reset-password',
      'ada@example.org',
      '--user-pool-id',
      POOL,
      '--credentials-out',
      path.join(desk, 'credentials.csv'),
    );

    expect(code).toBe(EXIT_REFUSED);
    expect(cli.opened).toEqual([]);
  });

  it('fails without changing anything when the e-mail has no account', async () => {
    const sheet = path.join(desk, 'credentials.csv');
    const cli = command();

    const code = await cli.run(
      '--reset-password',
      'nobody@example.org',
      '--user-pool-id',
      POOL,
      '--credentials-out',
      sheet,
    );

    expect(code).toBe(EXIT_FAILED);
    expect(cli.directory.writes).toEqual([]);
    expect(existsSync(sheet)).toBe(false);
    expect(cli.text()).toContain('nobody@example.org has no account');
  });

  it('makes no call under --dry-run', async () => {
    const cli = command();

    const code = await cli.run(
      '--reset-password',
      'ada@example.org',
      '--dry-run',
      '--credentials-out',
      path.join(desk, 'credentials.csv'),
    );

    expect(code).toBe(EXIT_OK);
    expect(cli.opened).toEqual([]);
  });
});

describe('provision-users: the command line itself', () => {
  it('prints the usage with --help and calls nothing', async () => {
    const cli = command();

    expect(await cli.run('--help')).toBe(EXIT_OK);
    expect(cli.text()).toContain('provision-users <roster.csv>');
    expect(cli.opened).toEqual([]);
  });

  it('refuses an unknown option, a missing roster and two rosters', async () => {
    for (const argv of [['--frobnicate'], [], ['a.csv', 'b.csv']]) {
      const cli = command();

      expect(await cli.run(...argv)).toBe(EXIT_REFUSED);
      expect(cli.opened).toEqual([]);
    }
  });

  it('refuses a sign-in address that is not https', async () => {
    const cli = command();

    const code = await cli.run(
      writeRoster(),
      '--user-pool-id',
      POOL,
      '--sign-in-url',
      'http://platform.example.org',
    );

    expect(code).toBe(EXIT_REFUSED);
    expect(cli.opened).toEqual([]);
  });
});

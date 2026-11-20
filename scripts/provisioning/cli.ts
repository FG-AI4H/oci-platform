import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { CognitoUserDirectory, regionOfUserPool } from './cognito-user-directory.js';
import {
  assertSheetPathAllowed,
  CredentialsSheet,
  CredentialsSheetPathError,
} from './credentials-sheet.js';
import {
  provisionRoster,
  resetTemporaryPassword,
  type AccountOutcome,
  type ProvisionReport,
} from './provision.js';
import { parseRoster, type RosterEntry } from './roster.js';
import { generateTemporaryPassword } from './temporary-password.js';
import type { UserDirectory } from './user-directory.js';

/** Everything the command touches outside its arguments, so tests can replace it. */
export interface CliDependencies {
  env: Readonly<Record<string, string | undefined>>;
  /** Folder that relative paths on the command line are read against. */
  workingDirectory: string;
  /** The checkout this script runs from; the credentials sheet may not be inside it. */
  repositoryRoot: string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Called at most once, and never for a dry run or a refused command. */
  openDirectory: (userPoolId: string) => UserDirectory;
  generatePassword: () => string;
  now: () => Date;
}

export const EXIT_OK = 0;
/** The command ran but at least one account could not be dealt with. */
export const EXIT_FAILED = 1;
/** The command was refused before anything was changed. */
export const EXIT_REFUSED = 2;

export const USAGE = `Create platform accounts from a roster, with their groups.

  provision-users <roster.csv> [options]
  provision-users --reset-password <email> --credentials-out <file> [options]

The roster is a CSV with the header  email,given_name,family_name,groups
(groups separated by ";"). It is checked in full before any account is touched.

Options
  --user-pool-id <id>       Cognito user pool to write to. Default: $COGNITO_USER_POOL_ID.
  --credentials-out <file>  Append the temporary passwords issued to this CSV. The file
                            must be outside any git working tree.
  --suppress-mail           Send no invitation; hand the passwords out from the
                            credentials sheet. Requires --credentials-out.
  --sign-in-url <url>       Address people sign in at, copied onto the credentials sheet.
  --reset-password <email>  Give one existing account a new temporary password. No mail
                            is sent; the password goes to the credentials sheet.
  --dry-run                 Check the roster and the paths and say what would be done.
                            Makes no call to Cognito.
  -h, --help                Show this text.

AWS credentials come from the environment (the SSO-assumed operator role).`;

class Refusal extends Error {}

interface Arguments {
  rosterPath: string | null;
  resetEmail: string | null;
  userPoolId: string | null;
  credentialsOut: string | null;
  signInUrl: string | null;
  suppressMail: boolean;
  dryRun: boolean;
  help: boolean;
}

function readArguments(argv: readonly string[], deps: CliDependencies): Arguments {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        'user-pool-id': { type: 'string' },
        'credentials-out': { type: 'string' },
        'sign-in-url': { type: 'string' },
        'reset-password': { type: 'string' },
        'suppress-mail': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    throw new Refusal(err instanceof Error ? err.message : String(err));
  }
  const { values, positionals } = parsed;

  // After a bare `--` everything is a positional, so `-- roster.csv --dry-run`
  // would lose the dry run. Refuse rather than run for real by accident.
  const strayOption = positionals.find((p) => p.startsWith('-'));
  if (strayOption) {
    throw new Refusal(
      `"${strayOption}" came after a bare "--" and was not read as an option. Remove the "--".`,
    );
  }
  if (positionals.length > 1) {
    throw new Refusal(`expected one roster file, got ${positionals.length}`);
  }

  return {
    rosterPath: positionals[0] ?? null,
    resetEmail: values['reset-password'] ?? null,
    userPoolId: values['user-pool-id'] ?? deps.env.COGNITO_USER_POOL_ID ?? null,
    credentialsOut: values['credentials-out'] ?? null,
    signInUrl: values['sign-in-url'] ?? null,
    suppressMail: values['suppress-mail'],
    dryRun: values['dry-run'],
    help: values.help,
  };
}

function checkSignInUrl(raw: string | null): string | null {
  if (raw === null) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Refusal(`--sign-in-url "${raw}" is not a URL`);
  }
  if (url.protocol !== 'https:') throw new Refusal('--sign-in-url must start with https://');
  return raw;
}

function requireUserPoolId(args: Arguments): string {
  if (!args.userPoolId) {
    throw new Refusal('no user pool: pass --user-pool-id or set COGNITO_USER_POOL_ID');
  }
  if (!regionOfUserPool(args.userPoolId)) {
    throw new Refusal(`"${args.userPoolId}" is not a user pool id (expected <region>_<suffix>)`);
  }
  return args.userPoolId;
}

function readRoster(rosterPath: string, deps: CliDependencies): RosterEntry[] {
  const absolute = path.resolve(deps.workingDirectory, rosterPath);
  let text: string;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the roster path is the operator's own argument
    text = readFileSync(absolute, 'utf8');
  } catch (err) {
    throw new Refusal(
      `cannot read the roster ${absolute}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = parseRoster(text);
  if (!result.ok) {
    const lines = result.issues.map((issue) => `  line ${issue.line}: ${issue.message}`);
    throw new Refusal(
      `the roster ${absolute} has ${result.issues.length} problem(s); nothing was done.\n${lines.join('\n')}`,
    );
  }
  return result.entries;
}

function listGroups(groups: readonly string[]): string {
  return groups.length > 0 ? groups.join(', ') : 'no group';
}

function describeOutcome(outcome: AccountOutcome): string {
  const email = outcome.entry.email;
  switch (outcome.kind) {
    case 'created':
      return `  created        ${email}  (${listGroups(outcome.groupsAdded)})`;
    case 'existing': {
      const notes = [outcome.status];
      if (!outcome.enabled) notes.push('disabled');
      const change =
        outcome.groupsAdded.length > 0
          ? `added to ${listGroups(outcome.groupsAdded)}`
          : 'no change';
      const extra =
        outcome.otherGroups.length > 0
          ? `; also in ${outcome.otherGroups.join(', ')}, left as is`
          : '';
      return `  already there  ${email}  (${notes.join(', ')}): ${change}${extra}`;
    }
    case 'failed': {
      const done = outcome.created
        ? ` The account was made${outcome.groupsAdded.length > 0 ? ` and added to ${listGroups(outcome.groupsAdded)}` : ''}; run the command again to finish it.`
        : '';
      return `  FAILED         ${email}: ${outcome.message.replace(/\.$/, '')}.${done}`;
    }
    case 'not-attempted':
      return `  not attempted  ${email}`;
  }
}

function count(report: ProvisionReport, test: (o: AccountOutcome) => boolean): number {
  return report.outcomes.filter(test).length;
}

function printReport(report: ProvisionReport, deps: CliDependencies): void {
  for (const outcome of report.outcomes) deps.out(describeOutcome(outcome));

  const total = report.outcomes.length;
  const created = count(report, (o) => o.kind === 'created');
  const unchanged = count(report, (o) => o.kind === 'existing' && o.groupsAdded.length === 0);
  const gained = count(report, (o) => o.kind === 'existing' && o.groupsAdded.length > 0);
  const failed = count(report, (o) => o.kind === 'failed');
  const notAttempted = count(report, (o) => o.kind === 'not-attempted');

  deps.out('');
  if (unchanged === total) {
    deps.out(`No change: all ${total} account(s) already existed with their groups.`);
  } else {
    const parts = [
      `${created} created`,
      `${unchanged} already there and unchanged`,
      `${gained} already there and added to groups`,
    ];
    if (failed > 0) parts.push(`${failed} failed`);
    if (notAttempted > 0) parts.push(`${notAttempted} not attempted`);
    deps.out(`${total} account(s): ${parts.join(', ')}.`);
  }
  if (gained > 0) {
    deps.out('A group added to an existing account applies the next time that person signs in.');
  }
  if (report.stopped !== null) {
    deps.err(`Stopped early: ${report.stopped}`);
  }
}

/** `admin` is the operator override; a roster that hands it out should not do so quietly. */
function printAdminNote(roster: readonly RosterEntry[], deps: CliDependencies): void {
  const admins = roster.filter((e) => e.groups.includes('admin'));
  if (admins.length > 0) {
    deps.out(
      `Note: ${admins.length} line(s) of the roster grant the admin group: ${admins.map((e) => e.email).join(', ')}.`,
    );
  }
}

function printPlan(
  roster: readonly RosterEntry[],
  args: Arguments,
  sheetPath: string | null,
  deps: CliDependencies,
): void {
  deps.out(
    `Dry run: no call is made to Cognito, so accounts that already exist are not told apart.`,
  );
  for (const entry of roster) {
    deps.out(
      `  would create or leave as is  ${entry.email}  ${entry.givenName} ${entry.familyName}  (${listGroups(entry.groups)})`,
    );
  }
  printAdminNote(roster, deps);
  deps.out('');
  deps.out(`${roster.length} account(s) on the roster.`);
  deps.out(
    args.suppressMail
      ? 'Invitations: none sent; passwords go to the credentials sheet only.'
      : 'Invitations: sent by e-mail to each new account.',
  );
  deps.out(
    sheetPath
      ? `Credentials sheet: ${sheetPath} (new passwords would be appended).`
      : 'Credentials sheet: none.',
  );
}

async function runProvision(
  args: Arguments,
  rosterPath: string,
  deps: CliDependencies,
): Promise<number> {
  // Order matters: every check that can refuse the command comes before
  // openDirectory, so a bad roster or a bad path costs no call.
  const roster = readRoster(rosterPath, deps);
  const signInUrl = checkSignInUrl(args.signInUrl);
  if (args.suppressMail && !args.credentialsOut) {
    throw new Refusal(
      '--suppress-mail needs --credentials-out: without it nobody would receive the passwords',
    );
  }
  const sheetPath = args.credentialsOut
    ? assertSheetPathAllowed(
        path.resolve(deps.workingDirectory, args.credentialsOut),
        deps.repositoryRoot,
      )
    : null;

  if (args.dryRun) {
    printPlan(roster, args, sheetPath, deps);
    return EXIT_OK;
  }

  const userPoolId = requireUserPoolId(args);
  const sheet = sheetPath ? new CredentialsSheet(sheetPath, signInUrl, deps.now) : null;
  const directory = deps.openDirectory(userPoolId);

  deps.out(
    `Provisioning ${roster.length} account(s) in user pool ${userPoolId}; invitations ${args.suppressMail ? 'suppressed' : 'sent by e-mail'}.`,
  );
  printAdminNote(roster, deps);
  const report = await provisionRoster({
    roster,
    directory,
    suppressMail: args.suppressMail,
    generatePassword: deps.generatePassword,
    recordCredential: (credential) => sheet?.append(credential),
  });
  printReport(report, deps);

  if (sheet) {
    deps.out(
      sheet.rowsWritten > 0
        ? `Credentials sheet: ${sheet.rowsWritten} line(s) appended to ${sheet.path}. It holds passwords: keep it off shared drives and delete it after the hand-out.`
        : `Credentials sheet: nothing to add; ${sheet.path} was not touched.`,
    );
  }

  const clean = report.stopped === null && report.outcomes.every((o) => o.kind !== 'failed');
  return clean ? EXIT_OK : EXIT_FAILED;
}

async function runReset(args: Arguments, rawEmail: string, deps: CliDependencies): Promise<number> {
  if (args.rosterPath) {
    throw new Refusal('--reset-password works on one account; do not pass a roster with it');
  }
  const email = rawEmail.trim().toLowerCase();
  if (!z.email().safeParse(email).success) {
    throw new Refusal(`--reset-password "${rawEmail}" is not an e-mail address`);
  }
  const signInUrl = checkSignInUrl(args.signInUrl);
  if (!args.credentialsOut) {
    throw new Refusal(
      '--reset-password needs --credentials-out: no mail is sent, the new password is only written there',
    );
  }
  const sheetPath = assertSheetPathAllowed(
    path.resolve(deps.workingDirectory, args.credentialsOut),
    deps.repositoryRoot,
  );

  if (args.dryRun) {
    deps.out('Dry run: no call is made to Cognito.');
    deps.out(`  would give ${email} a new temporary password and append it to ${sheetPath}`);
    return EXIT_OK;
  }

  const userPoolId = requireUserPoolId(args);
  const sheet = new CredentialsSheet(sheetPath, signInUrl, deps.now);
  const directory = deps.openDirectory(userPoolId);

  const outcome = await resetTemporaryPassword({
    email,
    directory,
    generatePassword: deps.generatePassword,
    recordCredential: (credential) => sheet.append(credential),
  });
  switch (outcome.kind) {
    case 'not-found':
      deps.err(`${email} has no account in user pool ${userPoolId}. Nothing was changed.`);
      return EXIT_FAILED;
    case 'no-password':
      deps.err(
        `${email} signs in through an external identity provider and has no password here. Nothing was changed.`,
      );
      return EXIT_FAILED;
    case 'reset':
      deps.out(
        `${email} (was ${outcome.previousStatus}) has a new temporary password, appended to ${sheet.path}. No mail was sent: pass it on, and delete the sheet afterwards.`,
      );
      return EXIT_OK;
  }
}

/** Run the command. Returns the process exit code; never calls `process.exit`. */
export async function run(argv: readonly string[], deps: CliDependencies): Promise<number> {
  try {
    const args = readArguments(argv, deps);
    if (args.help) {
      deps.out(USAGE);
      return EXIT_OK;
    }
    if (args.resetEmail !== null) return await runReset(args, args.resetEmail, deps);
    if (args.rosterPath !== null) return await runProvision(args, args.rosterPath, deps);
    throw new Refusal('give a roster file, or --reset-password <email>');
  } catch (err) {
    if (err instanceof Refusal || err instanceof CredentialsSheetPathError) {
      deps.err(`Refused: ${err.message}`);
      deps.err('Run with --help for the options.');
      return EXIT_REFUSED;
    }
    deps.err(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_FAILED;
  }
}

/** The real thing: the process environment and an Amazon Cognito user pool. */
export function defaultDependencies(): CliDependencies {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return {
    env: process.env,
    // `pnpm run` starts the script in this package's folder and keeps the
    // folder the operator was in as INIT_CWD.
    workingDirectory: process.env.INIT_CWD ?? process.cwd(),
    repositoryRoot: path.resolve(here, '..', '..'),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    openDirectory: (userPoolId) => CognitoUserDirectory.forUserPool(userPoolId),
    generatePassword: () => generateTemporaryPassword(),
    now: () => new Date(),
  };
}

import type { PlatformGroup } from '@oci/shared-types';
import type { Credential } from './credentials-sheet.js';
import type { RosterEntry } from './roster.js';
import {
  DirectoryAccessError,
  UserAlreadyExistsError,
  type DirectoryUser,
  type UserDirectory,
} from './user-directory.js';

/**
 * Bulk provisioning proper: for each person on the roster, make the account
 * if there is none, then add the groups it lacks.
 *
 * Running it again is safe. An account that exists is left as it is (name,
 * password and status untouched) and only gains the roster groups it does not
 * hold yet; nothing is ever removed. A run that stopped half-way is finished
 * by running the same command again.
 */

export type AccountOutcome =
  | { kind: 'created'; entry: RosterEntry; groupsAdded: PlatformGroup[] }
  | {
      kind: 'existing';
      entry: RosterEntry;
      status: string;
      enabled: boolean;
      groupsAdded: PlatformGroup[];
      /** Groups the account holds that the roster does not ask for. Left alone. */
      otherGroups: string[];
    }
  | {
      kind: 'failed';
      entry: RosterEntry;
      /** True when the account was made in this run before the failure. */
      created: boolean;
      groupsAdded: PlatformGroup[];
      message: string;
    }
  /** Not attempted: the run stopped before reaching this person. */
  | { kind: 'not-attempted'; entry: RosterEntry };

export interface ProvisionReport {
  outcomes: AccountOutcome[];
  /** Why the run stopped early, or null when everyone was attempted. */
  stopped: string | null;
}

export interface ProvisionOptions {
  roster: readonly RosterEntry[];
  directory: UserDirectory;
  /** True: the directory sends no invitation; passwords reach people on paper. */
  suppressMail: boolean;
  generatePassword: () => string;
  /**
   * Called once per account made, straight after it is made and before its
   * groups are added, so a password is on record even if the run then stops.
   */
  recordCredential: (credential: Credential) => void;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A failure that must stop the whole run, with the text to show for it. */
class StopRun extends Error {}

export async function provisionRoster(options: ProvisionOptions): Promise<ProvisionReport> {
  const { roster, directory } = options;
  const outcomes: AccountOutcome[] = [];
  let stopped: string | null = null;

  for (const entry of roster) {
    if (stopped !== null) {
      outcomes.push({ kind: 'not-attempted', entry });
      continue;
    }

    let created = false;
    const groupsAdded: PlatformGroup[] = [];
    try {
      let user: DirectoryUser | null = await directory.findByEmail(entry.email);

      if (!user) {
        const temporaryPassword = options.generatePassword();
        try {
          user = await directory.createUser({
            email: entry.email,
            givenName: entry.givenName,
            familyName: entry.familyName,
            temporaryPassword,
            suppressInvitation: options.suppressMail,
          });
          created = true;
        } catch (err) {
          // Someone signed up between the lookup and the create.
          if (!(err instanceof UserAlreadyExistsError)) throw err;
          user = await directory.findByEmail(entry.email);
          if (!user) throw err;
        }
        if (created) {
          try {
            options.recordCredential({
              email: entry.email,
              givenName: entry.givenName,
              familyName: entry.familyName,
              groups: entry.groups,
              temporaryPassword,
              reason: 'created',
            });
          } catch (err) {
            throw new StopRun(
              `the account for ${entry.email} was made but its temporary password could not be written to the credentials sheet (${describe(err)}). Issue a new one with --reset-password ${entry.email}.`,
            );
          }
        }
      }

      const held = created ? [] : await directory.listGroups(user.username);
      for (const group of entry.groups) {
        if (held.includes(group)) continue;
        await directory.addToGroup(user.username, group);
        groupsAdded.push(group);
      }

      if (created) {
        outcomes.push({ kind: 'created', entry, groupsAdded });
      } else {
        const wanted: readonly string[] = entry.groups;
        outcomes.push({
          kind: 'existing',
          entry,
          status: user.status,
          enabled: user.enabled,
          groupsAdded,
          otherGroups: held.filter((g) => !wanted.includes(g)),
        });
      }
    } catch (err) {
      outcomes.push({ kind: 'failed', entry, created, groupsAdded, message: describe(err) });
      if (err instanceof DirectoryAccessError || err instanceof StopRun) {
        stopped = describe(err);
      }
    }
  }

  return { outcomes, stopped };
}

export type ResetOutcome =
  | { kind: 'reset'; email: string; previousStatus: string }
  | { kind: 'not-found'; email: string }
  /** Signs in through an external identity provider: there is no password to reset. */
  | { kind: 'no-password'; email: string };

export interface ResetOptions {
  email: string;
  directory: UserDirectory;
  generatePassword: () => string;
  recordCredential: (credential: Credential) => void;
}

/**
 * Give one existing account a new temporary password, for the person whose
 * first one expired or was lost. The directory sends no message for this: the
 * password goes to the credentials sheet and the operator passes it on.
 */
export async function resetTemporaryPassword(options: ResetOptions): Promise<ResetOutcome> {
  const { email, directory } = options;
  const user = await directory.findByEmail(email);
  if (!user) return { kind: 'not-found', email };
  if (user.status === 'EXTERNAL_PROVIDER') return { kind: 'no-password', email };

  const previousStatus = user.status;
  // Read before the write, so a failure here leaves the old password valid.
  const groups = await directory.listGroups(user.username);
  const temporaryPassword = options.generatePassword();
  await directory.setTemporaryPassword(user.username, temporaryPassword);
  options.recordCredential({
    email,
    givenName: user.givenName ?? '',
    familyName: user.familyName ?? '',
    groups,
    temporaryPassword,
    reason: 'reset',
  });
  return { kind: 'reset', email, previousStatus };
}

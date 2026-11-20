import type { PlatformGroup } from '@oci/shared-types';

/**
 * The few directory operations bulk provisioning needs. The script talks to
 * this interface only, so the tests run against an in-memory fake and never
 * reach a real user pool.
 */
export interface UserDirectory {
  /** The account that signs in with this e-mail, or null when there is none. */
  findByEmail(email: string): Promise<DirectoryUser | null>;
  /**
   * Create an account whose e-mail is already marked verified and whose
   * password is temporary: the person must choose their own at first sign-in.
   *
   * @throws UserAlreadyExistsError when the e-mail is taken.
   */
  createUser(user: NewUser): Promise<DirectoryUser>;
  /** Names of the groups the account is in (may include groups the platform does not know). */
  listGroups(username: string): Promise<string[]>;
  addToGroup(username: string, group: PlatformGroup): Promise<void>;
  /** Replace the password with a temporary one. Sends no message. */
  setTemporaryPassword(username: string, temporaryPassword: string): Promise<void>;
}

export interface DirectoryUser {
  /** The directory's own identifier for the account; not the e-mail. */
  username: string;
  /** Directory status, for example `FORCE_CHANGE_PASSWORD` or `CONFIRMED`. */
  status: string;
  enabled: boolean;
  givenName: string | null;
  familyName: string | null;
}

export interface NewUser {
  email: string;
  givenName: string;
  familyName: string;
  temporaryPassword: string;
  /** True: the directory sends no invitation; the operator hands the password over. */
  suppressInvitation: boolean;
}

/**
 * The directory cannot be used at all: expired or missing credentials, a
 * role without the permission, a user pool that does not exist. Trying the
 * next person would fail the same way, so the run stops.
 */
export class DirectoryAccessError extends Error {
  override readonly name = 'DirectoryAccessError';
}

export class UserAlreadyExistsError extends Error {
  override readonly name = 'UserAlreadyExistsError';
}

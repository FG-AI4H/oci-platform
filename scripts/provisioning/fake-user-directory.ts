import type { PlatformGroup } from '@oci/shared-types';
import {
  UserAlreadyExistsError,
  type DirectoryUser,
  type NewUser,
  type UserDirectory,
} from './user-directory.js';

interface StoredUser extends DirectoryUser {
  email: string;
  groups: string[];
  temporaryPassword: string | null;
  invited: boolean;
}

export type DirectoryCall =
  | { op: 'findByEmail'; email: string }
  | { op: 'createUser'; email: string; suppressInvitation: boolean }
  | { op: 'listGroups'; username: string }
  | { op: 'addToGroup'; username: string; group: PlatformGroup }
  | { op: 'setTemporaryPassword'; username: string };

/** What a real directory hands back: a copy, not a live view of its own record. */
function snapshot(user: StoredUser): DirectoryUser {
  return {
    username: user.username,
    status: user.status,
    enabled: user.enabled,
    givenName: user.givenName,
    familyName: user.familyName,
  };
}

const WRITES: ReadonlySet<DirectoryCall['op']> = new Set([
  'createUser',
  'addToGroup',
  'setTemporaryPassword',
]);

/**
 * In-memory `UserDirectory` for the tests. It keeps every call it receives,
 * so a test can assert not only the end state but that nothing was written
 * (or nothing was called at all).
 */
export class FakeUserDirectory implements UserDirectory {
  readonly calls: DirectoryCall[] = [];
  private readonly users = new Map<string, StoredUser>();
  private readonly failures = new Map<string, Error>();
  private sequence = 0;

  /** Put an account in the directory without going through `createUser`. */
  seed(email: string, user: Partial<Omit<StoredUser, 'email'>> = {}): StoredUser {
    this.sequence += 1;
    const stored: StoredUser = {
      email,
      username: `user-${this.sequence}`,
      status: 'CONFIRMED',
      enabled: true,
      givenName: null,
      familyName: null,
      groups: [],
      temporaryPassword: null,
      invited: false,
      ...user,
    };
    this.users.set(email, stored);
    return stored;
  }

  /** Make the next and every later call of `op` that mentions `subject` throw. */
  failOn(op: DirectoryCall['op'], subject: string, error: Error): void {
    this.failures.set(`${op}:${subject}`, error);
  }

  clearFailures(): void {
    this.failures.clear();
  }

  get writes(): DirectoryCall[] {
    return this.calls.filter((c) => WRITES.has(c.op));
  }

  user(email: string): StoredUser | undefined {
    return this.users.get(email);
  }

  private byUsername(username: string): StoredUser {
    for (const user of this.users.values()) {
      if (user.username === username) return user;
    }
    throw new Error(`fake directory: no user ${username}`);
  }

  private maybeFail(op: DirectoryCall['op'], subject: string): void {
    const failure = this.failures.get(`${op}:${subject}`);
    if (failure) throw failure;
  }

  async findByEmail(email: string): Promise<DirectoryUser | null> {
    this.calls.push({ op: 'findByEmail', email });
    this.maybeFail('findByEmail', email);
    const stored = this.users.get(email);
    return stored ? snapshot(stored) : null;
  }

  async createUser(user: NewUser): Promise<DirectoryUser> {
    this.calls.push({
      op: 'createUser',
      email: user.email,
      suppressInvitation: user.suppressInvitation,
    });
    this.maybeFail('createUser', user.email);
    if (this.users.has(user.email)) {
      throw new UserAlreadyExistsError(`${user.email} already has an account`);
    }
    return snapshot(
      this.seed(user.email, {
        status: 'FORCE_CHANGE_PASSWORD',
        givenName: user.givenName,
        familyName: user.familyName,
        temporaryPassword: user.temporaryPassword,
        invited: !user.suppressInvitation,
      }),
    );
  }

  async listGroups(username: string): Promise<string[]> {
    this.calls.push({ op: 'listGroups', username });
    this.maybeFail('listGroups', username);
    return [...this.byUsername(username).groups];
  }

  async addToGroup(username: string, group: PlatformGroup): Promise<void> {
    this.calls.push({ op: 'addToGroup', username, group });
    this.maybeFail('addToGroup', group);
    const user = this.byUsername(username);
    if (!user.groups.includes(group)) user.groups.push(group);
  }

  async setTemporaryPassword(username: string, temporaryPassword: string): Promise<void> {
    this.calls.push({ op: 'setTemporaryPassword', username });
    this.maybeFail('setTemporaryPassword', username);
    const user = this.byUsername(username);
    user.temporaryPassword = temporaryPassword;
    user.status = 'FORCE_CHANGE_PASSWORD';
  }
}

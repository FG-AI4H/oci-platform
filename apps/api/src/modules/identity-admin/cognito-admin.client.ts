import { Injectable, Logger } from '@nestjs/common';
import {
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type AttributeType,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import type { AdminUserSummary, CognitoUserStatus, PlatformGroup } from '@oci/shared-types';

/**
 * Thin wrapper around `@aws-sdk/client-cognito-identity-provider` that
 * normalises the SDK's `UserType` shape into the platform's
 * `AdminUserSummary` contract.
 *
 * The pool ID is read from env at construct time (`COGNITO_USER_POOL_ID`,
 * injected by CDK into the ECS task definition). Local-dev provides a
 * stub value; the dev bypass below short-circuits the SDK calls so
 * developers without AWS creds can still browse `/admin/users`.
 */
@Injectable()
export class CognitoAdminClient {
  private readonly logger = new Logger(CognitoAdminClient.name);
  private readonly userPoolId: string;
  private readonly client: CognitoIdentityProviderClient | null;
  private readonly isLocal: boolean;

  constructor() {
    this.userPoolId = process.env.COGNITO_USER_POOL_ID ?? '';
    this.isLocal = process.env.OCI_ENV === 'local';

    if (this.isLocal) {
      // Dev: don't construct an SDK client — the methods below short
      // circuit to in-memory stubs so admin UI work doesn't require an
      // AWS account.
      this.client = null;
      this.logger.warn('OCI_ENV=local — Cognito admin client uses in-memory stub');
    } else {
      const region = process.env.COGNITO_REGION ?? process.env.AWS_REGION ?? 'eu-central-1';
      this.client = new CognitoIdentityProviderClient({ region });
    }
  }

  async listUsers(args: {
    cursor: string | null;
    limit: number;
    search: string | null;
  }): Promise<{ users: AdminUserSummary[]; nextCursor: string | null }> {
    if (this.isLocal) {
      return this.listUsersStub(args);
    }
    if (!this.client) throw new Error('Cognito client not initialised');

    const out = await this.client.send(
      new ListUsersCommand({
        UserPoolId: this.userPoolId,
        Limit: args.limit,
        PaginationToken: args.cursor ?? undefined,
        // Cognito's `Filter` is a tiny DSL — `email ^= "foo"` is
        // prefix-match. Bare strings aren't supported, so coerce the
        // search box into the prefix form when it looks like the start
        // of an email; otherwise pass through username prefix.
        Filter: args.search
          ? args.search.includes('@')
            ? `email ^= "${escapeFilter(args.search)}"`
            : `username ^= "${escapeFilter(args.search)}"`
          : undefined,
      }),
    );

    const summaries = await Promise.all((out.Users ?? []).map((u) => this.summariseUser(u)));
    return { users: summaries, nextCursor: out.PaginationToken ?? null };
  }

  async getUser(username: string): Promise<AdminUserSummary | null> {
    if (this.isLocal) {
      return this.getUserStub(username);
    }
    if (!this.client) throw new Error('Cognito client not initialised');

    try {
      const detail = await this.client.send(
        new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: username }),
      );
      const groups = await this.client.send(
        new AdminListGroupsForUserCommand({ UserPoolId: this.userPoolId, Username: username }),
      );
      return {
        sub: pickAttribute(detail.UserAttributes ?? [], 'sub') ?? username,
        username: detail.Username ?? username,
        email: pickAttribute(detail.UserAttributes ?? [], 'email'),
        emailVerified: pickAttribute(detail.UserAttributes ?? [], 'email_verified') === 'true',
        status: (detail.UserStatus as CognitoUserStatus | undefined) ?? 'UNKNOWN',
        groups: (groups.Groups ?? []).map((g) => g.GroupName ?? '').filter(isPlatformGroup),
        createdAt: detail.UserCreateDate?.toISOString() ?? new Date(0).toISOString(),
        lastSeen: detail.UserLastModifiedDate?.toISOString() ?? null,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'UserNotFoundException') {
        return null;
      }
      throw err;
    }
  }

  async addUserToGroup(username: string, group: PlatformGroup): Promise<void> {
    if (this.isLocal) {
      this.addUserToGroupStub(username, group);
      return;
    }
    if (!this.client) throw new Error('Cognito client not initialised');
    await this.client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: this.userPoolId,
        Username: username,
        GroupName: group,
      }),
    );
  }

  async removeUserFromGroup(username: string, group: PlatformGroup): Promise<void> {
    if (this.isLocal) {
      this.removeUserFromGroupStub(username, group);
      return;
    }
    if (!this.client) throw new Error('Cognito client not initialised');
    await this.client.send(
      new AdminRemoveUserFromGroupCommand({
        UserPoolId: this.userPoolId,
        Username: username,
        GroupName: group,
      }),
    );
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  private async summariseUser(u: UserType): Promise<AdminUserSummary> {
    if (this.isLocal) throw new Error('summariseUser called in stub mode');
    if (!this.client) throw new Error('Cognito client not initialised');

    const username = u.Username ?? '';
    let groups: PlatformGroup[] = [];
    if (username) {
      try {
        const g = await this.client.send(
          new AdminListGroupsForUserCommand({
            UserPoolId: this.userPoolId,
            Username: username,
          }),
        );
        groups = (g.Groups ?? []).map((row) => row.GroupName ?? '').filter(isPlatformGroup);
      } catch {
        // Best-effort. If group fetch fails we still surface the row
        // so admins can see the user exists.
      }
    }

    return {
      sub: pickAttribute(u.Attributes ?? [], 'sub') ?? username,
      username,
      email: pickAttribute(u.Attributes ?? [], 'email'),
      emailVerified: pickAttribute(u.Attributes ?? [], 'email_verified') === 'true',
      status: (u.UserStatus as CognitoUserStatus | undefined) ?? 'UNKNOWN',
      groups,
      createdAt: u.UserCreateDate?.toISOString() ?? new Date(0).toISOString(),
      lastSeen: u.UserLastModifiedDate?.toISOString() ?? null,
    };
  }

  // -------------------------------------------------------------------
  // Local-dev stub — in-memory user list + group mutations. Seeded with
  // a few personas (admin, host, campaign-manager, participant) so the
  // admin UI has something to show on a fresh dev environment.
  // -------------------------------------------------------------------

  private static readonly stubUsers = new Map<string, StubUser>(
    (
      [
        { username: 'alice', email: 'alice@oci.local', groups: ['admin'] },
        { username: 'bob', email: 'bob@oci.local', groups: ['host'] },
        { username: 'cm', email: 'cm@oci.local', groups: ['campaign-manager'] },
        { username: 'eve', email: 'eve@oci.local', groups: ['participant'] },
      ] as const
    ).map((u) => [
      u.username,
      {
        username: u.username,
        sub: u.username,
        email: u.email,
        groups: new Set<PlatformGroup>(u.groups as readonly PlatformGroup[]),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        lastSeen: new Date('2026-05-16T00:00:00Z'),
      },
    ]),
  );

  private listUsersStub(args: { cursor: string | null; limit: number; search: string | null }): {
    users: AdminUserSummary[];
    nextCursor: string | null;
  } {
    const all = Array.from(CognitoAdminClient.stubUsers.values())
      .filter((u) => {
        if (!args.search) return true;
        const q = args.search.toLowerCase();
        return (
          u.username.toLowerCase().includes(q) ||
          (u.email !== null && u.email.toLowerCase().includes(q))
        );
      })
      .slice(0, args.limit);
    return {
      users: all.map((u) => stubToSummary(u)),
      nextCursor: null,
    };
  }

  private getUserStub(username: string): AdminUserSummary | null {
    const u = CognitoAdminClient.stubUsers.get(username);
    return u ? stubToSummary(u) : null;
  }

  private addUserToGroupStub(username: string, group: PlatformGroup): void {
    const u = CognitoAdminClient.stubUsers.get(username);
    if (!u) throw new Error(`stub user '${username}' not found`);
    u.groups.add(group);
  }

  private removeUserFromGroupStub(username: string, group: PlatformGroup): void {
    const u = CognitoAdminClient.stubUsers.get(username);
    if (!u) throw new Error(`stub user '${username}' not found`);
    u.groups.delete(group);
  }
}

// ---------------------------------------------------------------------------
// Local stub helpers (only referenced when OCI_ENV=local).
// ---------------------------------------------------------------------------

interface StubUser {
  username: string;
  sub: string;
  email: string | null;
  groups: Set<PlatformGroup>;
  createdAt: Date;
  lastSeen: Date;
}

function stubToSummary(u: StubUser): AdminUserSummary {
  return {
    sub: u.sub,
    username: u.username,
    email: u.email,
    emailVerified: true,
    status: 'CONFIRMED',
    groups: Array.from(u.groups),
    createdAt: u.createdAt.toISOString(),
    lastSeen: u.lastSeen.toISOString(),
  };
}

const PLATFORM_GROUPS: ReadonlySet<PlatformGroup> = new Set([
  'admin',
  'host',
  'campaign-manager',
  'task-supervisor',
  'reviewer',
  'arbitration-annotator',
  'expert-reviewer',
  'annotator',
  'supervisor',
  'regulator',
  'participant',
]);

function isPlatformGroup(s: string): s is PlatformGroup {
  return PLATFORM_GROUPS.has(s as PlatformGroup);
}

function pickAttribute(attrs: AttributeType[], name: string): string | null {
  for (const a of attrs) {
    if (a.Name === name) return a.Value ?? null;
  }
  return null;
}

function escapeFilter(s: string): string {
  // Cognito Filter values are quoted; only `"` and `\` need escaping.
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

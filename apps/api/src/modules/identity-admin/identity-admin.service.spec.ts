import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuditEmitter } from '@oci/audit';
import type { AdminUserSummary, PlatformGroup } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CognitoAdminClient } from './cognito-admin.client.js';
import { IdentityAdminRepository } from './identity-admin.repository.js';
import { IdentityAdminService } from './identity-admin.service.js';

const SUMMARY: AdminUserSummary = {
  sub: 'bob-sub',
  username: 'bob',
  email: 'bob@oci.local',
  emailVerified: true,
  status: 'CONFIRMED',
  groups: ['host'],
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeen: '2026-05-16T00:00:00.000Z',
};

function actor(overrides: Partial<CognitoAccessTokenPayload> = {}): CognitoAccessTokenPayload {
  return {
    sub: 'alice-sub',
    username: 'alice',
    ...overrides,
  } as unknown as CognitoAccessTokenPayload;
}

interface CognitoMock {
  listUsers: ReturnType<typeof vi.fn>;
  getUser: ReturnType<typeof vi.fn>;
  addUserToGroup: ReturnType<typeof vi.fn>;
  removeUserFromGroup: ReturnType<typeof vi.fn>;
}

interface RepoMock {
  recordEvent: ReturnType<typeof vi.fn>;
  listForTarget: ReturnType<typeof vi.fn>;
}

interface AuditMock {
  emit: ReturnType<typeof vi.fn>;
  emitSync: ReturnType<typeof vi.fn>;
}

let cognito: CognitoMock;
let repo: RepoMock;
let audit: AuditMock;
let service: IdentityAdminService;

beforeEach(() => {
  cognito = {
    listUsers: vi.fn(),
    getUser: vi.fn(),
    addUserToGroup: vi.fn(),
    removeUserFromGroup: vi.fn(),
  };
  repo = {
    recordEvent: vi.fn().mockResolvedValue({}),
    listForTarget: vi.fn().mockResolvedValue([]),
  };
  audit = {
    emit: vi.fn().mockResolvedValue(undefined),
    emitSync: vi.fn().mockResolvedValue({}),
  };
  service = new IdentityAdminService(
    cognito as unknown as CognitoAdminClient,
    repo as unknown as IdentityAdminRepository,
    audit as unknown as AuditEmitter,
  );
});

describe('IdentityAdminService.grant', () => {
  it('adds the group and records an audit event', async () => {
    cognito.getUser
      .mockResolvedValueOnce(SUMMARY)
      .mockResolvedValueOnce({ ...SUMMARY, groups: ['host', 'campaign-manager'] });

    await service.grant('bob', 'campaign-manager' as PlatformGroup, actor());

    expect(cognito.addUserToGroup).toHaveBeenCalledWith('bob', 'campaign-manager');
    expect(repo.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'grant',
        groupName: 'campaign-manager',
        targetUsername: 'bob',
      }),
    );
    expect(audit.emitSync).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'identity',
        action: 'role.granted',
        subjectType: 'user',
      }),
    );
  });

  it('is idempotent when the group is already present', async () => {
    cognito.getUser
      .mockResolvedValueOnce({ ...SUMMARY, groups: ['host', 'campaign-manager'] })
      .mockResolvedValueOnce({ ...SUMMARY, groups: ['host', 'campaign-manager'] });

    await service.grant('bob', 'campaign-manager' as PlatformGroup, actor());

    expect(cognito.addUserToGroup).not.toHaveBeenCalled();
    expect(repo.recordEvent).not.toHaveBeenCalled();
  });

  it('404s when the user does not exist', async () => {
    cognito.getUser.mockResolvedValue(null);

    await expect(
      service.grant('nope', 'campaign-manager' as PlatformGroup, actor()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('surfaces a clear error when the Cognito group is not provisioned', async () => {
    cognito.getUser.mockResolvedValueOnce(SUMMARY);
    cognito.addUserToGroup.mockRejectedValueOnce(
      Object.assign(new Error('Group not found.'), { name: 'ResourceNotFoundException' }),
    );

    await expect(
      service.grant('bob', 'campaign-manager' as PlatformGroup, actor()),
    ).rejects.toMatchObject({ message: expect.stringContaining('not provisioned') });
    // No audit row for a grant that never happened.
    expect(repo.recordEvent).not.toHaveBeenCalled();
    expect(audit.emitSync).not.toHaveBeenCalled();
  });
});

describe('IdentityAdminService.revoke', () => {
  it('removes the group and records an audit event', async () => {
    cognito.getUser
      .mockResolvedValueOnce({ ...SUMMARY, groups: ['host', 'campaign-manager'] })
      .mockResolvedValueOnce({ ...SUMMARY, groups: ['host'] });

    await service.revoke('bob', 'campaign-manager' as PlatformGroup, actor());

    expect(cognito.removeUserFromGroup).toHaveBeenCalledWith('bob', 'campaign-manager');
    expect(repo.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'revoke', groupName: 'campaign-manager' }),
    );
    expect(audit.emitSync).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'identity', action: 'role.revoked' }),
    );
  });

  it('blocks revoking your own admin group (sub match)', async () => {
    const me: AdminUserSummary = {
      ...SUMMARY,
      sub: 'alice-sub',
      username: 'alice',
      groups: ['admin'],
    };
    cognito.getUser.mockResolvedValue(me);

    await expect(service.revoke('alice', 'admin' as PlatformGroup, actor())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(cognito.removeUserFromGroup).not.toHaveBeenCalled();
  });

  it('blocks revoking your own admin group (username match)', async () => {
    const me: AdminUserSummary = {
      ...SUMMARY,
      sub: 'different-sub',
      username: 'alice',
      groups: ['admin'],
    };
    cognito.getUser.mockResolvedValue(me);

    await expect(
      service.revoke('alice', 'admin' as PlatformGroup, actor({ sub: 'something-else' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permits revoking your OWN non-admin group', async () => {
    const me: AdminUserSummary = {
      ...SUMMARY,
      sub: 'alice-sub',
      username: 'alice',
      groups: ['admin', 'host'],
    };
    cognito.getUser.mockResolvedValueOnce(me).mockResolvedValueOnce({ ...me, groups: ['admin'] });

    await service.revoke('alice', 'host' as PlatformGroup, actor());

    expect(cognito.removeUserFromGroup).toHaveBeenCalledWith('alice', 'host');
  });

  it('permits another admin to revoke admin from someone else', async () => {
    const target: AdminUserSummary = { ...SUMMARY, groups: ['admin'] };
    cognito.getUser.mockResolvedValueOnce(target).mockResolvedValueOnce({ ...target, groups: [] });

    await service.revoke('bob', 'admin' as PlatformGroup, actor());

    expect(cognito.removeUserFromGroup).toHaveBeenCalledWith('bob', 'admin');
  });

  it('is idempotent when the group is already absent', async () => {
    cognito.getUser.mockResolvedValue(SUMMARY);

    await service.revoke('bob', 'campaign-manager' as PlatformGroup, actor());

    expect(cognito.removeUserFromGroup).not.toHaveBeenCalled();
  });

  it('404s when the user does not exist', async () => {
    cognito.getUser.mockResolvedValue(null);

    await expect(service.revoke('nope', 'host' as PlatformGroup, actor())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('IdentityAdminService.getUser', () => {
  it('returns detail + recent audit events', async () => {
    cognito.getUser.mockResolvedValue(SUMMARY);
    repo.listForTarget.mockResolvedValue([
      {
        id: 'evt-1',
        actorSub: 'alice-uuid',
        actorUsername: 'alice',
        targetSub: 'bob-sub',
        targetUsername: 'bob',
        action: 'grant',
        groupName: 'host',
        createdAt: new Date('2026-05-15T00:00:00Z'),
      },
    ]);

    const out = await service.getUser('bob');

    expect(out.recentAuditEvents).toHaveLength(1);
    expect(out.recentAuditEvents[0]?.action).toBe('grant');
    expect(out.recentAuditEvents[0]?.group).toBe('host');
  });

  it('404s when the user is unknown', async () => {
    cognito.getUser.mockResolvedValue(null);

    await expect(service.getUser('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

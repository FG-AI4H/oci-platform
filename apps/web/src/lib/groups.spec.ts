import { describe, expect, it } from 'vitest';
import type { Session } from 'next-auth';
import { isAdmin, isHost, userGroups } from './groups';

function s(accessToken?: string): Session | null {
  if (!accessToken) return null;
  return {
    user: { name: 'test', email: 'test@example.com' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
    accessToken,
  };
}

function jwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

describe('userGroups', () => {
  it('returns [] when no session', () => {
    expect(userGroups(null)).toEqual([]);
    expect(userGroups(undefined)).toEqual([]);
  });

  it('returns [] when no access token', () => {
    expect(userGroups({ user: {}, expires: '' } as unknown as Session)).toEqual([]);
  });

  it('parses dev sentinel: dev:<user>:<roles>', () => {
    expect(userGroups(s('dev:alice@example.com:host,admin'))).toEqual(['host', 'admin']);
  });

  it('parses dev sentinel with single role', () => {
    expect(userGroups(s('dev:bob:host'))).toEqual(['host']);
  });

  it('handles dev sentinel where user contains colons', () => {
    // The user portion can contain anything pre-colon; the LAST colon
    // delimits the roles segment.
    expect(userGroups(s('dev:auth0|abc:def:participant'))).toEqual(['participant']);
  });

  it('decodes cognito:groups from a JWT access token', () => {
    const token = jwt({ sub: 'uuid', 'cognito:groups': ['host', 'participant'] });
    expect(userGroups(s(token))).toEqual(['host', 'participant']);
  });

  it('returns [] when JWT has no cognito:groups claim', () => {
    expect(userGroups(s(jwt({ sub: 'uuid' })))).toEqual([]);
  });

  it('returns [] when JWT is malformed', () => {
    expect(userGroups(s('not.a.jwt'))).toEqual([]);
    expect(userGroups(s('only-one-segment'))).toEqual([]);
  });

  it('filters non-string entries from cognito:groups', () => {
    const token = jwt({ 'cognito:groups': ['host', 42, null, 'admin'] });
    expect(userGroups(s(token))).toEqual(['host', 'admin']);
  });
});

describe('isHost', () => {
  it('true for host group', () => {
    expect(isHost(s('dev:alice:host'))).toBe(true);
  });
  it('true for admin group (admin implies host)', () => {
    expect(isHost(s('dev:alice:admin'))).toBe(true);
  });
  it('false for participant', () => {
    expect(isHost(s('dev:alice:participant'))).toBe(false);
  });
  it('false when no token', () => {
    expect(isHost(null)).toBe(false);
  });
});

describe('isAdmin', () => {
  it('true only for the admin group', () => {
    expect(isAdmin(s('dev:alice:admin'))).toBe(true);
  });
  it('false for host (admin is the strict superset)', () => {
    expect(isAdmin(s('dev:alice:host'))).toBe(false);
  });
  it('false for unauthenticated', () => {
    expect(isAdmin(null)).toBe(false);
  });
});

import type { Session } from 'next-auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  sessionAccessToken: vi.fn(),
  signOut: vi.fn(),
  referer: null as string | null,
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock('../auth', () => ({
  auth: mocks.auth,
  sessionAccessToken: mocks.sessionAccessToken,
  signOut: mocks.signOut,
}));
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => (name === 'referer' ? mocks.referer : null),
  }),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import {
  accessTokenAfterRejection,
  currentPagePath,
  endExpiredSession,
  sessionForAction,
} from './session-recovery';
import { resetTokenRefreshState, wasAccessTokenRejected } from './token-refresh';

const signedIn: Session = { user: { id: 'user-1', email: 'reader@example.org' }, expires: '' };

beforeEach(() => {
  resetTokenRefreshState();
  mocks.auth.mockReset();
  mocks.sessionAccessToken.mockReset();
  mocks.signOut.mockReset();
  mocks.redirect.mockClear();
  mocks.referer = null;
});

describe('accessTokenAfterRejection', () => {
  it('marks the refused token, reads the session again and returns the renewed token', async () => {
    mocks.sessionAccessToken.mockImplementation(async () => {
      // The session callback must already see the mark when it runs.
      expect(wasAccessTokenRejected('access-1')).toBe(true);
      return 'access-2';
    });
    expect(await accessTokenAfterRejection('access-1')).toEqual({
      status: 'renewed',
      accessToken: 'access-2',
    });
  });

  it('reports the session unchanged when reading it again yields the same token', async () => {
    // The pool did not answer: the session stands, there is just no new token.
    mocks.sessionAccessToken.mockResolvedValue('access-1');
    expect(await accessTokenAfterRejection('access-1')).toEqual({ status: 'unchanged' });
  });

  it('reports the session ended when it is gone', async () => {
    mocks.sessionAccessToken.mockResolvedValue(null);
    expect(await accessTokenAfterRejection('access-1')).toEqual({ status: 'ended' });
  });
});

describe('sessionForAction', () => {
  it('returns the session of a signed-in caller', async () => {
    mocks.auth.mockResolvedValue(signedIn);
    expect(await sessionForAction()).toBe(signedIn);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('sends a caller whose session has ended to sign in, with the way back to the form', async () => {
    mocks.auth.mockResolvedValue(null);
    mocks.referer = 'https://dev.oci.ai4h.net/catalog/idrid/request-access';
    await expect(sessionForAction()).rejects.toThrow(
      'REDIRECT /signin?reason=expired&callbackUrl=%2Fcatalog%2Fidrid%2Frequest-access',
    );
  });

  it('treats a session without a user as ended', async () => {
    mocks.auth.mockResolvedValue({ expires: '' });
    await expect(sessionForAction('/settings')).rejects.toThrow(
      'REDIRECT /signin?reason=expired&callbackUrl=%2Fsettings',
    );
  });
});

describe('currentPagePath', () => {
  it('is the path and query of the page the request came from', async () => {
    mocks.referer = 'https://dev.oci.ai4h.net/catalog/idrid/request-access?step=2';
    expect(await currentPagePath()).toBe('/catalog/idrid/request-access?step=2');
  });

  it('falls back to the dashboard without a usable Referer', async () => {
    expect(await currentPagePath()).toBe('/dashboard');
    mocks.referer = 'not a url';
    expect(await currentPagePath()).toBe('/dashboard');
  });

  it('never yields another origin, whatever the Referer says', async () => {
    mocks.referer = 'https://evil.example//evil.example/path';
    expect(await currentPagePath()).toBe('/dashboard');
    mocks.referer = 'https://evil.example/settings';
    expect(await currentPagePath()).toBe('/settings');
  });
});

describe('endExpiredSession', () => {
  it('signs out, then sends the user to sign in with the way back to the page', async () => {
    mocks.referer = 'https://dev.oci.ai4h.net/settings';
    await expect(endExpiredSession()).rejects.toThrow(
      'REDIRECT /signin?reason=expired&callbackUrl=%2Fsettings',
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('uses the page the caller names over the Referer', async () => {
    mocks.referer = 'https://dev.oci.ai4h.net/somewhere-else';
    await expect(endExpiredSession('/catalog/idrid/publish')).rejects.toThrow(
      'REDIRECT /signin?reason=expired&callbackUrl=%2Fcatalog%2Fidrid%2Fpublish',
    );
  });

  it('refuses a return path that leaves the site', async () => {
    await expect(endExpiredSession('//evil.example')).rejects.toThrow(
      'REDIRECT /signin?reason=expired&callbackUrl=%2Fdashboard',
    );
  });

  it('does not sign out while a page renders: the cookie could not be cleared, only the token revoked', async () => {
    await expect(endExpiredSession('/settings', { rendering: true })).rejects.toThrow(
      'REDIRECT /signin?reason=expired&callbackUrl=%2Fsettings',
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});

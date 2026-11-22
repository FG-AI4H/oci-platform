import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessionAccessToken: vi.fn(),
  accessTokenAfterRejection: vi.fn(),
  endExpiredSession: vi.fn(),
}));
vi.mock('../auth', () => ({ sessionAccessToken: mocks.sessionAccessToken }));
vi.mock('./session-recovery', () => ({
  accessTokenAfterRejection: mocks.accessTokenAfterRejection,
  endExpiredSession: mocks.endExpiredSession,
}));

import { fetchAsUser } from './api-action';

const URL_ = 'http://api.test/v2/preferences/me';

class SignedOut extends Error {}

function apiAnswering(...statuses: number[]) {
  const seen: { authorization: string | undefined; body: unknown }[] = [];
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ authorization: headers.Authorization, body: init?.body });
    return new Response('{}', { status: statuses[seen.length - 1] ?? 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, seen };
}

beforeEach(() => {
  mocks.sessionAccessToken.mockReset().mockResolvedValue('access-1');
  mocks.accessTokenAfterRejection.mockReset();
  mocks.endExpiredSession.mockReset();
  // The real one redirects, which throws; it never returns.
  mocks.endExpiredSession.mockImplementation(async () => {
    throw new SignedOut();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchAsUser', () => {
  it('reads the token from the session, sends it as bearer and returns the answer', async () => {
    const { seen } = apiAnswering(200);
    const res = await fetchAsUser(URL_, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"darkMode":"dark"}',
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ authorization: 'Bearer access-1', body: '{"darkMode":"dark"}' }]);
    expect(mocks.accessTokenAfterRejection).not.toHaveBeenCalled();
  });

  it('on 401 renews the token once and sends the same request again', async () => {
    const { seen } = apiAnswering(401, 201);
    mocks.accessTokenAfterRejection.mockResolvedValue({
      status: 'renewed',
      accessToken: 'access-2',
    });

    const res = await fetchAsUser(URL_, { method: 'POST', body: '{"a":1}' });

    expect(res.status).toBe(201);
    expect(mocks.accessTokenAfterRejection).toHaveBeenCalledTimes(1);
    expect(mocks.accessTokenAfterRejection).toHaveBeenCalledWith('access-1');
    expect(seen).toEqual([
      { authorization: 'Bearer access-1', body: '{"a":1}' },
      { authorization: 'Bearer access-2', body: '{"a":1}' },
    ]);
    expect(mocks.endExpiredSession).not.toHaveBeenCalled();
  });

  it('signs the user out when the session is over, without a second request', async () => {
    const { fetchMock } = apiAnswering(401);
    mocks.accessTokenAfterRejection.mockResolvedValue({ status: 'ended' });

    await expect(
      fetchAsUser(URL_, { method: 'POST' }, { returnTo: '/settings' }),
    ).rejects.toBeInstanceOf(SignedOut);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.endExpiredSession).toHaveBeenCalledWith('/settings', { rendering: undefined });
  });

  it('returns the 401 and signs nobody out when the pool could not renew just now', async () => {
    const { fetchMock } = apiAnswering(401);
    mocks.accessTokenAfterRejection.mockResolvedValue({ status: 'unchanged' });

    const res = await fetchAsUser(URL_, { method: 'POST', body: '{"a":1}' });

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.endExpiredSession).not.toHaveBeenCalled();
  });

  it('retries once only: a second 401 signs the user out', async () => {
    const { fetchMock } = apiAnswering(401, 401, 200);
    mocks.accessTokenAfterRejection.mockResolvedValue({
      status: 'renewed',
      accessToken: 'access-2',
    });

    await expect(fetchAsUser(URL_)).rejects.toBeInstanceOf(SignedOut);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.accessTokenAfterRejection).toHaveBeenCalledTimes(1);
    expect(mocks.endExpiredSession).toHaveBeenCalledWith(undefined, { rendering: undefined });
  });

  it('tells the sign-out that a page is rendering, when the caller says so', async () => {
    apiAnswering(401);
    mocks.accessTokenAfterRejection.mockResolvedValue({ status: 'ended' });

    await expect(
      fetchAsUser(URL_, { method: 'POST' }, { returnTo: '/a', rendering: true }),
    ).rejects.toBeInstanceOf(SignedOut);
    expect(mocks.endExpiredSession).toHaveBeenCalledWith('/a', { rendering: true });
  });

  it('returns 403 and other failures untouched: only 401 means the token', async () => {
    for (const status of [403, 404, 409, 500]) {
      apiAnswering(status);
      const res = await fetchAsUser(URL_);
      expect(res.status).toBe(status);
    }
    expect(mocks.accessTokenAfterRejection).not.toHaveBeenCalled();
    expect(mocks.endExpiredSession).not.toHaveBeenCalled();
  });

  it('without a session sends no bearer header and returns the 401 as it is', async () => {
    mocks.sessionAccessToken.mockResolvedValue(null);
    const { seen } = apiAnswering(401);
    const res = await fetchAsUser(URL_);
    expect(res.status).toBe(401);
    expect(seen).toEqual([{ authorization: undefined, body: undefined }]);
    expect(mocks.endExpiredSession).not.toHaveBeenCalled();
  });
});

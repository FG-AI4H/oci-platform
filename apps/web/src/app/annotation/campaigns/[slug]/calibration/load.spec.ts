import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import { loadFlags, loadQuality } from './load';

// The real `apiFetch` runs against a stubbed `fetch`, so status codes
// go through the same ApiError mapping as in the app.
const session = {
  user: { name: 'sup' },
  expires: new Date(Date.now() + 3600_000).toISOString(),
  accessToken: 'dev:sup:task-supervisor',
} as Session;
const USER = 'e2e55401-0000-4000-8000-000000000554';

function respond(status: number, body: unknown = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test'));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('loadFlags', () => {
  it('returns the items', async () => {
    respond(200, { items: [] });
    expect(await loadFlags('demo', session)).toEqual({ kind: 'ok', items: [] });
  });

  it('maps a 404 to not-found', async () => {
    respond(404);
    expect(await loadFlags('demo', session)).toEqual({ kind: 'not-found' });
  });

  it.each([
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [500, 'error'],
    [503, 'error'],
  ] as const)('maps API %i to %s', async (status, kind) => {
    respond(status, { message: 'internal detail' });
    expect(await loadFlags('demo', session)).toEqual({ kind });
  });

  it('maps a network failure to error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect(await loadFlags('demo', session)).toEqual({ kind: 'error' });
  });
});

describe('loadQuality', () => {
  it('returns the summary', async () => {
    const summary = { irrAgainstGold: 0.7 };
    respond(200, summary);
    expect(await loadQuality('demo', USER, session)).toEqual({ kind: 'ok', summary });
  });

  it('returns a null summary on 404', async () => {
    respond(404);
    expect(await loadQuality('demo', USER, session)).toEqual({ kind: 'ok', summary: null });
  });

  it.each([
    [401, 'unauthenticated'],
    [400, 'error'],
    [403, 'error'],
    [500, 'error'],
  ] as const)('maps API %i to %s', async (status, kind) => {
    respond(status);
    expect(await loadQuality('demo', USER, session)).toEqual({ kind });
  });
});

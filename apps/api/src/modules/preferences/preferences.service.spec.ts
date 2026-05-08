import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { PreferencesRepository } from './preferences.repository.js';
import { PreferencesService } from './preferences.service.js';

const SUB_UUID = '00000000-0000-4000-8000-000000000001';

function user(sub: string): CognitoAccessTokenPayload {
  return { sub } as unknown as CognitoAccessTokenPayload;
}

interface RepoMock {
  find: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let service: PreferencesService;

beforeEach(() => {
  repo = { find: vi.fn(), upsert: vi.fn() };
  service = new PreferencesService(repo as unknown as PreferencesRepository);
});

describe('PreferencesService.findMine', () => {
  it('returns the stored row when it exists', async () => {
    const row = {
      darkMode: 'dark' as const,
      locale: 'fr-CH',
      density: 'compact' as const,
      updatedAt: '2026-05-08T18:00:00.000Z',
    };
    repo.find.mockResolvedValue(row);

    const out = await service.findMine(user(SUB_UUID));

    expect(out).toEqual(row);
    expect(repo.find).toHaveBeenCalledWith(SUB_UUID);
  });

  it('returns defaults when no row exists yet (lazy seed)', async () => {
    repo.find.mockResolvedValue(null);

    const out = await service.findMine(user(SUB_UUID));

    expect(out.darkMode).toBe('system');
    expect(out.locale).toBeNull();
    expect(out.density).toBe('comfortable');
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});

describe('PreferencesService.updateMine', () => {
  it('forwards the partial patch and returns the upserted row', async () => {
    const upserted = {
      darkMode: 'dark' as const,
      locale: null,
      density: 'comfortable' as const,
      updatedAt: '2026-05-08T19:00:00.000Z',
    };
    repo.upsert.mockResolvedValue(upserted);

    const out = await service.updateMine(user(SUB_UUID), { darkMode: 'dark' });

    expect(out).toEqual(upserted);
    expect(repo.upsert).toHaveBeenCalledWith(SUB_UUID, { darkMode: 'dark' });
  });

  it('derives a UUIDv5 when the sub is non-UUID-shaped (parity with other modules)', async () => {
    repo.upsert.mockResolvedValue({
      darkMode: 'system' as const,
      locale: null,
      density: 'comfortable' as const,
      updatedAt: '2026-05-08T19:00:00.000Z',
    });

    await service.updateMine(user('cognito-username-123'), { darkMode: 'system' });

    const [derivedId] = repo.upsert.mock.calls[0]!;
    expect(derivedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

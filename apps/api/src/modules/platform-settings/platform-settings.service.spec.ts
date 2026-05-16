import { BadRequestException } from '@nestjs/common';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformSettingsRepository } from './platform-settings.repository.js';
import { PlatformSettingsService } from './platform-settings.service.js';

function actor(): CognitoAccessTokenPayload {
  return { sub: 'alice-sub', username: 'alice' } as unknown as CognitoAccessTokenPayload;
}

const FUTURE_FROM = '2027-01-01T00:00:00.000Z';
const FUTURE_UNTIL = '2027-01-08T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';

interface RepoMock {
  load: ReturnType<typeof vi.fn>;
  replace: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let service: PlatformSettingsService;

beforeEach(() => {
  repo = {
    load: vi.fn(),
    replace: vi.fn().mockImplementation(({ value, actorUsername }) => ({
      key: 'current',
      value,
      lastUpdatedBySub: 'uuid',
      lastUpdatedByUsername: actorUsername,
      updatedAt: new Date('2026-05-16T12:00:00Z'),
    })),
  };
  service = new PlatformSettingsService(repo as unknown as PlatformSettingsRepository);
});

describe('PlatformSettingsService.get', () => {
  it('returns defaults when no row exists', async () => {
    repo.load.mockResolvedValue(null);

    const out = await service.get();

    expect(out.maintenanceBanner).toBeNull();
    expect(out.updatedAt).toBeNull();
    expect(out.updatedBy).toBeNull();
  });

  it('returns the stored value with metadata', async () => {
    repo.load.mockResolvedValue({
      key: 'current',
      value: {
        maintenanceBanner: {
          message: 'Maintenance window 02:00–03:00 UTC',
          tone: 'warning',
          visibleFrom: FUTURE_FROM,
          visibleUntil: FUTURE_UNTIL,
        },
      },
      lastUpdatedByUsername: 'alice',
      updatedAt: new Date('2026-05-16T08:00:00Z'),
    });

    const out = await service.get();

    expect(out.maintenanceBanner?.message).toContain('Maintenance');
    expect(out.updatedBy).toBe('alice');
    expect(out.updatedAt).toBe('2026-05-16T08:00:00.000Z');
  });

  it('falls back to defaults when stored JSON drifts from the schema', async () => {
    repo.load.mockResolvedValue({
      key: 'current',
      value: { somethingElse: 42 },
      lastUpdatedByUsername: null,
      updatedAt: new Date('2026-05-16T08:00:00Z'),
    });

    const out = await service.get();

    expect(out.maintenanceBanner).toBeNull();
  });
});

describe('PlatformSettingsService.replace', () => {
  it('persists a valid banner', async () => {
    const incoming = {
      maintenanceBanner: {
        message: 'Read-only between 02:00 and 03:00 UTC',
        tone: 'info' as const,
        visibleFrom: FUTURE_FROM,
        visibleUntil: FUTURE_UNTIL,
      },
    };

    const out = await service.replace(incoming, actor());

    expect(repo.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        value: incoming,
        actorUsername: 'alice',
      }),
    );
    expect(out.maintenanceBanner?.message).toContain('Read-only');
  });

  it('persists a cleared banner (null)', async () => {
    await service.replace({ maintenanceBanner: null }, actor());

    expect(repo.replace).toHaveBeenCalledWith(
      expect.objectContaining({ value: { maintenanceBanner: null } }),
    );
  });

  it('rejects schema-invalid input', async () => {
    await expect(service.replace({ noSuchField: true }, actor())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.replace).not.toHaveBeenCalled();
  });

  it('rejects a banner with visibleUntil ≤ visibleFrom', async () => {
    await expect(
      service.replace(
        {
          maintenanceBanner: {
            message: 'bad window',
            tone: 'info',
            visibleFrom: FUTURE_UNTIL,
            visibleUntil: FUTURE_FROM,
          },
        },
        actor(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PlatformSettingsService.publicBanner', () => {
  it('returns null when no row exists', async () => {
    repo.load.mockResolvedValue(null);
    const out = await service.publicBanner();
    expect(out.banner).toBeNull();
  });

  it('returns null when no banner is configured', async () => {
    repo.load.mockResolvedValue({
      key: 'current',
      value: { maintenanceBanner: null },
      lastUpdatedByUsername: null,
      updatedAt: new Date(),
    });

    expect((await service.publicBanner()).banner).toBeNull();
  });

  it('returns null when the banner is in the future', async () => {
    repo.load.mockResolvedValue({
      key: 'current',
      value: {
        maintenanceBanner: {
          message: 'soon',
          tone: 'info',
          visibleFrom: FUTURE_FROM,
          visibleUntil: FUTURE_UNTIL,
        },
      },
      lastUpdatedByUsername: 'alice',
      updatedAt: new Date(),
    });

    expect((await service.publicBanner()).banner).toBeNull();
  });

  it('returns null when the banner has expired', async () => {
    repo.load.mockResolvedValue({
      key: 'current',
      value: {
        maintenanceBanner: {
          message: 'expired',
          tone: 'info',
          visibleFrom: PAST,
          visibleUntil: '2020-01-08T00:00:00.000Z',
        },
      },
      lastUpdatedByUsername: 'alice',
      updatedAt: new Date(),
    });

    expect((await service.publicBanner()).banner).toBeNull();
  });

  it('returns the banner when now is in the visible window', async () => {
    // Construct a window that brackets "right now".
    const from = new Date(Date.now() - 60_000).toISOString();
    const until = new Date(Date.now() + 60_000).toISOString();
    repo.load.mockResolvedValue({
      key: 'current',
      value: {
        maintenanceBanner: {
          message: 'live now',
          tone: 'warning',
          visibleFrom: from,
          visibleUntil: until,
        },
      },
      lastUpdatedByUsername: 'alice',
      updatedAt: new Date(),
    });

    const out = await service.publicBanner();
    expect(out.banner?.message).toBe('live now');
    expect(out.banner?.tone).toBe('warning');
  });
});

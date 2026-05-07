import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@oci/database';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import type { RemoteCatalogSummary } from '@oci/shared-types';
import { RemoteCatalogRepository } from './remote-catalog.repository.js';
import { RemoteCatalogService } from './remote-catalog.service.js';

function adminUser(): CognitoAccessTokenPayload {
  return {
    sub: '00000000-0000-0000-0000-000000000001',
    'cognito:groups': ['admin'],
  } as unknown as CognitoAccessTokenPayload;
}

function hostUser(): CognitoAccessTokenPayload {
  return {
    sub: '00000000-0000-0000-0000-000000000002',
    'cognito:groups': ['host'],
  } as unknown as CognitoAccessTokenPayload;
}

function row(overrides: Partial<RemoteCatalogSummary> = {}): RemoteCatalogSummary {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    slug: 'huggingface',
    name: 'Hugging Face Hub',
    endpointUrl: 'https://huggingface.co/api/croissant',
    description: null,
    harvestStatus: 'IDLE',
    lastHarvestedAt: null,
    lastError: null,
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
    ...overrides,
  };
}

interface RepoMock {
  list: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  findBySlug: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  deleteById: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let service: RemoteCatalogService;

beforeEach(() => {
  repo = {
    list: vi.fn(),
    count: vi.fn(),
    findById: vi.fn(),
    findBySlug: vi.fn(),
    create: vi.fn(),
    deleteById: vi.fn(),
  };
  service = new RemoteCatalogService(repo as unknown as RemoteCatalogRepository);
});

describe('RemoteCatalogService.list', () => {
  it('returns rows + count for an admin', async () => {
    repo.list.mockResolvedValue([row(), row({ id: 'bb', slug: 'openml' })]);
    const out = await service.list(adminUser());
    expect(out.totalEstimate).toBe(2);
    expect(out.items).toHaveLength(2);
  });

  it('forbids a host', async () => {
    await expect(service.list(hostUser())).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.list).not.toHaveBeenCalled();
  });
});

describe('RemoteCatalogService.detail', () => {
  it('404s when not found', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.detail('aa', adminUser())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the row when found', async () => {
    const r = row();
    repo.findById.mockResolvedValue(r);
    expect(await service.detail(r.id, adminUser())).toEqual(r);
  });
});

describe('RemoteCatalogService.create', () => {
  it('persists and returns the new row', async () => {
    const r = row({ slug: 'gi-ai4h-thailand' });
    repo.create.mockResolvedValue(r);
    const out = await service.create(
      {
        slug: 'gi-ai4h-thailand',
        name: 'GI-AI4H Thailand',
        endpointUrl: 'https://thailand.example.org/v2/catalog',
        description: null,
      },
      adminUser(),
    );
    expect(out).toEqual(r);
    expect(repo.create).toHaveBeenCalledWith({
      slug: 'gi-ai4h-thailand',
      name: 'GI-AI4H Thailand',
      endpointUrl: 'https://thailand.example.org/v2/catalog',
      description: null,
    });
  });

  it('maps Prisma P2002 to 409 ConflictException', async () => {
    repo.create.mockRejectedValue(
      Object.assign(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
        }),
        {},
      ),
    );
    await expect(
      service.create(
        {
          slug: 'huggingface',
          name: 'HF',
          endpointUrl: 'https://huggingface.co/api/croissant',
          description: null,
        },
        adminUser(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RemoteCatalogService.deleteById', () => {
  it('404s when nothing was deleted', async () => {
    repo.deleteById.mockResolvedValue(false);
    await expect(service.deleteById('aa', adminUser())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolves on successful delete', async () => {
    repo.deleteById.mockResolvedValue(true);
    await expect(service.deleteById('aa', adminUser())).resolves.toBeUndefined();
  });
});

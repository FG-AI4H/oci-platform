import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CatalogService } from '../catalog/catalog.service.js';
import { AccessRequestService } from '../access-request/access-request.service.js';
import type { PrismaService } from '../../prisma.service.js';
import { S3ClientProvider } from './s3-client.js';
import { StorageService } from './storage.service.js';

// Stub the presigner — it pulls an endpoint from the SDK client's
// internal middleware stack, which the mocked S3 client doesn't
// have. We just need a stable URL out so the authz path can be
// asserted on. The real signing is exercised by the live smoke
// test against MinIO.
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://signed.example.org/path?sig=stub'),
}));

// UUID-shaped subs short-circuit the UUIDv5 derivation.
const HOST_SUB = '00000000-0000-4000-8000-000000000301';
const ADMIN_SUB = '00000000-0000-4000-8000-000000000302';
const STRANGER_SUB = '00000000-0000-4000-8000-000000000303';
const REQUESTER_SUB = '00000000-0000-4000-8000-000000000304';
const DATASET_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DISTRIBUTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function user(sub: string, ...groups: string[]): CognitoAccessTokenPayload {
  return { sub, 'cognito:groups': groups } as unknown as CognitoAccessTokenPayload;
}

interface S3Mock {
  bucket: string;
  publicEndpoint: string | undefined;
  client: { send: ReturnType<typeof vi.fn> };
}

interface PrismaMock {
  client: {
    distribution: { findFirst: ReturnType<typeof vi.fn> };
    dataset: { findUnique: ReturnType<typeof vi.fn> };
  };
}

interface CatalogMock {
  findOwnerBySlug: ReturnType<typeof vi.fn>;
}
interface AccessReqMock {
  listOwn: ReturnType<typeof vi.fn>;
}

let s3: S3Mock;
let prisma: PrismaMock;
let catalog: CatalogMock;
let accessReq: AccessReqMock;
let svc: StorageService;

beforeEach(() => {
  s3 = {
    bucket: 'test-bucket',
    publicEndpoint: undefined,
    client: { send: vi.fn() },
  };
  prisma = {
    client: {
      distribution: { findFirst: vi.fn() },
      dataset: { findUnique: vi.fn() },
    },
  };
  catalog = { findOwnerBySlug: vi.fn() };
  accessReq = { listOwn: vi.fn() };
  svc = new StorageService(
    s3 as unknown as S3ClientProvider,
    prisma as unknown as PrismaService,
    catalog as unknown as CatalogService,
    accessReq as unknown as AccessRequestService,
  );
});

function readyDist(overrides: Partial<{ requiresAccess: boolean }> = {}) {
  return {
    id: DISTRIBUTION_ID,
    contentType: 'text/plain',
    requiresAccess: false,
    storageBackend: 'S3' as const,
    s3Bucket: 'test-bucket',
    s3Key: 'slug/uuid/file.txt',
    uploadStatus: 'READY' as const,
    ...overrides,
  };
}

function dataset(visibility: 'PRIVATE' | 'RESTRICTED' | 'PUBLIC', hostSub = HOST_SUB) {
  return { visibility, status: 'PUBLISHED' as const, hostId: hostSub, slug: 'demo' };
}

describe('StorageService.getDownloadUrl', () => {
  it('404s when the dataset is missing', async () => {
    catalog.findOwnerBySlug.mockResolvedValue(null);
    await expect(
      svc.getDownloadUrl({
        slug: 'missing',
        distributionId: DISTRIBUTION_ID,
        user: user(REQUESTER_SUB),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('forbids a stranger on a PRIVATE dataset', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    prisma.client.distribution.findFirst.mockResolvedValue(readyDist());
    prisma.client.dataset.findUnique.mockResolvedValue(dataset('PRIVATE'));

    await expect(
      svc.getDownloadUrl({
        slug: 'demo',
        distributionId: DISTRIBUTION_ID,
        user: user(STRANGER_SUB),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the host download a PRIVATE dataset', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    prisma.client.distribution.findFirst.mockResolvedValue(readyDist());
    prisma.client.dataset.findUnique.mockResolvedValue(dataset('PRIVATE'));

    // s3.send isn't called for the presign path (presign is local
    // signing); the v3 SDK wraps it in `getSignedUrl`. We just check
    // it doesn't throw and returns a string.
    const url = await svc.getDownloadUrl({
      slug: 'demo',
      distributionId: DISTRIBUTION_ID,
      user: user(HOST_SUB, 'host'),
    });
    expect(url).toMatch(/^https?:\/\//);
  });

  it('lets an admin download anything', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    prisma.client.distribution.findFirst.mockResolvedValue(readyDist());
    prisma.client.dataset.findUnique.mockResolvedValue(dataset('PRIVATE'));

    const url = await svc.getDownloadUrl({
      slug: 'demo',
      distributionId: DISTRIBUTION_ID,
      user: user(ADMIN_SUB, 'admin'),
    });
    expect(url).toMatch(/^https?:\/\//);
  });

  it('forbids an unapproved requester on a RESTRICTED dataset', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    prisma.client.distribution.findFirst.mockResolvedValue(readyDist());
    prisma.client.dataset.findUnique.mockResolvedValue(dataset('RESTRICTED'));
    accessReq.listOwn.mockResolvedValue([]);

    await expect(
      svc.getDownloadUrl({
        slug: 'demo',
        distributionId: DISTRIBUTION_ID,
        user: user(REQUESTER_SUB, 'participant'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets an APPROVED requester download a RESTRICTED dataset', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    prisma.client.distribution.findFirst.mockResolvedValue(readyDist());
    prisma.client.dataset.findUnique.mockResolvedValue(dataset('RESTRICTED'));
    accessReq.listOwn.mockResolvedValue([
      { dataset: { id: DATASET_ID, slug: 'demo', name: 'demo' }, status: 'APPROVED' },
    ]);

    const url = await svc.getDownloadUrl({
      slug: 'demo',
      distributionId: DISTRIBUTION_ID,
      user: user(REQUESTER_SUB, 'participant'),
    });
    expect(url).toMatch(/^https?:\/\//);
  });

  it('forbids an APPROVED requester whose request is for a DIFFERENT dataset', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    prisma.client.distribution.findFirst.mockResolvedValue(readyDist());
    prisma.client.dataset.findUnique.mockResolvedValue(dataset('RESTRICTED'));
    accessReq.listOwn.mockResolvedValue([
      {
        dataset: { id: 'OTHER-ID', slug: 'other', name: 'other' },
        status: 'APPROVED',
      },
    ]);

    await expect(
      svc.getDownloadUrl({
        slug: 'demo',
        distributionId: DISTRIBUTION_ID,
        user: user(REQUESTER_SUB, 'participant'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets anyone download a PUBLIC + !requiresAccess distribution', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    prisma.client.distribution.findFirst.mockResolvedValue(readyDist({ requiresAccess: false }));
    prisma.client.dataset.findUnique.mockResolvedValue(dataset('PUBLIC'));

    const url = await svc.getDownloadUrl({
      slug: 'demo',
      distributionId: DISTRIBUTION_ID,
      user: user(STRANGER_SUB, 'participant'),
    });
    expect(url).toMatch(/^https?:\/\//);
  });

  it('treats requiresAccess=true as the gate even on PUBLIC datasets', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    prisma.client.distribution.findFirst.mockResolvedValue(readyDist({ requiresAccess: true }));
    prisma.client.dataset.findUnique.mockResolvedValue(dataset('PUBLIC'));
    accessReq.listOwn.mockResolvedValue([]);

    await expect(
      svc.getDownloadUrl({
        slug: 'demo',
        distributionId: DISTRIBUTION_ID,
        user: user(REQUESTER_SUB, 'participant'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects EXTERNAL distributions with a 400 (use contentUrl directly)', async () => {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    prisma.client.distribution.findFirst.mockResolvedValue({
      ...readyDist(),
      storageBackend: 'EXTERNAL' as const,
      s3Bucket: null,
      s3Key: null,
      uploadStatus: null,
    });
    prisma.client.dataset.findUnique.mockResolvedValue(dataset('PUBLIC'));

    await expect(
      svc.getDownloadUrl({
        slug: 'demo',
        distributionId: DISTRIBUTION_ID,
        user: user(REQUESTER_SUB, 'participant'),
      }),
    ).rejects.toThrow(/platform-hosted/);
  });
});

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CatalogService } from '../catalog/catalog.service.js';
import { AccessRequestService } from '../access-request/access-request.service.js';
import type { PrismaService } from '../../prisma.service.js';
import type { DicomIndexService } from './dicom-index.service.js';
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
interface DicomIndexMock {
  indexStoredObject: ReturnType<typeof vi.fn>;
  isHeld: ReturnType<typeof vi.fn>;
}

let s3: S3Mock;
let prisma: PrismaMock;
let catalog: CatalogMock;
let accessReq: AccessReqMock;
let dicomIndex: DicomIndexMock;
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
  // Default: nothing is DICOM, nothing is held.
  dicomIndex = {
    indexStoredObject: vi.fn().mockResolvedValue(null),
    isHeld: vi.fn().mockResolvedValue(false),
  };
  svc = new StorageService(
    s3 as unknown as S3ClientProvider,
    prisma as unknown as PrismaService,
    catalog as unknown as CatalogService,
    accessReq as unknown as AccessRequestService,
    dicomIndex as unknown as DicomIndexService,
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

describe('StorageService.getDownloadUrl — held DICOM files (ADR-0026)', () => {
  function publicDatasetWithHeldFile() {
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    prisma.client.distribution.findFirst.mockResolvedValue(readyDist());
    // PUBLIC on purpose: the hold applies whatever the visibility.
    prisma.client.dataset.findUnique.mockResolvedValue(dataset('PUBLIC'));
    dicomIndex.isHeld.mockResolvedValue(true);
  }
  const download = (caller: CognitoAccessTokenPayload | undefined) =>
    svc.getDownloadUrl({ slug: 'demo', distributionId: DISTRIBUTION_ID, user: caller });

  it('404s for a signed-in caller who could otherwise download the file', async () => {
    publicDatasetWithHeldFile();
    await expect(download(user(STRANGER_SUB, 'participant'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(dicomIndex.isHeld).toHaveBeenCalledWith('test-bucket', 'slug/uuid/file.txt');
  });

  it('404s for an anonymous caller', async () => {
    publicDatasetWithHeldFile();
    await expect(download(undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s for a requester with an APPROVED access request', async () => {
    publicDatasetWithHeldFile();
    prisma.client.dataset.findUnique.mockResolvedValue(dataset('RESTRICTED'));
    accessReq.listOwn.mockResolvedValue([{ dataset: { id: DATASET_ID }, status: 'APPROVED' }]);
    await expect(download(user(REQUESTER_SUB, 'participant'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('serves the host, who has to be able to look at what was flagged', async () => {
    publicDatasetWithHeldFile();
    await expect(download(user(HOST_SUB, 'host'))).resolves.toMatch(/^https?:\/\//);
    // Not asked: the host is allowed either way.
    expect(dicomIndex.isHeld).not.toHaveBeenCalled();
  });

  it('serves an operator', async () => {
    publicDatasetWithHeldFile();
    await expect(download(user(ADMIN_SUB, 'admin'))).resolves.toMatch(/^https?:\/\//);
  });

  it('does not make a host of one dataset an operator of another', async () => {
    publicDatasetWithHeldFile();
    await expect(download(user(STRANGER_SUB, 'host'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('checks the hold only after the access rules, so a refusal stays a refusal', async () => {
    publicDatasetWithHeldFile();
    prisma.client.dataset.findUnique.mockResolvedValue(dataset('PRIVATE'));
    await expect(download(user(STRANGER_SUB))).rejects.toBeInstanceOf(ForbiddenException);
    expect(dicomIndex.isHeld).not.toHaveBeenCalled();
  });
});

describe('StorageService.completeUpload — header check before the file exists (ADR-0026)', () => {
  const VERSION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const KEY = 'demo/11111111-1111-4111-8111-111111111111/slice.dcm';
  let upsert: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    upsert = vi.fn().mockResolvedValue({
      id: DISTRIBUTION_ID,
      croissantId: 'slice.dcm',
      contentType: 'application/octet-stream',
      contentSizeBytes: 10n,
      contentHash: null,
    });
    Object.assign(prisma.client, {
      datasetVersion: { findFirst: vi.fn().mockResolvedValue({ id: VERSION_ID }) },
    });
    Object.assign(prisma.client.distribution, { upsert });
    catalog.findOwnerBySlug.mockResolvedValue({ id: DATASET_ID, hostId: HOST_SUB });
    s3.client.send.mockResolvedValue({});
  });

  const complete = (...keys: string[]) =>
    svc.completeUpload({
      slug: 'demo',
      uploadId: 'upload-1',
      key: keys.length > 0 ? (keys[0] as string) : KEY,
      body: { parts: [{ partNumber: 1, etag: 'etag-1' }] },
      user: user(HOST_SUB, 'host'),
      // What the browser claims. The check never relies on it.
      contentType: 'application/octet-stream',
      contentSize: 10,
      sha256: null,
    });

  it('checks the stored file, by its storage location, before writing the row', async () => {
    const order: string[] = [];
    dicomIndex.indexStoredObject.mockImplementation(async () => {
      order.push('check');
      return 'HELD';
    });
    upsert.mockImplementation(async () => {
      order.push('row');
      return {
        id: DISTRIBUTION_ID,
        croissantId: 'slice.dcm',
        contentType: 'x',
        contentSizeBytes: 10n,
      };
    });

    await complete();

    expect(dicomIndex.indexStoredObject).toHaveBeenCalledWith({
      datasetId: DATASET_ID,
      s3Bucket: 'test-bucket',
      s3Key: KEY,
    });
    expect(order).toEqual(['check', 'row']);
  });

  it('tells the host the outcome of the check', async () => {
    dicomIndex.indexStoredObject.mockResolvedValue('HELD');
    await expect(complete()).resolves.toMatchObject({ dicomCheckStatus: 'HELD' });

    dicomIndex.indexStoredObject.mockResolvedValue(null);
    await expect(complete()).resolves.toMatchObject({ dicomCheckStatus: null });
  });

  it('writes no row and discards the stored bytes when the check cannot run', async () => {
    dicomIndex.indexStoredObject.mockRejectedValue(new Error('storage unavailable'));

    await expect(complete()).rejects.toThrow('storage unavailable');

    expect(upsert).not.toHaveBeenCalled();
    const sent = s3.client.send.mock.calls.map(
      ([command]) => (command as { constructor: { name: string } }).constructor.name,
    );
    expect(sent).toEqual(['CompleteMultipartUploadCommand', 'DeleteObjectCommand']);
    const discarded = s3.client.send.mock.calls[1]?.[0] as {
      input: { Bucket: string; Key: string };
    };
    expect(discarded.input).toEqual({ Bucket: 'test-bucket', Key: KEY });
  });

  it('still reports the original failure when the bytes cannot be discarded', async () => {
    dicomIndex.indexStoredObject.mockRejectedValue(new Error('storage unavailable'));
    s3.client.send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('AccessDenied'));

    await expect(complete()).rejects.toThrow('storage unavailable');
  });

  it('refuses before storage assembles the object when there is no published version', async () => {
    (
      prisma.client as unknown as { datasetVersion: { findFirst: ReturnType<typeof vi.fn> } }
    ).datasetVersion.findFirst.mockResolvedValue(null);

    await expect(complete()).rejects.toMatchObject({ status: 400 });
    expect(s3.client.send).not.toHaveBeenCalled();
  });

  it('refuses a missing key with a 400, not a crash', async () => {
    await expect(complete(undefined as unknown as string)).rejects.toMatchObject({ status: 400 });
    expect(s3.client.send).not.toHaveBeenCalled();
  });

  it('refuses a key outside the dataset, before touching storage', async () => {
    await expect(complete('other-dataset/1111/slice.dcm')).rejects.toMatchObject({ status: 400 });
    // A prefix that merely starts with the slug is not the dataset's prefix.
    await expect(complete('demo-evil/1111/slice.dcm')).rejects.toMatchObject({ status: 400 });
    expect(s3.client.send).not.toHaveBeenCalled();
    expect(dicomIndex.indexStoredObject).not.toHaveBeenCalled();
  });
});

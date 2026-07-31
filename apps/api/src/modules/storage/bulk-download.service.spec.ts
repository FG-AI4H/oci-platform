import { Readable } from 'node:stream';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { PrismaService } from '../../prisma.service.js';
import type { S3ClientProvider } from './s3-client.js';
import type { StorageService } from './storage.service.js';
import {
  BulkDownloadService,
  buildCitationNotice,
  buildLicenseNotice,
  type BulkDownloadPlan,
} from './bulk-download.service.js';

const DATASET_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LATEST_VERSION_ID = 'vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvv22';
const REQUESTER_SUB = '00000000-0000-4000-8000-000000000304';

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
    datasetVersion: { findFirst: ReturnType<typeof vi.fn> };
    distribution: { findMany: ReturnType<typeof vi.fn> };
  };
}
interface CatalogMock {
  findOwnerBySlug: ReturnType<typeof vi.fn>;
}
interface StorageMock {
  authoriseDatasetBytes: ReturnType<typeof vi.fn>;
}

let s3: S3Mock;
let prisma: PrismaMock;
let catalog: CatalogMock;
let storage: StorageMock;
let svc: BulkDownloadService;

const CROISSANT = {
  '@type': 'sc:Dataset',
  name: 'IDRiD - Indian Diabetic Retinopathy Image Dataset',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  creator: [{ '@type': 'sc:Person', name: 'Prasanna Porwal', url: 'https://orcid.org/0000-0002' }],
  citeAs: 'Porwal, P. et al. (2018). IDRiD. IEEE Dataport.',
  url: 'https://idrid.grand-challenge.org/',
  datePublished: '2018-04-24',
};

/** An eligible row as it comes back from the (already-filtered) query. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    croissantId: 'IDRiD_001.jpg',
    contentUrl: null,
    s3Bucket: 'test-bucket',
    s3Key: 'idrid/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/IDRiD_001.jpg',
    contentSizeBytes: 1024n,
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.OCI_BULK_DOWNLOAD_MAX_BYTES;
  s3 = { bucket: 'test-bucket', publicEndpoint: undefined, client: { send: vi.fn() } };
  prisma = {
    client: {
      datasetVersion: { findFirst: vi.fn() },
      distribution: { findMany: vi.fn() },
    },
  };
  catalog = { findOwnerBySlug: vi.fn() };
  storage = { authoriseDatasetBytes: vi.fn() };

  // Happy-path defaults; individual tests override.
  catalog.findOwnerBySlug.mockResolvedValue({
    id: DATASET_ID,
    hostId: 'host',
    visibility: 'PUBLIC',
  });
  storage.authoriseDatasetBytes.mockResolvedValue({
    visibility: 'PUBLIC',
    status: 'PUBLISHED',
    hostId: 'host',
    slug: 'idrid',
  });
  prisma.client.datasetVersion.findFirst.mockResolvedValue({
    id: LATEST_VERSION_ID,
    version: '1.0.0',
    croissant: CROISSANT,
  });
  prisma.client.distribution.findMany.mockResolvedValue([row()]);

  svc = new BulkDownloadService(
    s3 as unknown as S3ClientProvider,
    prisma as unknown as PrismaService,
    catalog as unknown as CatalogService,
    storage as unknown as StorageService,
  );
});

afterEach(() => {
  delete process.env.OCI_BULK_DOWNLOAD_MAX_BYTES;
});

function plan(includeManifest = false) {
  return svc.plan({ slug: 'idrid', includeManifest, user: user(REQUESTER_SUB, 'participant') });
}

/** Await a rejection and hand back the error for body assertions. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the promise to reject');
}

describe('BulkDownloadService.plan — lookup + authz', () => {
  it('404s when the dataset does not exist', async () => {
    catalog.findOwnerBySlug.mockResolvedValue(null);
    await expect(plan()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when the dataset has no published version', async () => {
    prisma.client.datasetVersion.findFirst.mockResolvedValue(null);
    await expect(plan()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('delegates authorisation to StorageService.authoriseDatasetBytes', async () => {
    await plan();
    expect(storage.authoriseDatasetBytes).toHaveBeenCalledWith({
      datasetId: DATASET_ID,
      // Bulk excludes requiresAccess rows outright, so the archive
      // never contains bytes that flag guards.
      requiresAccess: false,
      user: expect.objectContaining({ sub: REQUESTER_SUB }),
    });
  });

  it('propagates the shared gate ForbiddenException (bulk is not a bypass)', async () => {
    storage.authoriseDatasetBytes.mockRejectedValue(new ForbiddenException('access not approved'));
    await expect(plan()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('authorises BEFORE reading any distribution row', async () => {
    storage.authoriseDatasetBytes.mockRejectedValue(new ForbiddenException('access not approved'));
    await expect(plan()).rejects.toBeInstanceOf(ForbiddenException);
    // No content disclosure — not even a count — to an unauthorised caller.
    expect(prisma.client.distribution.findMany).not.toHaveBeenCalled();
  });
});

describe('BulkDownloadService.plan — eligibility filtering', () => {
  it('selects only the latest published version', async () => {
    await plan();
    expect(prisma.client.datasetVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { datasetId: DATASET_ID },
        orderBy: { publishedAt: 'desc' },
      }),
    );
    // …and scopes the distribution query to that version id.
    const args = prisma.client.distribution.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where.datasetVersionId).toBe(LATEST_VERSION_ID);
  });

  it('excludes EXTERNAL, non-READY and requiresAccess rows in the query', async () => {
    await plan();
    const args = prisma.client.distribution.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({
      datasetVersionId: LATEST_VERSION_ID,
      storageBackend: 'S3',
      uploadStatus: 'READY',
      requiresAccess: false,
    });
  });

  it('drops rows with a missing s3Bucket or s3Key even if the query let them through', async () => {
    prisma.client.distribution.findMany.mockResolvedValue([
      row({ id: 'r1', croissantId: 'good.jpg', s3Key: 'idrid/r1/good.jpg' }),
      row({ id: 'r2', croissantId: 'nokey.jpg', s3Key: null }),
      row({ id: 'r3', croissantId: 'nobucket.jpg', s3Bucket: null }),
    ]);
    const p = await plan();
    expect(p.entries.map((e) => e.filename)).toEqual(['good.jpg']);
  });

  it('409s when nothing in the latest version is eligible', async () => {
    prisma.client.distribution.findMany.mockResolvedValue([]);
    await expect(plan()).rejects.toBeInstanceOf(ConflictException);
  });

  it('explains why in the 409 body', async () => {
    prisma.client.distribution.findMany.mockResolvedValue([]);
    const err = (await rejection(plan())) as ConflictException;
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getStatus()).toBe(409);
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.reason).toBe('no-eligible-distributions');
    expect(body.slug).toBe('idrid');
    expect(body.eligibleCount).toBe(0);
    expect(String(body.message)).toMatch(/storageBackend=S3/);
  });

  it('derives archive filenames from s3Key', async () => {
    prisma.client.distribution.findMany.mockResolvedValue([
      row({ id: 'r1', s3Key: 'idrid/r1/IDRiD_001.jpg' }),
      row({ id: 'r2', s3Key: 'idrid/r2/IDRiD_002.jpg' }),
    ]);
    const p = await plan();
    expect(p.entries.map((e) => e.filename)).toEqual(['IDRiD_001.jpg', 'IDRiD_002.jpg']);
  });

  it('de-duplicates colliding filenames with -2 / -3', async () => {
    prisma.client.distribution.findMany.mockResolvedValue([
      row({ id: 'r1', s3Key: 'idrid/r1/scan.jpg' }),
      row({ id: 'r2', s3Key: 'idrid/r2/scan.jpg' }),
      row({ id: 'r3', s3Key: 'idrid/r3/scan.jpg' }),
    ]);
    const p = await plan();
    expect(p.entries.map((e) => e.filename)).toEqual(['scan.jpg', 'scan-2.jpg', 'scan-3.jpg']);
  });

  it('falls back to croissantId when no filename can be derived', async () => {
    prisma.client.distribution.findMany.mockResolvedValue([
      row({ id: 'r1', croissantId: 'metadata-table', s3Key: '../..' }),
    ]);
    const p = await plan();
    expect(p.entries[0]?.filename).toBe('metadata-table');
  });
});

describe('BulkDownloadService.plan — size cap', () => {
  it('proceeds under the cap', async () => {
    process.env.OCI_BULK_DOWNLOAD_MAX_BYTES = '4096';
    prisma.client.distribution.findMany.mockResolvedValue([
      row({ id: 'r1', s3Key: 'idrid/r1/a.jpg', contentSizeBytes: 1000n }),
      row({ id: 'r2', s3Key: 'idrid/r2/b.jpg', contentSizeBytes: 2000n }),
    ]);
    const p = await plan();
    expect(p.totalBytes).toBe(3000);
    expect(p.entries).toHaveLength(2);
  });

  it('413s over the cap', async () => {
    process.env.OCI_BULK_DOWNLOAD_MAX_BYTES = '2048';
    prisma.client.distribution.findMany.mockResolvedValue([
      row({ id: 'r1', s3Key: 'idrid/r1/a.jpg', contentSizeBytes: 1500n }),
      row({ id: 'r2', s3Key: 'idrid/r2/b.jpg', contentSizeBytes: 1500n }),
    ]);
    await expect(plan()).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('states the total, the cap and the alternative in the 413 body', async () => {
    process.env.OCI_BULK_DOWNLOAD_MAX_BYTES = '2048';
    prisma.client.distribution.findMany.mockResolvedValue([
      row({ id: 'r1', s3Key: 'idrid/r1/a.jpg', contentSizeBytes: 3000n }),
    ]);
    const err = (await rejection(plan())) as PayloadTooLargeException;
    expect(err).toBeInstanceOf(PayloadTooLargeException);
    expect(err.getStatus()).toBe(413);
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.reason).toBe('bulk-download-too-large');
    expect(body.totalBytes).toBe(3000);
    expect(body.maxBytes).toBe(2048);
    expect(body.fileCount).toBe(1);
    expect(String(body.hint)).toMatch(/distributions\/:distributionId\/download/);
  });

  it('allows a total exactly at the cap', async () => {
    process.env.OCI_BULK_DOWNLOAD_MAX_BYTES = '3000';
    prisma.client.distribution.findMany.mockResolvedValue([
      row({ id: 'r1', s3Key: 'idrid/r1/a.jpg', contentSizeBytes: 3000n }),
    ]);
    await expect(plan()).resolves.toMatchObject({ totalBytes: 3000 });
  });

  it('defaults to 2 GiB when the env var is unset', async () => {
    prisma.client.distribution.findMany.mockResolvedValue([
      row({ id: 'r1', s3Key: 'idrid/r1/a.jpg', contentSizeBytes: BigInt(2 * 1024 ** 3) }),
    ]);
    await expect(plan()).resolves.toMatchObject({ totalBytes: 2 * 1024 ** 3 });

    prisma.client.distribution.findMany.mockResolvedValue([
      row({ id: 'r1', s3Key: 'idrid/r1/a.jpg', contentSizeBytes: BigInt(2 * 1024 ** 3 + 1) }),
    ]);
    await expect(plan()).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('ignores a malformed cap and falls back to the default', async () => {
    process.env.OCI_BULK_DOWNLOAD_MAX_BYTES = 'not-a-number';
    prisma.client.distribution.findMany.mockResolvedValue([
      row({ id: 'r1', s3Key: 'idrid/r1/a.jpg', contentSizeBytes: 5000n }),
    ]);
    await expect(plan()).resolves.toMatchObject({ totalBytes: 5000 });
  });

  it('counts rows with an undeclared size separately instead of guessing', async () => {
    prisma.client.distribution.findMany.mockResolvedValue([
      row({ id: 'r1', s3Key: 'idrid/r1/a.jpg', contentSizeBytes: 500n }),
      row({ id: 'r2', s3Key: 'idrid/r2/b.jpg', contentSizeBytes: null }),
    ]);
    const p = await plan();
    expect(p.totalBytes).toBe(500);
    expect(p.unknownSizeCount).toBe(1);
    expect(p.entries).toHaveLength(2);
  });
});

// ----- ZIP assembly ---------------------------------------------------

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/**
 * Read entry names out of the central directory. Parsing the real
 * structure rather than substring-matching the bytes matters: entry
 * payloads are deflated, and the notices themselves mention
 * "croissant.json", so a naive `includes` would report an entry that
 * isn't there.
 */
function zipEntryNames(zip: Buffer): string[] {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd === -1) throw new Error('no end-of-central-directory record');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory header');
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    names.push(zip.subarray(p + 46, p + 46 + nameLen).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

describe('BulkDownloadService.buildZip', () => {
  beforeEach(() => {
    s3.client.send.mockImplementation(() =>
      Promise.resolve({ Body: Readable.from([Buffer.from('bytes')]) }),
    );
  });

  it('always includes LICENSE.txt and CITATION.txt, and omits the manifest by default', async () => {
    const p = await plan(false);
    const zip = await collect(svc.buildZip(p));
    expect(zip.subarray(0, 2).toString('latin1')).toBe('PK');
    const names = zipEntryNames(zip);
    expect(names).toContain('LICENSE.txt');
    expect(names).toContain('CITATION.txt');
    expect(names).toContain('IDRiD_001.jpg');
    expect(names).not.toContain('croissant.json');
  });

  it('includes croissant.json when manifest=true', async () => {
    const p = await plan(true);
    const names = zipEntryNames(await collect(svc.buildZip(p)));
    expect(names).toContain('croissant.json');
  });

  it('writes de-duplicated names as distinct ZIP entries', async () => {
    prisma.client.distribution.findMany.mockResolvedValue([
      row({ id: 'r1', s3Key: 'idrid/r1/scan.jpg' }),
      row({ id: 'r2', s3Key: 'idrid/r2/scan.jpg' }),
    ]);
    const names = zipEntryNames(await collect(svc.buildZip(await plan())));
    expect(names).toContain('scan.jpg');
    expect(names).toContain('scan-2.jpg');
    expect(new Set(names).size).toBe(names.length);
  });

  it('opens each S3 object exactly once, and only once the archive is consumed', async () => {
    prisma.client.distribution.findMany.mockResolvedValue([
      row({ id: 'r1', s3Key: 'idrid/r1/IDRiD_001.jpg' }),
      row({ id: 'r2', s3Key: 'idrid/r2/scan.jpg' }),
    ]);
    const p = await plan();

    const stream = svc.buildZip(p);
    // Lazy: no GetObject until yazl reaches the entry.
    expect(s3.client.send).not.toHaveBeenCalled();

    await collect(stream);
    expect(s3.client.send).toHaveBeenCalledTimes(2);
  });
});

// ----- notices --------------------------------------------------------
//
// Asserted against the pure builders. The ZIP payloads are deflated, so
// content checks belong here and structure checks belong above.

function planWith(croissant: unknown, overrides: Partial<BulkDownloadPlan> = {}): BulkDownloadPlan {
  return {
    slug: 'idrid',
    datasetName: 'IDRiD',
    version: '1.0.0',
    croissant,
    includeManifest: false,
    entries: [
      {
        distributionId: 'r1',
        filename: 'IDRiD_001.jpg',
        s3Bucket: 'test-bucket',
        s3Key: 'idrid/r1/IDRiD_001.jpg',
        sizeBytes: 1024,
      },
    ],
    totalBytes: 1024,
    unknownSizeCount: 0,
    ...overrides,
  };
}

describe('buildLicenseNotice', () => {
  it('names the dataset, the licence and the creators', () => {
    const text = buildLicenseNotice(planWith(CROISSANT, { datasetName: CROISSANT.name }));
    expect(text).toContain(CROISSANT.name);
    expect(text).toContain('idrid');
    expect(text).toContain('1.0.0');
    expect(text).toContain('creativecommons.org/licenses/by/4.0');
    expect(text).toContain('Prasanna Porwal');
    expect(text).toContain('https://orcid.org/0000-0002');
    expect(text).toContain('Attribution is a condition of use');
  });

  it('discloses that files may have been modified', () => {
    const text = buildLicenseNotice(planWith(CROISSANT));
    expect(text).toContain('may have been re-encoded');
    expect(text).toContain('/v2/catalog/datasets/idrid/croissant');
  });

  it('says so explicitly rather than inventing a licence when none is declared', () => {
    const text = buildLicenseNotice(planWith({ name: 'Unlicensed set', creator: 'Someone' }));
    expect(text).toContain('NOT DECLARED');
    expect(text).toContain('makes NO licence grant');
    expect(text).toContain('Absence of a licence is not permission');
    expect(text).not.toContain('creativecommons.org');
  });

  it('flags missing creators instead of leaving attribution blank', () => {
    const text = buildLicenseNotice(planWith({ name: 'No creator', license: 'CC0-1.0' }));
    expect(text).toContain('Not declared in the manifest');
  });

  it('reads sc:-prefixed manifest keys', () => {
    const text = buildLicenseNotice(
      planWith({
        'sc:name': 'Prefixed set',
        'sc:license': 'CC-BY-4.0',
        'sc:creator': [{ 'sc:name': 'Prefixed Author' }],
      }),
    );
    expect(text).toContain('CC-BY-4.0');
    expect(text).toContain('Prefixed Author');
  });

  it('accepts a licence expressed as an object', () => {
    const text = buildLicenseNotice(
      planWith({ name: 'Obj licence', license: { name: 'CC BY-NC 4.0' } }),
    );
    expect(text).toContain('CC BY-NC 4.0');
  });
});

describe('buildCitationNotice', () => {
  it('uses citeAs verbatim when the host supplied one', () => {
    const text = buildCitationNotice(planWith(CROISSANT));
    expect(text).toContain('Porwal, P. et al. (2018). IDRiD. IEEE Dataport.');
    expect(text).toContain('Use it verbatim');
    expect(text).not.toContain('assembled the line above');
  });

  it('assembles a fallback citation and says that it did', () => {
    const text = buildCitationNotice(
      planWith(
        {
          name: 'No citeAs set',
          license: 'CC0-1.0',
          creator: { name: 'A. Researcher' },
          datePublished: '2020-06-01',
        },
        { datasetName: 'No citeAs set' },
      ),
    );
    expect(text).toContain('A. Researcher. (2020). No citeAs set');
    expect(text).toContain('assembled the line above');
  });

  it('marks the creator as undeclared rather than omitting it', () => {
    const text = buildCitationNotice(planWith({ name: 'Anonymous set' }));
    expect(text).toContain('[creator not declared]');
  });

  it('cross-references LICENSE.txt in both the declared and undeclared cases', () => {
    expect(buildCitationNotice(planWith(CROISSANT))).toContain('LICENSE.txt');
    expect(buildCitationNotice(planWith({ name: 'x' }))).toContain('LICENSE.txt');
  });
});

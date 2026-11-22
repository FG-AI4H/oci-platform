import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { Logger, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { OptionalCognitoJwtGuard } from '../../auth/optional-cognito-jwt.guard.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { PrismaService } from '../../prisma.service.js';
import { BulkDownloadService } from './bulk-download.service.js';
import { S3ClientProvider } from './s3-client.js';
import { StorageController } from './storage.controller.js';
import { StorageService } from './storage.service.js';

/**
 * #772: a storage failure in the middle of a bulk ZIP download used to take
 * the whole API process down (an `error` event nobody listened to), and a
 * client hanging up mid-download left the S3 object stream open.
 *
 * Real controller, real BulkDownloadService, real Fastify over a real socket;
 * only the database, the catalog/storage gates and the S3 client are faked.
 * Each case then makes a second request to the same app to prove it is still
 * serving.
 */

const SLUG = 'idrid';
const BUCKET = 'test-bucket';
const KEYS = ['idrid/r1/IDRiD_001.jpg', 'idrid/r2/IDRiD_002.jpg', 'idrid/r3/IDRiD_003.jpg'];

interface GetObjectLike {
  input: { Bucket?: string; Key?: string };
}
interface SendOptions {
  abortSignal?: AbortSignal;
}
type SendImpl = (cmd: GetObjectLike, opts?: SendOptions) => Promise<{ Body: Readable }>;

const s3 = {
  bucket: BUCKET,
  publicEndpoint: undefined,
  client: { send: vi.fn<SendImpl>() },
};
const prisma = {
  client: {
    datasetVersion: { findFirst: vi.fn() },
    distribution: { findMany: vi.fn() },
  },
};
const catalog = { findOwnerBySlug: vi.fn(), heldDistributionIds: vi.fn() };
const storage = { authoriseDatasetBytes: vi.fn(), isHostOrOperator: vi.fn() };

/** Every object body the fake S3 handed out, so leaks can be asserted. */
let bodies: Readable[] = [];

/** A body that delivers `bytes` and ends normally. */
function healthyBody(bytes = Buffer.from('jpeg-bytes')): Readable {
  const body = Readable.from([bytes]);
  bodies.push(body);
  return body;
}

/** A body that delivers some bytes, then dies the way a dropped S3 socket does. */
function bodyThatDiesMidRead(): Readable {
  const body = new Readable({ read() {} });
  body.push(Buffer.alloc(32 * 1024, 7));
  setTimeout(() => body.destroy(new Error('aborted (simulated S3 socket reset)')), 20);
  bodies.push(body);
  return body;
}

/** A body that delivers one chunk and then stalls, like a slow S3 read. */
function stallingBody(): Readable {
  const body = new Readable({ read() {} });
  body.push(Buffer.alloc(64 * 1024, 7));
  bodies.push(body);
  return body;
}

function keyOf(cmd: GetObjectLike): string {
  return cmd.input.Key ?? '';
}

interface Download {
  status: number;
  body: Buffer;
  /** `complete`: the server ended the response; `truncated`: it cut it off; `hung`: neither. */
  outcome: 'complete' | 'truncated' | 'hung';
}

let port = 0;

/** GET over a real socket. Never waits longer than `deadlineMs`. */
function download(path: string, deadlineMs = 4000): Promise<Download> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let status = 0;
    let settled = false;
    const finish = (outcome: Download['outcome']): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, body: Buffer.concat(chunks), outcome });
    };
    const req = httpRequest({ host: '127.0.0.1', port, path, agent: false }, (res) => {
      status = res.statusCode ?? 0;
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', () => finish('truncated'));
      res.on('close', () => finish(res.complete ? 'complete' : 'truncated'));
    });
    req.on('error', () => finish('truncated'));
    const timer = setTimeout(() => {
      req.destroy();
      finish('hung');
    }, deadlineMs);
    req.end();
  });
}

/** Number of entries in a complete archive's end-of-central-directory record. */
function zipEntryCount(zip: Buffer): number | null {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  return eocd === -1 ? null : zip.readUInt16LE(eocd + 10);
}

async function waitFor(check: () => boolean, deadlineMs = 2000): Promise<boolean> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return check();
}

/** Anything that would have crashed a plain `node dist/main.js`. */
const unhandled: unknown[] = [];
const recordUnhandled = (err: unknown): void => {
  unhandled.push(err);
};

const URL_PATH = `/v2/catalog/datasets/${SLUG}/download`;

describe('bulk download — a storage failure mid-archive (#772)', () => {
  let app: NestFastifyApplication;
  let logError: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    process.on('uncaughtException', recordUnhandled);
    process.on('unhandledRejection', recordUnhandled);

    const mod = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [
        BulkDownloadService,
        { provide: S3ClientProvider, useValue: s3 },
        { provide: PrismaService, useValue: prisma },
        { provide: CatalogService, useValue: catalog },
        { provide: StorageService, useValue: storage },
      ],
    })
      .overrideGuard(CognitoJwtGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OptionalCognitoJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app?.close();
    process.off('uncaughtException', recordUnhandled);
    process.off('unhandledRejection', recordUnhandled);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    bodies = [];
    unhandled.length = 0;
    logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    catalog.findOwnerBySlug.mockResolvedValue({ id: 'dataset-1', hostId: 'host' });
    catalog.heldDistributionIds.mockResolvedValue(new Set<string>());
    storage.authoriseDatasetBytes.mockResolvedValue({ slug: SLUG, hostId: 'host' });
    storage.isHostOrOperator.mockReturnValue(false);
    prisma.client.datasetVersion.findFirst.mockResolvedValue({
      id: 'version-1',
      version: '1.0.0',
      croissant: { name: 'IDRiD', license: 'CC-BY-4.0' },
    });
    prisma.client.distribution.findMany.mockResolvedValue(
      KEYS.map((key, i) => ({
        id: `r${i + 1}`,
        croissantId: key.split('/').pop(),
        contentUrl: null,
        s3Bucket: BUCKET,
        s3Key: key,
        contentSizeBytes: 1024n,
      })),
    );
  });

  afterEach(() => {
    logError.mockRestore();
  });

  /** The follow-up request every case makes: storage is healthy again. */
  async function expectStillServing(): Promise<void> {
    s3.client.send.mockImplementation(() => Promise.resolve({ Body: healthyBody() }));
    const res = await download(URL_PATH);
    expect(res).toMatchObject({ status: 200, outcome: 'complete' });
    // LICENSE.txt + CITATION.txt + the three objects.
    expect(zipEntryCount(res.body)).toBe(2 + KEYS.length);
  }

  function bulkDownloadErrors(): string[] {
    return logError.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => message.startsWith('bulk download'));
  }

  it('cuts the response off when the second object cannot be opened, logs once, keeps serving', async () => {
    s3.client.send.mockImplementation((cmd) =>
      keyOf(cmd) === KEYS[1]
        ? Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:9'))
        : Promise.resolve({ Body: healthyBody() }),
    );

    const res = await download(URL_PATH);

    // Before the fix: yazl's unheard `error` event, the one that kills the process.
    expect(unhandled).toEqual([]);
    // Headers (and the notices) were already on the wire, so the only honest
    // signal left is to cut the response off — never to hang it.
    expect(res.status).toBe(200);
    expect(res.outcome).toBe('truncated');
    expect(res.body.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(zipEntryCount(res.body)).toBeNull();
    // Stops at the failure: the third object is never requested.
    expect(s3.client.send.mock.calls.map(([cmd]) => keyOf(cmd))).toEqual([KEYS[0], KEYS[1]]);

    const logged = bulkDownloadErrors();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(SLUG);
    expect(logged[0]).toContain(KEYS[1]);
    expect(logged[0]).not.toMatch(/X-Amz-|Signature=/);

    await expectStillServing();
  });

  it('cuts the response off when an object stream dies mid-read, logs once, keeps serving', async () => {
    s3.client.send.mockImplementation((cmd) =>
      Promise.resolve({ Body: keyOf(cmd) === KEYS[1] ? bodyThatDiesMidRead() : healthyBody() }),
    );

    const res = await download(URL_PATH);

    // Before the fix: the object stream's unheard `error` event.
    expect(unhandled).toEqual([]);
    expect(res.status).toBe(200);
    expect(res.outcome).toBe('truncated');
    expect(zipEntryCount(res.body)).toBeNull();
    expect(s3.client.send).toHaveBeenCalledTimes(2);
    expect(bodies.every((b) => b.destroyed || b.readableEnded)).toBe(true);

    const logged = bulkDownloadErrors();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(SLUG);
    expect(logged[0]).toContain(KEYS[1]);

    await expectStillServing();
  });

  it('releases the S3 stream when the client hangs up mid-download, without logging an error', async () => {
    s3.client.send.mockImplementation(() => Promise.resolve({ Body: stallingBody() }));

    await new Promise<void>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: URL_PATH, agent: false }, (res) => {
        res.once('data', () => {
          void waitFor(() => bodies.length === 1).then(() => {
            req.destroy();
            resolve();
          });
        });
      });
      req.on('error', () => undefined);
      req.on('timeout', () => reject(new Error('no response')));
      req.setTimeout(4000);
      req.end();
    });

    expect(await waitFor(() => bodies[0]?.destroyed === true)).toBe(true);
    expect(s3.client.send).toHaveBeenCalledTimes(1);
    expect(bulkDownloadErrors()).toEqual([]);
    expect(unhandled).toEqual([]);
    await expectStillServing();
  });

  it('cancels an S3 request still in flight when the client hangs up', async () => {
    let signal: AbortSignal | undefined;
    s3.client.send.mockImplementation((_cmd, opts) => {
      signal = opts?.abortSignal;
      return new Promise((_resolve, reject) => {
        opts?.abortSignal?.addEventListener('abort', () => reject(new Error('Request aborted')));
      });
    });

    await new Promise<void>((resolve) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: URL_PATH, agent: false }, (res) => {
        res.once('data', () => {
          void waitFor(() => s3.client.send.mock.calls.length === 1).then(() => {
            req.destroy();
            resolve();
          });
        });
      });
      req.on('error', () => undefined);
      req.end();
    });

    expect(await waitFor(() => signal?.aborted === true)).toBe(true);
    expect(bulkDownloadErrors()).toEqual([]);
    expect(unhandled).toEqual([]);
    await expectStillServing();
  });
});

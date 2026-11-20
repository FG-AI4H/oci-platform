import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@oci/database';
import type { DicomInstanceHeader } from '@oci/dicom';
import { DicomSeriesDetailSchema, DicomSeriesListSchema } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  startMigratedPostgres,
} from '../../test-support/migrated-postgres.js';
import type { AccessRequestService } from '../access-request/access-request.service.js';
import { CatalogRepository } from '../catalog/catalog.repository.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { DicomIndexRepository, type DicomCheckStatus } from './dicom-index.repository.js';
import type { DicomIndexService } from './dicom-index.service.js';
import { DicomSeriesRepository } from './dicom-series.repository.js';
import { DicomSeriesService } from './dicom-series.service.js';
import type { S3ClientProvider } from './s3-client.js';
import { StorageService } from './storage.service.js';

/**
 * #674, ADR-0026 — the two DICOM series endpoints against a real
 * Postgres with every migration applied.
 *
 * Nothing between the service and the database is mocked: the index is
 * written by `DicomIndexRepository.save` as an upload does it, the
 * access gate is the real `StorageService.authoriseDatasetBytes`, and
 * the addresses are signed by the real presigner (offline, with
 * throwaway credentials). Only what these routes never reach is a
 * stand-in: the approved-access lookup and the upload-time indexer.
 *
 * Needs a Docker daemon. CI (`CI=true`) always has one and runs this
 * spec; a laptop without Docker skips it rather than failing `pnpm test`.
 */
const dockerAvailable = await checkDocker('dicom-series.int.spec');

const BUCKET = 'oci-datasets-test';
// UUID-shaped subs short-circuit the UUIDv5 derivation.
const HOST_SUB = '00000000-0000-4000-8000-000000000601';
const ADMIN_SUB = '00000000-0000-4000-8000-000000000602';
const STRANGER_SUB = '00000000-0000-4000-8000-000000000603';
const APPROVED_SUB = '00000000-0000-4000-8000-000000000604';

const SERIES_CLEAN = '1.2.826.0.1.3680043.8.498.674.10';
const SERIES_MIXED = '1.2.826.0.1.3680043.8.498.674.20';
const SERIES_HELD = '1.2.826.0.1.3680043.8.498.674.30';

function user(sub: string, ...groups: string[]): CognitoAccessTokenPayload {
  return { sub, 'cognito:groups': groups } as unknown as CognitoAccessTokenPayload;
}
const HOST = user(HOST_SUB, 'host');
const ADMIN = user(ADMIN_SUB, 'admin');
const STRANGER = user(STRANGER_SUB, 'participant');

function header(overrides: Partial<DicomInstanceHeader>): DicomInstanceHeader {
  return {
    sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
    sopInstanceUid: null,
    studyInstanceUid: '1.2.826.0.1.3680043.8.498.674.1',
    seriesInstanceUid: SERIES_CLEAN,
    frameOfReferenceUid: '1.2.826.0.1.3680043.8.498.674.2',
    transferSyntaxUid: '1.2.840.10008.1.2.1',
    modality: 'CT',
    seriesNumber: 1,
    instanceNumber: 1,
    imagePositionPatient: [-100, -100, 0],
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    rows: 512,
    columns: 512,
    numberOfFrames: null,
    bitsAllocated: 16,
    pixelRepresentation: 1,
    photometricInterpretation: 'MONOCHROME2',
    sliceThickness: 5,
    pixelSpacing: [0.5, 0.5],
    windowCenter: 40,
    windowWidth: 80,
    hasPixelData: true,
    ...overrides,
  };
}

describe.skipIf(!dockerAvailable)('DICOM series endpoints against Postgres (#674)', () => {
  let db: MigratedPostgres;
  let prisma: PrismaClient;
  let index: DicomIndexRepository;
  let repo: DicomSeriesRepository;
  let service: DicomSeriesService;
  let approvedDatasetIds: string[];

  let datasetId: string;
  let v1: string;
  let v2: string;
  const slug = 'series-674';

  /** One stored file: its index row, and a distribution in each version given. */
  async function store(args: {
    dataset?: string;
    versions: string[];
    name: string;
    status?: DicomCheckStatus;
    header?: Partial<DicomInstanceHeader> | null;
    kind?: 'single-frame-image' | 'multi-frame-image' | 'other';
    distribution?: Record<string, unknown>;
    key?: string;
  }): Promise<string[]> {
    const key = args.key ?? `${slug}/${randomUUID()}/${args.name}`;
    const status = args.status ?? 'CLEAR';
    await index.save({
      datasetId: args.dataset ?? datasetId,
      s3Bucket: BUCKET,
      s3Key: key,
      checkStatus: status,
      unreadableReason: status === 'UNREADABLE' ? 'test' : null,
      parsed:
        args.header === null
          ? null
          : { header: header(args.header ?? {}), objectKind: args.kind ?? 'single-frame-image' },
      findings: status === 'HELD' ? [{ attribute: 'PatientID', valueDigest: 'digest' }] : [],
    });
    const ids: string[] = [];
    for (const versionId of args.versions) {
      const row = await prisma.distribution.create({
        data: {
          datasetVersionId: versionId,
          croissantId: `${args.name}-${randomUUID().slice(0, 8)}`,
          contentType: 'application/dicom',
          storageBackend: 'S3',
          s3Bucket: BUCKET,
          s3Key: key,
          uploadStatus: 'READY',
          ...args.distribution,
        },
      });
      ids.push(row.id);
    }
    return ids;
  }

  let heldDistributionId: string;
  let gatedDistributionId: string;

  beforeAll(async () => {
    db = await startMigratedPostgres();
    prisma = db.prisma;
    const prismaService = { client: prisma } as unknown as PrismaService;

    index = new DicomIndexRepository(prismaService);
    repo = new DicomSeriesRepository(prismaService);
    const catalog = new CatalogService(new CatalogRepository(prismaService));
    approvedDatasetIds = [];
    const accessRequests = {
      listOwn: async (caller: CognitoAccessTokenPayload) =>
        caller.sub === APPROVED_SUB
          ? approvedDatasetIds.map((id) => ({ dataset: { id }, status: 'APPROVED' }))
          : [],
    } as unknown as AccessRequestService;
    const s3 = {
      bucket: BUCKET,
      publicEndpoint: undefined,
      // Signing is local arithmetic: no request leaves the process.
      client: new S3Client({
        region: 'eu-central-1',
        credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' },
      }),
    } as unknown as S3ClientProvider;
    const storage = new StorageService(
      s3,
      prismaService,
      catalog,
      accessRequests,
      {} as unknown as DicomIndexService,
    );
    service = new DicomSeriesService(repo, storage, catalog);

    datasetId = (
      await prisma.dataset.create({
        data: {
          slug,
          name: 'Series #674',
          hostId: HOST_SUB,
          visibility: 'PUBLIC',
          status: 'PUBLISHED',
        },
      })
    ).id;
    const version = async (name: string, publishedAt: string) =>
      (
        await prisma.datasetVersion.create({
          data: {
            datasetId,
            version: name,
            croissant: {},
            publishedById: HOST_SUB,
            publishedAt: new Date(publishedAt),
          },
        })
      ).id;
    v1 = await version('1.0.0', '2026-11-01T00:00:00Z');
    v2 = await version('1.1.0', '2026-11-10T00:00:00Z');

    // A clean five-slice series, stored out of order. The scanner
    // numbered it from the top down: instance 1 is the highest slice.
    for (const n of [3, 5, 1, 4, 2]) {
      await store({
        // Slices 1 and 2 are carried into the second version as well.
        versions: n <= 2 ? [v1, v2] : [v1],
        name: `clean-${n}.dcm`,
        header: {
          sopInstanceUid: `${SERIES_CLEAN}.${n}`,
          instanceNumber: n,
          imagePositionPatient: [-100, -100, 50 - n * 5],
        },
      });
    }
    // Same series: an object that is not an image, a multi-frame
    // object, a file behind an individual access gate, and an upload
    // that never finished. None of them is an instance the viewer may
    // open.
    await store({
      versions: [v1],
      name: 'cine.dcm',
      kind: 'multi-frame-image',
      header: { sopInstanceUid: `${SERIES_CLEAN}.93`, instanceNumber: 93, numberOfFrames: 40 },
    });
    await store({
      versions: [v1],
      name: 'report.dcm',
      kind: 'other',
      header: { sopInstanceUid: `${SERIES_CLEAN}.90`, instanceNumber: 90 },
    });
    [gatedDistributionId = ''] = await store({
      versions: [v1],
      name: 'gated.dcm',
      header: { sopInstanceUid: `${SERIES_CLEAN}.91`, instanceNumber: 91 },
      distribution: { requiresAccess: true },
    });
    await store({
      versions: [v1],
      name: 'pending.dcm',
      header: { sopInstanceUid: `${SERIES_CLEAN}.92`, instanceNumber: 92 },
      distribution: { uploadStatus: 'PENDING' },
    });

    // Two clean files and one held, in one series.
    for (const n of [1, 2]) {
      await store({
        versions: [v1],
        name: `mixed-${n}.dcm`,
        header: {
          seriesInstanceUid: SERIES_MIXED,
          seriesNumber: 2,
          sopInstanceUid: `${SERIES_MIXED}.${n}`,
          instanceNumber: n,
          imagePositionPatient: [-100, -100, n * 5],
        },
      });
    }
    [heldDistributionId = ''] = await store({
      versions: [v1],
      name: 'mixed-3.dcm',
      status: 'HELD',
      header: {
        seriesInstanceUid: SERIES_MIXED,
        seriesNumber: 2,
        sopInstanceUid: `${SERIES_MIXED}.3`,
        instanceNumber: 3,
        imagePositionPatient: [-100, -100, 15],
        rows: 256,
      },
    });

    // A series every file of which is held.
    for (const n of [1, 2]) {
      await store({
        versions: [v1],
        name: `held-${n}.dcm`,
        status: 'HELD',
        header: {
          seriesInstanceUid: SERIES_HELD,
          seriesNumber: 3,
          sopInstanceUid: `${SERIES_HELD}.${n}`,
          instanceNumber: n,
          imagePositionPatient: [-100, -100, n * 5],
        },
      });
    }
    // A file whose header could not be read belongs to no series.
    await store({ versions: [v1], name: 'broken.dcm', status: 'UNREADABLE', header: null });
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  const list = async (caller?: CognitoAccessTokenPayload, version?: string) =>
    service.listForDataset({ slug, version, user: caller });
  const shape = (out: Awaited<ReturnType<typeof list>>) =>
    out.series.map((s) => [s.seriesInstanceUid, s.instanceCount, s.heldInstanceCount]);
  const seriesId = async (uid: string) =>
    (
      await prisma.dicomSeries.findUniqueOrThrow({
        where: { datasetId_seriesInstanceUid: { datasetId, seriesInstanceUid: uid } },
      })
    ).id;

  describe('the series of a version', () => {
    it('gives a visitor the images they may open, and nothing about held files', async () => {
      const out = await list(undefined, '1.0.0');

      expect(DicomSeriesListSchema.safeParse(out).success).toBe(true);
      expect(out.version).toBe('1.0.0');
      expect(out.total).toBe(2);
      expect(shape(out)).toEqual([
        // Five images: the report, the multi-frame object, the gated
        // file and the unfinished upload are not counted.
        [SERIES_CLEAN, 5, 0],
        // The held third file is absent from the count.
        [SERIES_MIXED, 2, 0],
        // The all-held series is not there at all.
      ]);
      expect(out.series[0]).toMatchObject({ modality: 'CT', seriesNumber: 1, rows: 512 });
    });

    it.each([
      ['a signed-in participant', STRANGER],
      ['the host of another dataset', user(STRANGER_SUB, 'host')],
      ['a regulator', user(STRANGER_SUB, 'regulator')],
    ])('gives %s the same as a visitor', async (_who, caller) => {
      expect(await list(caller, '1.0.0')).toEqual(await list(undefined, '1.0.0'));
    });

    it.each([
      ['the host', HOST],
      ['an admin', ADMIN],
    ])('gives %s the held files too, counted as held', async (_who, caller) => {
      const out = await list(caller, '1.0.0');

      expect(out.total).toBe(3);
      expect(shape(out)).toEqual([
        [SERIES_CLEAN, 5, 0],
        [SERIES_MIXED, 3, 1],
        [SERIES_HELD, 2, 2],
      ]);
      // The held slice has other dimensions: the series has no single size.
      expect(out.series[1]).toMatchObject({ rows: null, columns: 512 });
    });

    it('reads the latest version when none is named', async () => {
      const out = await list();

      expect(out.version).toBe('1.1.0');
      expect(shape(out)).toEqual([[SERIES_CLEAN, 2, 0]]);
    });

    it('counts a stored file once when two distributions of a version point at it', async () => {
      const key = `${slug}/${randomUUID()}/twice.dcm`;
      const twiceDataset = await prisma.dataset.create({
        data: { slug: 'series-674-twice', name: 'Twice', hostId: HOST_SUB, visibility: 'PUBLIC' },
      });
      const version = await prisma.datasetVersion.create({
        data: {
          datasetId: twiceDataset.id,
          version: '1.0.0',
          croissant: {},
          publishedById: HOST_SUB,
        },
      });
      await store({
        dataset: twiceDataset.id,
        versions: [version.id, version.id],
        name: 'twice.dcm',
        key,
        header: { sopInstanceUid: `${SERIES_CLEAN}.1` },
      });

      const out = await service.listForDataset({
        slug: 'series-674-twice',
        version: undefined,
        user: undefined,
      });

      // The same SeriesInstanceUID as in the other dataset, and still
      // this dataset's own series with this dataset's one file.
      expect(out.series).toHaveLength(1);
      expect(out.series[0]).toMatchObject({ seriesInstanceUid: SERIES_CLEAN, instanceCount: 1 });
      expect(out.series[0]?.id).not.toBe(await seriesId(SERIES_CLEAN));
    });

    it('never reads a file indexed for another dataset, even if a distribution points at it', async () => {
      // Publishing refuses to adopt another dataset's file. This is the
      // second line: were such a row to exist, the series endpoints
      // would still not serve the other dataset's index through it.
      const other = await prisma.dataset.create({
        data: {
          slug: 'series-674-other',
          name: 'Other',
          hostId: STRANGER_SUB,
          visibility: 'PUBLIC',
        },
      });
      const version = await prisma.datasetVersion.create({
        data: { datasetId: other.id, version: '1.0.0', croissant: {}, publishedById: STRANGER_SUB },
      });
      const held = await prisma.dicomObject.findFirstOrThrow({
        where: { datasetId, seriesInstanceUid: SERIES_HELD },
      });
      await prisma.distribution.create({
        data: {
          datasetVersionId: version.id,
          croissantId: 'borrowed.dcm',
          contentType: 'application/dicom',
          storageBackend: 'S3',
          s3Bucket: held.s3Bucket,
          s3Key: held.s3Key,
          uploadStatus: 'READY',
        },
      });

      // Asked by the other dataset's own host, who may see its held files.
      const out = await service.listForDataset({
        slug: 'series-674-other',
        version: undefined,
        user: user(STRANGER_SUB, 'host'),
      });

      expect(out).toMatchObject({ total: 0, series: [] });
    });

    it('states one size for a series only when every instance states it, list and detail alike', async () => {
      const uid = '1.2.826.0.1.3680043.8.498.674.50';
      const sized = await prisma.dataset.create({
        data: { slug: 'series-674-sized', name: 'Sized', hostId: HOST_SUB, visibility: 'PUBLIC' },
      });
      const version = await prisma.datasetVersion.create({
        data: { datasetId: sized.id, version: '1.0.0', croissant: {}, publishedById: HOST_SUB },
      });
      for (const [n, rows] of [
        [1, 512],
        [2, null],
      ] as const) {
        await store({
          dataset: sized.id,
          versions: [version.id],
          name: `sized-${n}.dcm`,
          header: {
            seriesInstanceUid: uid,
            sopInstanceUid: `${uid}.${n}`,
            instanceNumber: n,
            rows,
          },
        });
      }

      const listed = await service.listForDataset({
        slug: 'series-674-sized',
        version: undefined,
        user: undefined,
      });
      const entry = listed.series[0];
      const detail = await service.getSeries({
        seriesId: entry?.id ?? '',
        version: undefined,
        user: undefined,
      });

      expect(entry).toMatchObject({ instanceCount: 2, rows: null, columns: 512 });
      expect(detail).toMatchObject({ instanceCount: 2, rows: null, columns: 512 });
    });

    it('stops at the limit and still reports how many there are', async () => {
      const rows = await repo.listSeries({
        datasetId,
        versionId: v1,
        includeHeld: true,
        limit: 1,
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ series_instance_uid: SERIES_CLEAN, total: 3 });
    });

    it('is a 404 for a dataset or a version that does not exist', async () => {
      await expect(
        service.listForDataset({ slug: 'no-such-dataset', version: undefined, user: undefined }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(list(undefined, '9.9.9')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('one series', () => {
    it('returns the instances in stack order, each with a signed storage address', async () => {
      const before = Date.now();
      const out = await service.getSeries({
        seriesId: await seriesId(SERIES_CLEAN),
        version: '1.0.0',
        user: undefined,
      });

      expect(DicomSeriesDetailSchema.safeParse(out).success).toBe(true);
      expect(out).toMatchObject({
        datasetSlug: slug,
        version: '1.0.0',
        seriesInstanceUid: SERIES_CLEAN,
        modality: 'CT',
        instanceCount: 5,
        heldInstanceCount: 0,
        rows: 512,
        columns: 512,
      });
      // Stored as 3, 5, 1, 4, 2.
      expect(out.instances.map((i) => i.instanceNumber)).toEqual([1, 2, 3, 4, 5]);
      expect(out.instances.map((i) => i.imagePositionPatient?.[2])).toEqual([45, 40, 35, 30, 25]);
      expect(out.instances[0]).toMatchObject({
        sopInstanceUid: `${SERIES_CLEAN}.1`,
        transferSyntaxUid: '1.2.840.10008.1.2.1',
        pixelSpacing: [0.5, 0.5],
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        windowCenter: 40,
        windowWidth: 80,
        held: false,
      });

      for (const instance of out.instances) {
        const url = new URL(instance.url);
        expect(url.hostname).toContain(BUCKET);
        expect(decodeURIComponent(url.pathname)).toMatch(
          new RegExp(`^/${slug}/[0-9a-f-]{36}/clean-${instance.instanceNumber}\\.dcm$`),
        );
        expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
        expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      }
      // Stated expiry never later than the addresses really last.
      const stated = new Date(out.expiresAt).getTime();
      expect(stated).toBeGreaterThanOrEqual(before + 900_000);
      expect(stated).toBeLessThanOrEqual(Date.now() + 900_000);
    });

    it('leaves out the gated file, the unfinished upload and what is not a single-frame image', async () => {
      const out = await service.getSeries({
        seriesId: await seriesId(SERIES_CLEAN),
        version: '1.0.0',
        user: HOST,
      });

      expect(out.instances).toHaveLength(5);
      expect(out.instances.map((i) => i.distributionId)).not.toContain(gatedDistributionId);
    });

    it('gives a visitor the series without its held file, and the host all of it', async () => {
      const id = await seriesId(SERIES_MIXED);

      const forVisitor = await service.getSeries({
        seriesId: id,
        version: '1.0.0',
        user: undefined,
      });
      expect(forVisitor.instances.map((i) => i.instanceNumber)).toEqual([1, 2]);
      expect(forVisitor.heldInstanceCount).toBe(0);
      expect(JSON.stringify(forVisitor)).not.toContain(heldDistributionId);
      expect(JSON.stringify(forVisitor)).not.toContain('mixed-3.dcm');

      const forHost = await service.getSeries({ seriesId: id, version: '1.0.0', user: HOST });
      expect(forHost.instances.map((i) => [i.instanceNumber, i.held])).toEqual([
        [1, false],
        [2, false],
        [3, true],
      ]);
      expect(forHost.heldInstanceCount).toBe(1);
      expect(forHost.rows).toBeNull();
    });

    it('answers a series of held files exactly as an unknown id, except to its host and admins', async () => {
      const id = await seriesId(SERIES_HELD);
      const unknown = await service
        .getSeries({ seriesId: randomUUID(), version: '1.0.0', user: undefined })
        .catch((err: unknown) => err);

      for (const caller of [undefined, STRANGER, user(STRANGER_SUB, 'regulator')]) {
        // A version that does not exist must not give the id away either.
        for (const version of ['1.0.0', '9.9.9', undefined]) {
          const refused = await service
            .getSeries({ seriesId: id, version, user: caller })
            .catch((err: unknown) => err);
          expect(refused).toBeInstanceOf(NotFoundException);
          expect((refused as NotFoundException).getResponse()).toEqual(
            (unknown as NotFoundException).getResponse(),
          );
        }
      }
      for (const caller of [HOST, ADMIN]) {
        const out = await service.getSeries({ seriesId: id, version: '1.0.0', user: caller });
        expect(out.instances.map((i) => i.held)).toEqual([true, true]);
      }
    });

    it('follows the files into the version that carries them', async () => {
      const id = await seriesId(SERIES_CLEAN);

      const latest = await service.getSeries({ seriesId: id, version: undefined, user: undefined });
      expect(latest.version).toBe('1.1.0');
      expect(latest.instances.map((i) => i.instanceNumber)).toEqual([1, 2]);

      // A series the latest version does not carry is not found there.
      await expect(
        service.getSeries({
          seriesId: await seriesId(SERIES_MIXED),
          version: undefined,
          user: HOST,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('the dataset gate', () => {
    async function withVisibility<T>(
      visibility: 'PRIVATE' | 'RESTRICTED',
      run: () => Promise<T>,
    ): Promise<T> {
      await prisma.dataset.update({ where: { id: datasetId }, data: { visibility } });
      try {
        return await run();
      } finally {
        await prisma.dataset.update({ where: { id: datasetId }, data: { visibility: 'PUBLIC' } });
      }
    }

    it('refuses both routes on a private dataset to everyone but its host and admins', async () => {
      await withVisibility('PRIVATE', async () => {
        const id = await seriesId(SERIES_CLEAN);
        for (const caller of [undefined, STRANGER, user(STRANGER_SUB, 'host')]) {
          await expect(list(caller, '1.0.0')).rejects.toBeInstanceOf(ForbiddenException);
          await expect(
            service.getSeries({ seriesId: id, version: '1.0.0', user: caller }),
          ).rejects.toBeInstanceOf(ForbiddenException);
        }
        for (const caller of [HOST, ADMIN]) {
          expect((await list(caller, '1.0.0')).total).toBe(3);
          expect(
            (await service.getSeries({ seriesId: id, version: '1.0.0', user: caller })).instances,
          ).toHaveLength(5);
        }
      });
    });

    it('opens a restricted dataset to an approved requester, held files still withheld', async () => {
      await withVisibility('RESTRICTED', async () => {
        const approved = user(APPROVED_SUB, 'participant');
        await expect(list(undefined, '1.0.0')).rejects.toBeInstanceOf(ForbiddenException);
        await expect(list(approved, '1.0.0')).rejects.toBeInstanceOf(ForbiddenException);

        approvedDatasetIds.push(datasetId);
        try {
          expect(shape(await list(approved, '1.0.0'))).toEqual([
            [SERIES_CLEAN, 5, 0],
            [SERIES_MIXED, 2, 0],
          ]);
          await expect(
            service.getSeries({
              seriesId: await seriesId(SERIES_HELD),
              version: '1.0.0',
              user: approved,
            }),
          ).rejects.toBeInstanceOf(NotFoundException);
        } finally {
          approvedDatasetIds.length = 0;
        }
      });
    });
  });

  describe('the series row', () => {
    it('is created once when the files of a new series are indexed side by side', async () => {
      const uid = '1.2.826.0.1.3680043.8.498.674.40';

      await Promise.all(
        Array.from({ length: 12 }, (_, n) =>
          store({
            versions: [v1],
            name: `race-${n}.dcm`,
            header: {
              seriesInstanceUid: uid,
              seriesNumber: 4,
              sopInstanceUid: `${uid}.${n}`,
              instanceNumber: n + 1,
              imagePositionPatient: [-100, -100, n],
            },
          }),
        ),
      );

      expect(await prisma.dicomSeries.count({ where: { datasetId, seriesInstanceUid: uid } })).toBe(
        1,
      );
      const out = await service.getSeries({
        seriesId: await seriesId(uid),
        version: '1.0.0',
        user: undefined,
      });
      expect(out.instances).toHaveLength(12);
    });

    it('keeps its id when a file of the series is indexed again', async () => {
      const before = await seriesId(SERIES_MIXED);

      await store({
        versions: [],
        name: 'mixed-again.dcm',
        header: { seriesInstanceUid: SERIES_MIXED, sopInstanceUid: `${SERIES_MIXED}.9` },
      });

      expect(await seriesId(SERIES_MIXED)).toBe(before);
    });
  });
});

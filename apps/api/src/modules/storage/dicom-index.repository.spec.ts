import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DicomInstanceHeader } from '@oci/dicom';
import type { PrismaService } from '../../prisma.service.js';
import { DicomIndexRepository, type DicomObjectRecord } from './dicom-index.repository.js';

const header = (overrides: Partial<DicomInstanceHeader> = {}): DicomInstanceHeader => ({
  sopClassUid: null,
  sopInstanceUid: null,
  studyInstanceUid: null,
  seriesInstanceUid: 'series-1',
  frameOfReferenceUid: null,
  transferSyntaxUid: '1.2.840.10008.1.2.1',
  modality: 'CT',
  seriesNumber: 2,
  instanceNumber: 7,
  imagePositionPatient: [0, 0, 5],
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
});

const record = (overrides: Partial<DicomObjectRecord> = {}): DicomObjectRecord => ({
  datasetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  s3Bucket: 'test-bucket',
  s3Key: 'demo/1/slice.dcm',
  checkStatus: 'HELD',
  unreadableReason: null,
  parsed: { header: header(), objectKind: 'single-frame-image' },
  findings: [{ attribute: 'PatientID', valueDigest: 'digest-a' }],
  ...overrides,
});

let tx: {
  dicomObject: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  dicomFinding: { deleteMany: ReturnType<typeof vi.fn>; createMany: ReturnType<typeof vi.fn> };
  dicomSeries: { createMany: ReturnType<typeof vi.fn> };
  dicomAcceptedFinding: { findMany: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
};
let repo: DicomIndexRepository;

beforeEach(() => {
  tx = {
    dicomObject: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'object-1' }),
    },
    dicomFinding: { deleteMany: vi.fn(), createMany: vi.fn() },
    dicomSeries: { createMany: vi.fn() },
    // Default: no operator decision for the dataset.
    dicomAcceptedFinding: { findMany: vi.fn().mockResolvedValue([]) },
    // The per-dataset lock.
    $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
  };
  const prisma = {
    client: { $transaction: <T>(run: (client: typeof tx) => Promise<T>) => run(tx) },
  };
  repo = new DicomIndexRepository(prisma as unknown as PrismaService);
});

const written = () =>
  tx.dicomObject.upsert.mock.calls[0]?.[0] as { create: Record<string, unknown> };

describe('DicomIndexRepository.save', () => {
  it('writes the row keyed by where the bytes live and replaces its findings', async () => {
    await repo.save(record());

    expect(tx.dicomObject.upsert.mock.calls[0]?.[0]).toMatchObject({
      where: { s3Bucket_s3Key: { s3Bucket: 'test-bucket', s3Key: 'demo/1/slice.dcm' } },
      create: { checkStatus: 'HELD', objectKind: 'SINGLE_FRAME_IMAGE', instanceNumber: 7 },
    });
    expect(tx.dicomFinding.deleteMany).toHaveBeenCalledWith({
      where: { dicomObjectId: 'object-1' },
    });
    expect(tx.dicomFinding.createMany.mock.calls[0]?.[0]).toMatchObject({
      data: [{ dicomObjectId: 'object-1', attribute: 'PatientID', valueDigest: 'digest-a' }],
    });
  });

  it('stores null for a header integer that does not fit the column', async () => {
    // A date written into InstanceNumber, and a crafted value.
    await repo.save(
      record({
        parsed: {
          header: header({ instanceNumber: 20190101123456, seriesNumber: -99999999999 }),
          objectKind: 'single-frame-image',
        },
      }),
    );

    expect(written().create).toMatchObject({ instanceNumber: null, seriesNumber: null, rows: 512 });
  });

  // What is accepted, for which dataset and on which file, is decided
  // by the database: those rules are tested against a real Postgres in
  // `dicom-review.int.spec.ts`. Here: what this code asks, and when.

  it('releases a file whose valued findings are all accepted for its dataset', async () => {
    tx.dicomAcceptedFinding.findMany.mockResolvedValue([
      { attribute: 'PatientID', valueDigest: 'digest-a', decisionId: 'decision-1' },
    ]);
    const onRelease = vi.fn();

    await expect(repo.save(record(), onRelease)).resolves.toBe('RELEASED');

    expect(written().create).toMatchObject({ checkStatus: 'RELEASED' });
    // Asked for THIS dataset, and for the file's own values only.
    expect(tx.dicomAcceptedFinding.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        datasetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        attribute: { in: ['PatientID'] },
        valueDigest: { in: ['digest-a'] },
      },
    });
    // The findings are still recorded: a decision covers them, it does
    // not erase them. And the release is reported, with its decisions.
    expect(tx.dicomFinding.createMany).toHaveBeenCalled();
    expect(onRelease).toHaveBeenCalledWith(tx, { decisionIds: ['decision-1'], findingCount: 1 });
  });

  it('holds a file when one of its findings is not accepted, even if the others are', async () => {
    tx.dicomAcceptedFinding.findMany.mockResolvedValue([
      { attribute: 'PatientID', valueDigest: 'digest-a', decisionId: 'decision-1' },
    ]);
    const onRelease = vi.fn();

    await expect(
      repo.save(
        record({
          findings: [
            { attribute: 'PatientID', valueDigest: 'digest-a' },
            { attribute: 'PatientName', valueDigest: 'digest-new' },
          ],
        }),
        onRelease,
      ),
    ).resolves.toBe('HELD');

    expect(written().create).toMatchObject({ checkStatus: 'HELD' });
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('holds a new file for a whole-file finding, whatever was accepted for the dataset', async () => {
    tx.dicomAcceptedFinding.findMany.mockResolvedValue([
      { attribute: 'PatientID', valueDigest: 'digest-a', decisionId: 'decision-1' },
    ]);

    await expect(
      repo.save(
        record({
          findings: [
            { attribute: 'PatientID', valueDigest: 'digest-a' },
            { attribute: 'BurnedInAnnotation', valueDigest: 'digest-yes' },
          ],
        }),
      ),
    ).resolves.toBe('HELD');

    // The whole-file finding is not even asked about for the dataset.
    expect(tx.dicomAcceptedFinding.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { attribute: { in: ['PatientID'] }, valueDigest: { in: ['digest-a'] } },
    });
  });

  it('keeps what an operator accepted on this very file when it is checked again', async () => {
    tx.dicomObject.findUnique.mockResolvedValue({
      checkStatus: 'RELEASED',
      findings: [
        {
          attribute: 'BurnedInAnnotation',
          valueDigest: 'digest-yes',
          acceptedDecisionId: 'decision-2',
        },
      ],
    });
    const onRelease = vi.fn();

    await expect(
      repo.save(
        record({ findings: [{ attribute: 'BurnedInAnnotation', valueDigest: 'digest-yes' }] }),
        onRelease,
      ),
    ).resolves.toBe('RELEASED');

    expect(tx.dicomFinding.createMany.mock.calls[0]?.[0]).toMatchObject({
      data: [{ attribute: 'BurnedInAnnotation', acceptedDecisionId: 'decision-2' }],
    });
    // It was released already: nothing new to report.
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('takes the per-dataset lock before deciding, and only for a file with findings', async () => {
    await repo.save(record());
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

    tx.$queryRaw.mockClear();
    await expect(repo.save(record({ checkStatus: 'CLEAR', findings: [] }))).resolves.toBe('CLEAR');
    await expect(
      repo.save(record({ checkStatus: 'UNREADABLE', parsed: null, findings: [] })),
    ).resolves.toBe('UNREADABLE');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.dicomAcceptedFinding.findMany).toHaveBeenCalledTimes(1);
  });

  it('gives the series a row of its own, without failing when it is already there', async () => {
    await repo.save(record());

    // `skipDuplicates` is ON CONFLICT DO NOTHING: the files of one
    // series finish side by side, and each of them tries.
    expect(tx.dicomSeries.createMany).toHaveBeenCalledWith({
      data: [{ datasetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', seriesInstanceUid: 'series-1' }],
      skipDuplicates: true,
    });
  });

  it('creates no series row for a file that names no series', async () => {
    await repo.save(
      record({
        parsed: { header: header({ seriesInstanceUid: null }), objectKind: 'other' },
      }),
    );
    await repo.save(record({ checkStatus: 'UNREADABLE', parsed: null, findings: [] }));

    expect(tx.dicomSeries.createMany).not.toHaveBeenCalled();
  });

  it('records an unreadable file with no header columns and no findings', async () => {
    await repo.save(
      record({
        checkStatus: 'UNREADABLE',
        unreadableReason: 'cut short',
        parsed: null,
        findings: [],
      }),
    );

    expect(written().create).toMatchObject({
      checkStatus: 'UNREADABLE',
      unreadableReason: 'cut short',
      objectKind: null,
      modality: null,
      imagePositionPatient: [],
    });
    expect(tx.dicomFinding.createMany).not.toHaveBeenCalled();
  });
});

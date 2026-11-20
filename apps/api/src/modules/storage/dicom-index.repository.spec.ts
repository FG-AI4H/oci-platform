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
};
let repo: DicomIndexRepository;

beforeEach(() => {
  tx = {
    dicomObject: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'object-1' }),
    },
    dicomFinding: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  const prisma = {
    client: { $transaction: (run: (client: typeof tx) => Promise<void>) => run(tx) },
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

  it('keeps an operator-released file released when checked again with the same findings', async () => {
    tx.dicomObject.findUnique.mockResolvedValue({
      checkStatus: 'RELEASED',
      findings: [
        { attribute: 'PatientID', valueDigest: 'digest-a' },
        { attribute: 'StudyDate', valueDigest: 'digest-d' },
      ],
    });

    await repo.save(record());

    expect(written().create).toMatchObject({ checkStatus: 'RELEASED' });
  });

  it('holds it again when the new check finds something the decision did not cover', async () => {
    tx.dicomObject.findUnique.mockResolvedValue({
      checkStatus: 'RELEASED',
      findings: [{ attribute: 'PatientID', valueDigest: 'digest-a' }],
    });

    await repo.save(
      record({
        findings: [
          { attribute: 'PatientID', valueDigest: 'digest-a' },
          { attribute: 'PatientName', valueDigest: 'digest-new' },
        ],
      }),
    );

    expect(written().create).toMatchObject({ checkStatus: 'HELD' });
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

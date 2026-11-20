import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@oci/database';
import type { DicomInstanceHeader, DicomObjectKind } from '@oci/dicom';
import { DICOM_HELD_STATUSES } from '../../common/dicom-hold.js';
import { PrismaService } from '../../prisma.service.js';

export type DicomCheckStatus = 'CLEAR' | 'HELD' | 'RELEASED' | 'UNREADABLE';

const OBJECT_KIND = {
  'single-frame-image': 'SINGLE_FRAME_IMAGE',
  'multi-frame-image': 'MULTI_FRAME_IMAGE',
  other: 'OTHER',
} as const satisfies Record<DicomObjectKind, string>;

const INT4_MAX = 2_147_483_647;

/**
 * Header integers go into INT4 columns. A value outside that range
 * (a date written into InstanceNumber, or a crafted one) is not a
 * usable number for ordering; store null, do not fail the upload.
 */
function int4(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number.isInteger(value) && Math.abs(value) <= INT4_MAX ? value : null;
}

export interface DicomObjectRecord {
  datasetId: string;
  s3Bucket: string;
  s3Key: string;
  checkStatus: DicomCheckStatus;
  unreadableReason: string | null;
  /** Null when the header could not be read. */
  parsed: { header: DicomInstanceHeader; objectKind: DicomObjectKind } | null;
  /** Keyed digests only. Values never reach this layer. */
  findings: Array<{ attribute: string; valueDigest: string }>;
}

/**
 * The only place that touches `catalog.dicom_objects`,
 * `catalog.dicom_findings` and `catalog.dicom_series` on the write
 * side (ADR-0026).
 */
@Injectable()
export class DicomIndexRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Record the outcome of the header check for one stored file. Keyed
   * by where the bytes live, so indexing the same file again replaces
   * its row and its findings.
   */
  async save(record: DicomObjectRecord): Promise<void> {
    const header = record.parsed?.header ?? null;
    const columns = {
      datasetId: record.datasetId,
      checkStatus: record.checkStatus as DicomCheckStatus,
      unreadableReason: record.unreadableReason,
      objectKind: record.parsed ? OBJECT_KIND[record.parsed.objectKind] : null,
      sopClassUid: header?.sopClassUid ?? null,
      sopInstanceUid: header?.sopInstanceUid ?? null,
      studyInstanceUid: header?.studyInstanceUid ?? null,
      seriesInstanceUid: header?.seriesInstanceUid ?? null,
      frameOfReferenceUid: header?.frameOfReferenceUid ?? null,
      transferSyntaxUid: header?.transferSyntaxUid ?? null,
      modality: header?.modality ?? null,
      seriesNumber: int4(header?.seriesNumber),
      instanceNumber: int4(header?.instanceNumber),
      imagePositionPatient: header?.imagePositionPatient ?? [],
      imageOrientationPatient: header?.imageOrientationPatient ?? [],
      rows: int4(header?.rows),
      columns: int4(header?.columns),
      numberOfFrames: int4(header?.numberOfFrames),
      bitsAllocated: int4(header?.bitsAllocated),
      pixelRepresentation: int4(header?.pixelRepresentation),
      photometricInterpretation: header?.photometricInterpretation ?? null,
      sliceThickness: header?.sliceThickness ?? null,
      pixelSpacing: header?.pixelSpacing ?? [],
      windowCenter: header?.windowCenter ?? null,
      windowWidth: header?.windowWidth ?? null,
      indexedAt: new Date(),
    };

    await this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
      // Checking the same file again must not undo an operator's
      // decision: a RELEASED file stays released as long as the check
      // finds nothing the decision did not already cover.
      const existing = await tx.dicomObject.findUnique({
        where: { s3Bucket_s3Key: { s3Bucket: record.s3Bucket, s3Key: record.s3Key } },
        select: {
          checkStatus: true,
          findings: { select: { attribute: true, valueDigest: true } },
        },
      });
      if (existing?.checkStatus === 'RELEASED' && record.checkStatus === 'HELD') {
        const covered = new Set(
          existing.findings.map(
            (f: { attribute: string; valueDigest: string }) => `${f.attribute}\n${f.valueDigest}`,
          ),
        );
        if (record.findings.every((f) => covered.has(`${f.attribute}\n${f.valueDigest}`))) {
          columns.checkStatus = 'RELEASED';
        }
      }

      const object = await tx.dicomObject.upsert({
        where: { s3Bucket_s3Key: { s3Bucket: record.s3Bucket, s3Key: record.s3Key } },
        create: { s3Bucket: record.s3Bucket, s3Key: record.s3Key, ...columns },
        update: columns,
        select: { id: true },
      });
      // The series gets a row of its own, so that it has an id a route
      // can carry. The files of one series are uploaded side by side:
      // `skipDuplicates` (ON CONFLICT DO NOTHING) lets them all try.
      if (header?.seriesInstanceUid) {
        await tx.dicomSeries.createMany({
          data: [{ datasetId: record.datasetId, seriesInstanceUid: header.seriesInstanceUid }],
          skipDuplicates: true,
        });
      }
      await tx.dicomFinding.deleteMany({ where: { dicomObjectId: object.id } });
      if (record.findings.length > 0) {
        await tx.dicomFinding.createMany({
          data: record.findings.map((finding) => ({
            dicomObjectId: object.id,
            attribute: finding.attribute,
            valueDigest: finding.valueDigest,
          })),
          skipDuplicates: true,
        });
      }
    });
  }

  /** True when the stored file is held. A file with no row is not DICOM. */
  async isHeld(s3Bucket: string, s3Key: string): Promise<boolean> {
    const row = await this.prisma.client.dicomObject.findFirst({
      where: { s3Bucket, s3Key, checkStatus: { in: [...DICOM_HELD_STATUSES] } },
      select: { id: true },
    });
    return row !== null;
  }
}

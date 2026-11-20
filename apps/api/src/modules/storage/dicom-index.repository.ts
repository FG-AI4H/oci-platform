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
 * The only place that touches `catalog.dicom_objects` and
 * `catalog.dicom_findings` on the write side (ADR-0026).
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
      checkStatus: record.checkStatus,
      unreadableReason: record.unreadableReason,
      objectKind: record.parsed ? OBJECT_KIND[record.parsed.objectKind] : null,
      sopClassUid: header?.sopClassUid ?? null,
      sopInstanceUid: header?.sopInstanceUid ?? null,
      studyInstanceUid: header?.studyInstanceUid ?? null,
      seriesInstanceUid: header?.seriesInstanceUid ?? null,
      frameOfReferenceUid: header?.frameOfReferenceUid ?? null,
      transferSyntaxUid: header?.transferSyntaxUid ?? null,
      modality: header?.modality ?? null,
      seriesNumber: header?.seriesNumber ?? null,
      instanceNumber: header?.instanceNumber ?? null,
      imagePositionPatient: header?.imagePositionPatient ?? [],
      imageOrientationPatient: header?.imageOrientationPatient ?? [],
      rows: header?.rows ?? null,
      columns: header?.columns ?? null,
      numberOfFrames: header?.numberOfFrames ?? null,
      bitsAllocated: header?.bitsAllocated ?? null,
      pixelRepresentation: header?.pixelRepresentation ?? null,
      photometricInterpretation: header?.photometricInterpretation ?? null,
      sliceThickness: header?.sliceThickness ?? null,
      pixelSpacing: header?.pixelSpacing ?? [],
      windowCenter: header?.windowCenter ?? null,
      windowWidth: header?.windowWidth ?? null,
      indexedAt: new Date(),
    };

    await this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
      const object = await tx.dicomObject.upsert({
        where: { s3Bucket_s3Key: { s3Bucket: record.s3Bucket, s3Key: record.s3Key } },
        create: { s3Bucket: record.s3Bucket, s3Key: record.s3Key, ...columns },
        update: columns,
        select: { id: true },
      });
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

  /**
   * The held files of one dataset, as `bucket\nkey`. One query whatever
   * the number of files, for callers that filter a whole file list.
   */
  async heldObjectKeys(datasetId: string): Promise<Set<string>> {
    const rows = await this.prisma.client.dicomObject.findMany({
      where: { datasetId, checkStatus: { in: [...DICOM_HELD_STATUSES] } },
      select: { s3Bucket: true, s3Key: true },
    });
    return new Set(
      rows.map((row: { s3Bucket: string; s3Key: string }) => objectKey(row.s3Bucket, row.s3Key)),
    );
  }
}

/** Newline cannot occur in a bucket name, so the pair is unambiguous. */
export function objectKey(s3Bucket: string, s3Key: string): string {
  return `${s3Bucket}\n${s3Key}`;
}

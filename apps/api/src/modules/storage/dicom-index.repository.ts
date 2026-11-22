import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@oci/database';
import { isWholeFileFinding, type DicomInstanceHeader, type DicomObjectKind } from '@oci/dicom';
import { DICOM_HELD_STATUSES } from '../../common/dicom-hold.js';
import { PrismaService } from '../../prisma.service.js';
import { lockDatasetFindings } from './repositories/dicom-review.raw.js';

export type DicomCheckStatus = 'CLEAR' | 'HELD' | 'RELEASED' | 'UNREADABLE';

const OBJECT_KIND = {
  'single-frame-image': 'SINGLE_FRAME_IMAGE',
  'multi-frame-image': 'MULTI_FRAME_IMAGE',
  other: 'OTHER',
} as const satisfies Record<DicomObjectKind, string>;

/** How a finding is named wherever one has to be matched to another. */
export function findingKey(attribute: string, valueDigest: string): string {
  return `${attribute}\n${valueDigest}`;
}

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
   *
   * Returns the status stored, which is `RELEASED` instead of `HELD`
   * when an operator has already accepted every finding of this file
   * (ADR-0026). A finding with a value is accepted for the dataset, so
   * a decision covers the values it names in files uploaded later. A
   * finding about the file as a whole is accepted on one file only, so
   * a new file that has one is always held.
   */
  async save(
    record: DicomObjectRecord,
    /** Called in the transaction when the file is stored as released. */
    onRelease?: (
      tx: Prisma.TransactionClient,
      release: { decisionIds: string[]; findingCount: number },
    ) => Promise<void>,
  ): Promise<DicomCheckStatus> {
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

    return this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
      const where = { s3Bucket_s3Key: { s3Bucket: record.s3Bucket, s3Key: record.s3Key } };
      /** Decision per finding of this file, for the findings that are accepted. */
      const acceptedBy = new Map<string, string>();
      let previousStatus: DicomCheckStatus | null = null;

      if (record.checkStatus === 'HELD' && record.findings.length > 0) {
        // Not while a decision on this dataset is being recorded: the
        // decision would not see this file, and this file would not see
        // the decision.
        await lockDatasetFindings(tx, record.datasetId);

        const valued = record.findings.filter((f) => !isWholeFileFinding(f.attribute));
        if (valued.length > 0) {
          // Accepted for the dataset, by exactly these values. Only the
          // findings with a value are asked about: a row accepting a
          // whole-file finding for the dataset, should one exist, is
          // never read.
          const rows = (await tx.dicomAcceptedFinding.findMany({
            where: {
              datasetId: record.datasetId,
              attribute: { in: [...new Set(valued.map((f) => f.attribute))] },
              valueDigest: { in: [...new Set(valued.map((f) => f.valueDigest))] },
            },
            select: { attribute: true, valueDigest: true, decisionId: true },
          })) as Array<{ attribute: string; valueDigest: string; decisionId: string }>;
          for (const row of rows) {
            acceptedBy.set(findingKey(row.attribute, row.valueDigest), row.decisionId);
          }
        }

        // A finding about the file as a whole is accepted on a file, never
        // for the dataset: a new file is held for it whatever was decided
        // on others. Only this same file, checked again, keeps what an
        // operator accepted on it.
        const existing = (await tx.dicomObject.findUnique({
          where,
          select: {
            checkStatus: true,
            findings: {
              select: { attribute: true, valueDigest: true, acceptedDecisionId: true },
            },
          },
        })) as {
          checkStatus: DicomCheckStatus;
          findings: Array<{
            attribute: string;
            valueDigest: string;
            acceptedDecisionId: string | null;
          }>;
        } | null;
        previousStatus = existing?.checkStatus ?? null;
        for (const finding of existing?.findings ?? []) {
          if (finding.acceptedDecisionId && isWholeFileFinding(finding.attribute)) {
            acceptedBy.set(
              findingKey(finding.attribute, finding.valueDigest),
              finding.acceptedDecisionId,
            );
          }
        }

        if (record.findings.every((f) => acceptedBy.has(findingKey(f.attribute, f.valueDigest)))) {
          columns.checkStatus = 'RELEASED';
        }
      }

      const object = await tx.dicomObject.upsert({
        where,
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
            acceptedDecisionId: isWholeFileFinding(finding.attribute)
              ? (acceptedBy.get(findingKey(finding.attribute, finding.valueDigest)) ?? null)
              : null,
          })),
          skipDuplicates: true,
        });
      }

      // A file that becomes visible to other readers without an operator
      // deciding at that moment still leaves a trace: which decisions
      // covered it. Written with the row, or not at all.
      if (columns.checkStatus === 'RELEASED' && previousStatus !== 'RELEASED' && onRelease) {
        await onRelease(tx, {
          decisionIds: [...new Set(acceptedBy.values())].sort(),
          findingCount: record.findings.length,
        });
      }
      return columns.checkStatus;
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

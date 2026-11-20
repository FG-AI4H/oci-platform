import { createHmac } from 'node:crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  DATA_AFTER_PIXEL_DATA,
  DEFAULT_MAX_HEADER_BYTES,
  endsWithSequenceDelimiter,
  parseDicomHeader,
  type DeidentificationFinding,
} from '@oci/dicom';
import { DicomIndexRepository, type DicomCheckStatus } from './dicom-index.repository.js';
import { S3ClientProvider } from './s3-client.js';

/** Real headers are a few kilobytes; one read is almost always enough. */
const FIRST_READ_BYTES = 64 * 1024;
/** The item that closes compressed pixel data is eight bytes long. */
const TAIL_BYTES = 8;
/** Used only when OCI_ENV=local, which no deployed environment sets. */
const LOCAL_DIGEST_KEY = 'local-dev-only-dicom-finding-digest-key';

interface RangeRead {
  bytes: Uint8Array;
  /** Size of the whole stored file, as storage reports it. */
  totalSize: number;
}

/**
 * Header check and series index for stored DICOM files (ADR-0026).
 *
 * Called once a file is stored and before it is offered to anyone. It
 * reads the first bytes of the file, never the pixel data, decides
 * whether the file is DICOM by its content, records what the series
 * index needs, and records each de-identification finding as a keyed
 * digest. A file with findings is held.
 *
 * Everything here fails closed. If the check cannot run, the caller
 * gets an exception and must not make the file available.
 */
@Injectable()
export class DicomIndexService {
  private readonly logger = new Logger(DicomIndexService.name);
  private readonly digestKey: string | null;

  constructor(
    @Inject(S3ClientProvider) private readonly s3: S3ClientProvider,
    @Inject(DicomIndexRepository) private readonly repo: DicomIndexRepository,
  ) {
    const configured = process.env.OCI_DICOM_FINDING_DIGEST_KEY;
    if (configured) {
      this.digestKey = configured;
    } else if (process.env.OCI_ENV === 'local') {
      this.digestKey = LOCAL_DIGEST_KEY;
    } else {
      this.digestKey = null;
      this.logger.warn(
        'OCI_DICOM_FINDING_DIGEST_KEY is not set: DICOM uploads with findings will be refused',
      );
    }
  }

  /**
   * Check one stored file. Returns its status, or null when the file is
   * not DICOM (nothing is recorded and it is served as before).
   *
   * Throws when storage cannot be read or findings cannot be recorded.
   */
  async indexStoredObject(args: {
    datasetId: string;
    s3Bucket: string;
    s3Key: string;
  }): Promise<DicomCheckStatus | null> {
    const { s3Bucket, s3Key } = args;

    let read = await this.readRange(s3Bucket, s3Key, `bytes=0-${FIRST_READ_BYTES - 1}`);
    // The size comes from storage, never from what the uploader claimed.
    let result = parseDicomHeader(read.bytes, { totalSize: read.totalSize });
    while (result.kind === 'truncated') {
      const limit = Math.min(read.totalSize, DEFAULT_MAX_HEADER_BYTES);
      if (read.bytes.length >= limit) {
        // The parser stops asking at the limit; this only guards the loop.
        result = { kind: 'unreadable', reason: 'the header could not be read within the limit' };
        break;
      }
      const next = Math.min(limit, read.bytes.length * 4);
      read = await this.readRange(s3Bucket, s3Key, `bytes=0-${next - 1}`);
      result = parseDicomHeader(read.bytes, { totalSize: read.totalSize });
    }

    if (result.kind === 'not-dicom') return null;

    if (result.kind === 'unreadable') {
      await this.repo.save({
        ...args,
        checkStatus: 'UNREADABLE',
        unreadableReason: result.reason.slice(0, 300),
        parsed: null,
        findings: [],
      });
      // The dataset, not the key: a file name can carry an identifier.
      this.logger.warn(`dicom-index dataset=${args.datasetId} status=UNREADABLE`);
      return 'UNREADABLE';
    }

    let findings = result.findings;
    // Compressed pixel data does not say where it ends. If the file does
    // not end with the closing item, something follows that the check
    // did not examine.
    if (result.pixelData !== null && result.pixelData.length === null) {
      const start = Math.max(0, read.totalSize - TAIL_BYTES);
      const tail = await this.readRange(s3Bucket, s3Key, `bytes=${start}-${read.totalSize - 1}`);
      if (!endsWithSequenceDelimiter(tail.bytes)) findings = [...findings, DATA_AFTER_PIXEL_DATA];
    }

    const checkStatus: DicomCheckStatus = findings.length > 0 ? 'HELD' : 'CLEAR';
    await this.repo.save({
      ...args,
      checkStatus,
      unreadableReason: null,
      parsed: { header: result.header, objectKind: result.objectKind },
      findings: this.digests(findings),
    });
    // Counts only. A value never reaches a log, and neither does the
    // key: a file name can carry an identifier.
    this.logger.log(
      `dicom-index dataset=${args.datasetId} status=${checkStatus} kind=${result.objectKind} findings=${findings.length}`,
    );
    return checkStatus;
  }

  /** True when the stored file is held (ADR-0026). */
  isHeld(s3Bucket: string, s3Key: string): Promise<boolean> {
    return this.repo.isHeld(s3Bucket, s3Key);
  }

  /** The held files of a dataset, as keys built by `objectKey`. */
  heldObjectKeys(datasetId: string): Promise<Set<string>> {
    return this.repo.heldObjectKeys(datasetId);
  }

  /**
   * One digest per distinct (attribute, value). Keyed, so that a short
   * value such as a name cannot be recovered from the database or the
   * audit trail by trying candidates.
   */
  private digests(
    findings: readonly DeidentificationFinding[],
  ): Array<{ attribute: string; valueDigest: string }> {
    if (findings.length === 0) return [];
    const key = this.digestKey;
    if (key === null) {
      throw new ServiceUnavailableException(
        'DICOM files cannot be accepted on this deployment: the finding digest key is not configured',
      );
    }
    return findings.map((finding) => ({
      attribute: finding.attribute,
      valueDigest: createHmac('sha256', key)
        .update(finding.attribute)
        .update('\0')
        .update(finding.value)
        .digest('hex'),
    }));
  }

  private async readRange(s3Bucket: string, s3Key: string, range: string): Promise<RangeRead> {
    const out = await this.s3.client.send(
      new GetObjectCommand({ Bucket: s3Bucket, Key: s3Key, Range: range }),
    );
    if (!out.Body) throw new Error('storage returned no body for a ranged read');
    const bytes = await out.Body.transformToByteArray();
    // `Content-Range: bytes 0-65535/526702`. Without it the total is
    // unknown and the header check cannot tell a prefix from a file.
    const total = /\/(\d+)$/.exec(out.ContentRange ?? '')?.[1];
    if (total === undefined) throw new Error('storage did not report the size of the object');
    return { bytes, totalSize: Number(total) };
  }
}

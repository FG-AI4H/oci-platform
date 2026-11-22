import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AuditEmitter } from '@oci/audit';
import { isWholeFileFinding } from '@oci/dicom';
import type {
  DatasetSlug,
  DicomFindingDecisionResult,
  DicomFindingsReview,
  DicomHeldDatasetList,
  RecordDicomFindingDecisionRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { AUDIT_EMITTER } from '../audit/audit.module.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { findingKey } from './dicom-index.repository.js';
import { DicomIndexService } from './dicom-index.service.js';
import { DicomReviewRepository, type UndecidedFindingRow } from './dicom-review.repository.js';

/** The queue is a page for a person, not an export. */
const MAX_DATASETS_LISTED = 200;
const MAX_FINDINGS_LISTED = 500;
const MAX_DECISIONS_LISTED = 20;
/** Stored files read side by side to show their values. */
const VALUE_READ_CONCURRENCY = 8;
/**
 * The longest value shown whole. A longer one is shown cut, is marked
 * as cut, and cannot be accepted: an operator cannot vouch for text
 * they did not see. No de-identified header field is this long.
 */
const MAX_VALUE_LENGTH = 1000;

/**
 * The operator's review of held DICOM files (ADR-0026, decision 2).
 *
 * A file whose header carries a value de-identification normally
 * removes is held. An operator looks at the findings of a dataset and
 * accepts them with a reason; a file is released when every one of its
 * findings is accepted. The platform does not clean files and never
 * rewrites a header.
 *
 * WHO: every method here is for operators only. The controller admits
 * the `admin` group and nobody else; until a separate operator role
 * exists, that is the rule, and an admin may decide on a dataset they
 * host themselves (ADR-0026).
 *
 * VALUES: the review screen shows the operator the values. They are
 * read from the stored files for that one response. They are never
 * written to the database, the audit trail or a log: those keep the
 * attribute, the keyed digest and counts.
 */
@Injectable()
export class DicomReviewService {
  private readonly logger = new Logger(DicomReviewService.name);

  constructor(
    @Inject(DicomReviewRepository) private readonly repo: DicomReviewRepository,
    @Inject(DicomIndexService) private readonly index: DicomIndexService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(AUDIT_EMITTER) private readonly audit: AuditEmitter,
  ) {}

  /** Datasets with held files, the most held first. */
  async listHeld(): Promise<DicomHeldDatasetList> {
    const rows = await this.repo.listHeldDatasets(MAX_DATASETS_LISTED);
    return {
      datasets: rows.map((row) => ({
        slug: row.slug,
        name: row.name,
        heldInstanceCount: row.held_instance_count,
        unreadableInstanceCount: row.unreadable_instance_count,
      })),
    };
  }

  /** The undecided findings of one dataset, with their values. */
  async review(slug: DatasetSlug): Promise<DicomFindingsReview> {
    const dataset = await this.requireDataset(slug);

    // Nothing is written here. A read must not be what makes a file
    // visible to other readers.
    const [counts, rows, decisions] = await Promise.all([
      this.repo.countHeld(dataset.id),
      this.repo.listUndecidedFindings({ datasetId: dataset.id, limit: MAX_FINDINGS_LISTED }),
      this.repo.listDecisions(dataset.id, MAX_DECISIONS_LISTED),
    ]);
    const values = await this.readValues(dataset.id, rows);

    return {
      datasetSlug: slug,
      datasetName: dataset.name,
      heldInstanceCount: counts.held_instance_count,
      unreadableInstanceCount: counts.unreadable_instance_count,
      totalFindings: rows[0]?.total ?? 0,
      findings: rows.map((row) => {
        const wholeFile = isWholeFileFinding(row.attribute);
        const value = values.get(findingKey(row.attribute, row.value_digest)) ?? null;
        const valueTruncated = value !== null && value.length > MAX_VALUE_LENGTH;
        return {
          attribute: row.attribute,
          valueDigest: row.value_digest,
          value: value === null ? null : value.slice(0, MAX_VALUE_LENGTH),
          valueTruncated,
          wholeFile,
          acceptable: wholeFile || (value !== null && !valueTruncated),
          instanceCount: row.instance_count,
          seriesCount: row.series_count,
        };
      }),
      decisions: decisions.map((decision) => ({
        id: decision.id,
        reason: decision.reason,
        decidedAt: decision.decided_at.toISOString(),
        acceptedFindingCount: decision.accepted_finding_count,
      })),
    };
  }

  /**
   * Accept findings of a dataset, with a reason. Releases every held
   * file whose findings are now all accepted, and writes one audit
   * event, in the same transaction.
   *
   * A finding with a value can only be accepted if the platform can
   * show that value now: it is read back from a stored file here, as
   * for the screen. An operator cannot accept what could not be shown,
   * whatever the screen let through.
   */
  async decide(args: {
    slug: DatasetSlug;
    body: RecordDicomFindingDecisionRequest;
    user: CognitoAccessTokenPayload;
  }): Promise<DicomFindingDecisionResult> {
    const dataset = await this.requireDataset(args.slug);
    const decidedById = cognitoSubAsUuid(args.user.sub);

    // The same finding named twice in one request is one finding.
    const findings = [
      ...new Map(
        args.body.findings.map((f) => [findingKey(f.attribute, f.valueDigest), f]),
      ).values(),
    ];

    const waiting = await this.repo.listUndecidedFindings({
      datasetId: dataset.id,
      limit: findings.length,
      only: findings,
    });
    const nothingWaiting = () =>
      new ConflictException(
        'none of these findings is waiting for a decision on this dataset; reload the review',
      );
    if (waiting.length === 0) throw nothingWaiting();

    const valued = waiting.filter((row) => !isWholeFileFinding(row.attribute));
    const values = await this.readValues(dataset.id, valued);
    const notShown = valued.filter((row) => {
      const value = values.get(findingKey(row.attribute, row.value_digest));
      return value === undefined || value.length > MAX_VALUE_LENGTH;
    });
    if (notShown.length > 0) {
      throw new UnprocessableEntityException({
        message:
          `${notShown.length} of the selected findings cannot be accepted: their value could not ` +
          'be read back from the stored file, or is too long to be shown whole. Nothing was recorded.',
        // Which ones, by attribute and digest. Never the value.
        findings: notShown.map((row) => ({
          attribute: row.attribute,
          valueDigest: row.value_digest,
        })),
      });
    }

    const recorded = await this.repo.recordDecision({
      datasetId: dataset.id,
      reason: args.body.reason,
      decidedById,
      findings: waiting.map((row) => ({ attribute: row.attribute, valueDigest: row.value_digest })),
      audit: this.audit,
      actorRoles: ((args.user['cognito:groups'] ?? []) as string[]).filter((g) => g === 'admin'),
      // Attribute, keyed digest and counts. Never a value.
      auditPayload: (decision) => ({
        datasetSlug: args.slug,
        decisionId: decision.decisionId,
        reason: args.body.reason,
        // Also covers the same values in files uploaded later.
        acceptedForDataset: decision.acceptedForDataset,
        // Covers the files held at this moment, and no other.
        acceptedOnFiles: decision.acceptedOnFiles,
        releasedInstanceCount: decision.releasedInstanceCount,
        stillHeldInstanceCount: decision.stillHeldInstanceCount,
      }),
    });
    const acceptedCount =
      (recorded?.acceptedForDataset.length ?? 0) + (recorded?.acceptedOnFiles.length ?? 0);
    if (!recorded || acceptedCount === 0) throw nothingWaiting();

    this.logger.log(
      `dicom-review dataset=${dataset.id} decision=${recorded.decisionId} accepted=${acceptedCount} released=${recorded.releasedInstanceCount} held=${recorded.stillHeldInstanceCount}`,
    );
    return {
      decisionId: recorded.decisionId,
      acceptedFindingCount: acceptedCount,
      releasedInstanceCount: recorded.releasedInstanceCount,
      stillHeldInstanceCount: recorded.stillHeldInstanceCount,
    };
  }

  /**
   * The values behind findings, read from one stored file each. Keyed
   * by `findingKey`. A finding whose file could not be read, or whose
   * value is no longer there, is simply absent from the answer.
   */
  private async readValues(
    datasetId: string,
    rows: readonly UndecidedFindingRow[],
  ): Promise<Map<string, string>> {
    // One stored file usually carries several of the findings: each
    // sample file is read once.
    const samples = new Map<string, { s3Bucket: string; s3Key: string }>();
    for (const row of rows) {
      samples.set(`${row.sample_s3_bucket}\n${row.sample_s3_key}`, {
        s3Bucket: row.sample_s3_bucket,
        s3Key: row.sample_s3_key,
      });
    }
    const values = new Map<string, string>();
    const queue = [...samples.values()];
    const worker = async () => {
      for (let sample = queue.pop(); sample !== undefined; sample = queue.pop()) {
        try {
          const found = await this.index.readFindingValues(sample.s3Bucket, sample.s3Key);
          for (const [key, value] of found) values.set(key, value);
        } catch {
          // Nothing about the file is logged but its dataset.
          this.logger.warn(`dicom-review dataset=${datasetId} a sample file could not be read`);
        }
      }
    };
    await Promise.all(Array.from({ length: VALUE_READ_CONCURRENCY }, worker));
    return values;
  }

  private async requireDataset(slug: DatasetSlug): Promise<{ id: string; name: string }> {
    const dataset = await this.catalog.findNameBySlug(slug);
    if (!dataset) throw new NotFoundException(`dataset "${slug}" not found`);
    return dataset;
  }
}

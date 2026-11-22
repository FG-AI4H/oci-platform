import { Inject, Injectable } from '@nestjs/common';
import type { AuditEmitter, AuditEventInput, AuditTransactionPort } from '@oci/audit';
import type { Prisma } from '@oci/database';
import { isWholeFileFinding } from '@oci/dicom';
import { PrismaService } from '../../prisma.service.js';
import {
  acceptForDataset,
  acceptOnHeldFiles,
  countHeld,
  listDecisions,
  listHeldDatasets,
  listUndecidedFindings,
  lockDatasetFindings,
  releaseCoveredObjects,
  type DecisionRow,
  type HeldCountsRow,
  type HeldDatasetRow,
  type UndecidedFindingRow,
} from './repositories/dicom-review.raw.js';

export type { DecisionRow, HeldCountsRow, HeldDatasetRow, UndecidedFindingRow };

export interface FindingRef {
  attribute: string;
  valueDigest: string;
}

export interface RecordedDecision {
  decisionId: string;
  /**
   * Findings with a value, accepted for the dataset: they also cover
   * the same value in files uploaded later. `instanceCount` is the
   * number of held files each was on when it was accepted.
   */
  acceptedForDataset: Array<FindingRef & { instanceCount: number }>;
  /**
   * Findings about a file as a whole, accepted on the `instanceCount`
   * files held at that moment and on no other.
   */
  acceptedOnFiles: Array<FindingRef & { instanceCount: number }>;
  releasedInstanceCount: number;
  stillHeldInstanceCount: number;
}

/** A decision is a few set operations over a dataset's findings. */
const DECISION_TIMEOUT_MS = 60_000;
const DECISION_MAX_WAIT_MS = 10_000;

/**
 * The operator's review of held DICOM files (ADR-0026, decision 2).
 * The only place that writes decisions. A file is released here, or by
 * the index when it stores a file whose findings are already accepted.
 */
@Injectable()
export class DicomReviewRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listHeldDatasets(limit: number): Promise<HeldDatasetRow[]> {
    return listHeldDatasets(this.prisma.client, limit);
  }

  countHeld(datasetId: string): Promise<HeldCountsRow> {
    return countHeld(this.prisma.client, datasetId);
  }

  listUndecidedFindings(args: {
    datasetId: string;
    limit: number;
    only?: readonly FindingRef[];
  }): Promise<UndecidedFindingRow[]> {
    return listUndecidedFindings(this.prisma.client, args);
  }

  listDecisions(datasetId: string, limit: number): Promise<DecisionRow[]> {
    return listDecisions(this.prisma.client, datasetId, limit);
  }

  /**
   * Record a decision and release the files it covers, in one
   * transaction with its audit event: either all of it happened and is
   * in the audit trail, or none of it did.
   *
   * Only what is an undecided finding of the dataset at that moment is
   * accepted; the rest of what was asked is left out. Returns null when
   * nothing of it is (another operator got there first, or the request
   * named values the dataset never showed): then nothing is written.
   */
  async recordDecision(args: {
    datasetId: string;
    reason: string;
    decidedById: string;
    findings: readonly FindingRef[];
    audit: AuditEmitter;
    auditEvent: (decision: RecordedDecision) => AuditEventInput;
  }): Promise<RecordedDecision | null> {
    return this.prisma.client.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // One decision at a time per dataset, and never while a file of
        // it is being indexed. See `lockDatasetFindings`.
        await lockDatasetFindings(tx, args.datasetId);

        const current = await listUndecidedFindings(tx, {
          datasetId: args.datasetId,
          limit: args.findings.length,
          only: args.findings,
        });
        if (current.length === 0) return null;
        const countOf = new Map(
          current.map((row) => [`${row.attribute}\n${row.value_digest}`, row.instance_count]),
        );
        const asRefs = (rows: Array<{ attribute: string; value_digest: string }>) =>
          rows.map((row) => ({ attribute: row.attribute, valueDigest: row.value_digest }));

        const decision = (await tx.dicomFindingDecision.create({
          data: { datasetId: args.datasetId, reason: args.reason, decidedById: args.decidedById },
          select: { id: true },
        })) as { id: string };

        const valued = asRefs(current.filter((row) => !isWholeFileFinding(row.attribute)));
        const wholeFile = asRefs(current.filter((row) => isWholeFileFinding(row.attribute)));

        const inserted =
          valued.length === 0
            ? []
            : await acceptForDataset(tx, {
                decisionId: decision.id,
                datasetId: args.datasetId,
                findings: valued,
              });
        const marked =
          wholeFile.length === 0
            ? []
            : await acceptOnHeldFiles(tx, {
                decisionId: decision.id,
                datasetId: args.datasetId,
                findings: wholeFile,
              });

        const releasedInstanceCount = await releaseCoveredObjects(tx, args.datasetId);
        const remaining = await countHeld(tx, args.datasetId);
        const recorded: RecordedDecision = {
          decisionId: decision.id,
          // What was written, not what was asked for.
          acceptedForDataset: inserted.map((row) => ({
            attribute: row.attribute,
            valueDigest: row.value_digest,
            instanceCount: countOf.get(`${row.attribute}\n${row.value_digest}`) ?? 0,
          })),
          acceptedOnFiles: marked.map((row) => ({
            attribute: row.attribute,
            valueDigest: row.value_digest,
            instanceCount: row.instance_count,
          })),
          releasedInstanceCount,
          stillHeldInstanceCount: remaining.held_instance_count,
        };
        // Same cast as the annotation module: the port is the insert only,
        // which Prisma's generated generic does not structurally match.
        await args.audit.emitSync(args.auditEvent(recorded), tx as unknown as AuditTransactionPort);
        return recorded;
      },
      { timeout: DECISION_TIMEOUT_MS, maxWait: DECISION_MAX_WAIT_MS },
    );
  }
}

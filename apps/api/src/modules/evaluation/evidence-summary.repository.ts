import { Inject, Injectable } from '@nestjs/common';
import type {
  EvaluationTaskKindDb,
  RouteReviewStatus,
  SubmissionMode,
  SubmissionStatus,
} from '@oci/shared-types';
import { PrismaService } from '../../prisma.service.js';

/**
 * One submission with what its evidence summary needs (#652).
 *
 * Note what is not here: the task's reference labels, the item-to-subgroup
 * map and the predictions. `itemCount` is the size of the reference set,
 * which the task page already publishes; the labels it is counted from never
 * leave `findSubmission`.
 */
export interface EvidenceSubmissionRow {
  id: string;
  methodName: string;
  mode: SubmissionMode;
  status: SubmissionStatus;
  /** Raw JSON as stored; parsed by the assembly with the shared coercion. */
  scores: unknown;
  /** Raw JSON as stored, already suppressed (ADR-0030). */
  subgroupScores: unknown;
  /** Decides who may read the summary; never part of it. */
  submittedBy: string | null;
  createdAt: Date;
  retractedAt: Date | null;
  routeVersionRef: {
    version: string;
    reviewStatus: RouteReviewStatus;
    reviewedAt: Date | null;
    reviewNotes: string | null;
    route: { slug: string; name: string; providerName: string | null; isReference: boolean };
  } | null;
  task: {
    slug: string;
    name: string;
    datasetSlug: string;
    taskKind: EvaluationTaskKindDb;
    numClasses: number;
    referableThreshold: number;
    positiveClassName: string | null;
    itemCount: number;
  };
}

/** An audit event of the submission, without its actor and payload. */
export interface EvidenceTraceRow {
  sequenceNumber: bigint;
  occurredAt: Date;
  module: string;
  action: string;
  payloadHash: string;
  previousHash: string | null;
  recordHash: string;
}

/** The subject type the evaluation module writes its submission events under (#653). */
export const SUBMISSION_AUDIT_SUBJECT = 'evaluation-submission';

/**
 * Reads for the evidence summary (#652). Read-only, and narrow on purpose:
 * each select names the columns the summary prints and nothing else.
 */
@Injectable()
export class EvidenceSummaryRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findSubmission(submissionId: string): Promise<EvidenceSubmissionRow | null> {
    const s = await this.prisma.client.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        methodName: true,
        mode: true,
        status: true,
        scores: true,
        subgroupScores: true,
        submittedBy: true,
        createdAt: true,
        retractedAt: true,
        routeVersionRef: {
          select: {
            version: true,
            reviewStatus: true,
            reviewedAt: true,
            reviewNotes: true,
            route: {
              select: { slug: true, name: true, providerName: true, isReference: true },
            },
          },
        },
        task: {
          select: {
            slug: true,
            name: true,
            datasetSlug: true,
            taskKind: true,
            numClasses: true,
            referableThreshold: true,
            positiveClassName: true,
            // Read only to be counted, as `findBySlugWithSubmissions` does:
            // the labels stay in this function's scope.
            groundTruth: true,
          },
        },
      },
    });
    if (!s) return null;
    return {
      id: s.id,
      methodName: s.methodName,
      mode: s.mode,
      status: s.status,
      scores: s.scores,
      subgroupScores: s.subgroupScores,
      submittedBy: s.submittedBy,
      createdAt: s.createdAt,
      retractedAt: s.retractedAt,
      routeVersionRef: s.routeVersionRef,
      task: {
        slug: s.task.slug,
        name: s.task.name,
        datasetSlug: s.task.datasetSlug,
        taskKind: s.task.taskKind,
        numClasses: s.task.numClasses,
        referableThreshold: s.task.referableThreshold,
        positiveClassName: s.task.positiveClassName,
        itemCount: Object.keys((s.task.groundTruth ?? {}) as Record<string, unknown>).length,
      },
    };
  }

  /**
   * The submission's audit events, oldest first, at most `limit + 1` so the
   * caller can tell a full list from a cut one. Actor and payload are not
   * selected: the summary shows what happened and its hashes, not who.
   */
  async findTrace(submissionId: string, limit: number): Promise<EvidenceTraceRow[]> {
    return this.prisma.client.auditEvent.findMany({
      where: { subjectType: SUBMISSION_AUDIT_SUBJECT, subjectId: submissionId },
      orderBy: { sequenceNumber: 'asc' },
      take: limit + 1,
      select: {
        sequenceNumber: true,
        occurredAt: true,
        module: true,
        action: true,
        payloadHash: true,
        previousHash: true,
        recordHash: true,
      },
    });
  }
}

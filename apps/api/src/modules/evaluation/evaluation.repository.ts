import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@oci/database';
import type { EvaluationScores, EvaluationTaskKindDb, SubmissionStatus } from '@oci/shared-types';
import { PrismaService } from '../../prisma.service.js';

/**
 * Row shapes returned to the service. Defined locally (same rationale as
 * the catalog repository): Prisma 7's default result types are conditional
 * generics that don't unwrap cleanly, so we map explicitly off the
 * select-narrowed results into these plain shapes. Ground truth is NEVER
 * part of a read-facing shape — only `findScoringContext` (server-side
 * scoring) reads it.
 */
export interface EvaluationTaskSummaryRow {
  id: string;
  slug: string;
  name: string;
  datasetSlug: string;
  taskKind: EvaluationTaskKindDb;
  submissionCount: number;
}

export interface SubmissionRow {
  id: string;
  methodName: string;
  status: SubmissionStatus;
  /** Raw JSON as stored; the service parses it into `EvaluationScores`. */
  scores: unknown;
  createdAt: Date;
}

export interface EvaluationTaskWithSubmissionsRow {
  id: string;
  slug: string;
  name: string;
  datasetSlug: string;
  taskKind: EvaluationTaskKindDb;
  numClasses: number;
  referableThreshold: number;
  createdAt: Date;
  updatedAt: Date;
  submissions: SubmissionRow[];
}

/** Server-side-only scoring context. Carries the HIDDEN ground truth. */
export interface EvaluationTaskScoringRow {
  id: string;
  numClasses: number;
  referableThreshold: number;
  groundTruth: Record<string, number>;
}

/**
 * Evaluation repository — Prisma queries for the `evaluation` schema
 * (`evaluation_tasks`, `submissions`). Sits below the service, which owns
 * authz, scoring, and DTO assembly.
 */
@Injectable()
export class EvaluationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Public list — task summaries + submission counts. No ground truth. */
  async listTasks(): Promise<EvaluationTaskSummaryRow[]> {
    const rows = await this.prisma.client.evaluationTask.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        name: true,
        datasetSlug: true,
        taskKind: true,
        _count: { select: { submissions: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      datasetSlug: r.datasetSlug,
      taskKind: r.taskKind,
      submissionCount: r._count.submissions,
    }));
  }

  /**
   * Task detail + its submissions (id, methodName, status, scores,
   * createdAt). No ground truth. Ordering is left to the service (best-QWK
   * first requires reading into the JSON `scores`).
   */
  async findBySlugWithSubmissions(slug: string): Promise<EvaluationTaskWithSubmissionsRow | null> {
    const t = await this.prisma.client.evaluationTask.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        datasetSlug: true,
        taskKind: true,
        numClasses: true,
        referableThreshold: true,
        createdAt: true,
        updatedAt: true,
        submissions: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            methodName: true,
            status: true,
            scores: true,
            createdAt: true,
          },
        },
      },
    });
    if (!t) return null;
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      datasetSlug: t.datasetSlug,
      taskKind: t.taskKind,
      numClasses: t.numClasses,
      referableThreshold: t.referableThreshold,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      submissions: t.submissions.map((s) => ({
        id: s.id,
        methodName: s.methodName,
        status: s.status,
        scores: s.scores,
        createdAt: s.createdAt,
      })),
    };
  }

  /**
   * Load the scoring context (incl. the HIDDEN ground truth) for a task.
   * Server-side use only — the result is never returned by a controller.
   */
  async findScoringContext(slug: string): Promise<EvaluationTaskScoringRow | null> {
    const t = await this.prisma.client.evaluationTask.findUnique({
      where: { slug },
      select: {
        id: true,
        numClasses: true,
        referableThreshold: true,
        groundTruth: true,
      },
    });
    if (!t) return null;
    return {
      id: t.id,
      numClasses: t.numClasses,
      referableThreshold: t.referableThreshold,
      groundTruth: t.groundTruth as unknown as Record<string, number>,
    };
  }

  async createTask(data: {
    slug: string;
    name: string;
    datasetSlug: string;
    taskKind: EvaluationTaskKindDb;
    numClasses: number;
    referableThreshold: number;
    groundTruth: Record<string, number>;
  }): Promise<{ id: string; slug: string }> {
    return this.prisma.client.evaluationTask.create({
      data: {
        slug: data.slug,
        name: data.name,
        datasetSlug: data.datasetSlug,
        taskKind: data.taskKind,
        numClasses: data.numClasses,
        referableThreshold: data.referableThreshold,
        groundTruth: data.groundTruth as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, slug: true },
    });
  }

  async createSubmission(data: {
    taskId: string;
    methodName: string;
    submittedBy: string | null;
    status: SubmissionStatus;
    scores: EvaluationScores | null;
    error: string | null;
  }): Promise<{ id: string }> {
    return this.prisma.client.submission.create({
      data: {
        taskId: data.taskId,
        methodName: data.methodName,
        submittedBy: data.submittedBy,
        mode: 'PREDICTIONS',
        status: data.status,
        error: data.error,
        // Omit `scores` entirely when null so the column stays SQL NULL
        // (avoids the DbNull / JsonNull distinction on a nullable Json col).
        ...(data.scores !== null
          ? { scores: data.scores as unknown as Prisma.InputJsonValue }
          : {}),
      },
      select: { id: true },
    });
  }
}

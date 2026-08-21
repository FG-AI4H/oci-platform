import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@oci/database';
import type {
  EvaluationTaskKindDb,
  TaskKindScores,
  SubmissionMode,
  SubmissionStatus,
} from '@oci/shared-types';
import type { RouteReviewStatus } from '@oci/shared-types';
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
  /** Raw JSON as stored; the service parses it into `TaskKindScores`. */
  scores: unknown;
  createdAt: Date;
  /** Set when the producing route version was later REJECTED/WITHDRAWN (WP9). */
  retractedAt: Date | null;
  /**
   * The route version that produced this score (WP5). Null for rows scored
   * before the registry existed — those are labelled LEGACY at the read
   * boundary, never backfilled.
   */
  routeVersionRef: {
    version: string;
    reviewStatus: RouteReviewStatus;
    route: { slug: string };
  } | null;
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
  /**
   * The ground-truth map's KEYS only, sorted (#441). Note what this interface
   * still does not have: a field for a label. The projection happens inside
   * `findBySlugWithSubmissions`, so the labels never reach the service even
   * though the read path now touches the column — same structural control as
   * `EvaluationTaskItemIdsRow`.
   */
  itemIds: string[];
  submissions: SubmissionRow[];
}

/** Server-side-only scoring context. Carries the HIDDEN ground truth. */
export interface EvaluationTaskScoringRow {
  id: string;
  /** Which scoring family to dispatch to (ADR-0020). */
  taskKind: EvaluationTaskKindDb;
  numClasses: number;
  referableThreshold: number;
  groundTruth: Record<string, number>;
}

/**
 * Identity of a task, with NO ground truth attached. Used by the CONTAINER
 * dispatch path, which resolves the task only to bind the submission and name
 * the dataset mount — it must never load hidden labels it has no use for.
 */
export interface EvaluationTaskRefRow {
  id: string;
  slug: string;
}

/**
 * A task's item-ID key set + its public metric config, with NO labels attached.
 * Used by the VALIDATION path (WP6), which reports which submitted IDs a task
 * does not recognise and must not be able to see a label — see the boundary note
 * in `submission-validation.ts`.
 */
export interface EvaluationTaskItemIdsRow {
  id: string;
  slug: string;
  numClasses: number;
  /** The ground-truth map's KEYS only. The same set a run is given as
   *  `/input/index.json`, so it is not secret. */
  itemIds: string[];
}

/**
 * What the result outbox needs to decide accept / replay / reject for one
 * submission. No ground truth: the predictions branch loads the scoring context
 * separately, and only after the idempotency and route checks have passed.
 */
export interface SubmissionResultContextRow {
  id: string;
  taskId: string;
  mode: SubmissionMode;
  status: SubmissionStatus;
  /** Route version pinned at dispatch. Null until WP5 populates it. */
  routeVersion: string | null;
  /** Fingerprint of the already-applied result, if any. */
  resultFingerprint: string | null;
  /** Classified failure code of the already-applied result, if any. */
  failureCode: string | null;
  /** Raw JSON as stored; the service parses it into `TaskKindScores`. */
  scores: unknown;
}

/** Values the outbox writes when it applies a result. */
export interface SubmissionResultUpdate {
  status: SubmissionStatus;
  scores: TaskKindScores | null;
  /** PARTICIPANT-FACING text only — never the worker's operator detail. */
  error: string | null;
  failureCode: string | null;
  durationMs: number | null;
  resultFingerprint: string | null;
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
   *
   * `groundTruth` IS selected here, and is reduced to its key set before this
   * method returns (#441) — the same move `findTaskItemIds` makes for the
   * validation path. Selecting the column to take `Object.keys` of it reads the
   * whole JSONB; at task sizes the challenge actually runs (tens to low
   * thousands of items) that is cheaper than a second round trip, and pushing
   * the projection into SQL via `jsonb_object_keys` would need a raw query,
   * which CLAUDE.md confines to `*.raw.ts`.
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
        groundTruth: true,
        submissions: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            methodName: true,
            status: true,
            scores: true,
            createdAt: true,
            retractedAt: true,
            // Narrow on purpose: the route's slug/version/status is all the
            // read boundary needs. Declarations are fetched via the registry
            // endpoints, not smuggled through every submission row.
            routeVersionRef: {
              select: {
                version: true,
                reviewStatus: true,
                route: { select: { slug: true } },
              },
            },
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
      // Sorted so the response is deterministic across reads: JSONB does not
      // preserve insertion order, and a key set that reshuffles between calls
      // is a poor thing to diff a predictions file against.
      itemIds: Object.keys((t.groundTruth ?? {}) as Record<string, unknown>).sort(),
      submissions: t.submissions.map((s) => ({
        id: s.id,
        methodName: s.methodName,
        status: s.status,
        scores: s.scores,
        createdAt: s.createdAt,
        retractedAt: s.retractedAt,
        routeVersionRef: s.routeVersionRef,
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
        taskKind: true,
        numClasses: true,
        referableThreshold: true,
        groundTruth: true,
      },
    });
    if (!t) return null;
    return {
      id: t.id,
      taskKind: t.taskKind,
      numClasses: t.numClasses,
      referableThreshold: t.referableThreshold,
      groundTruth: t.groundTruth as unknown as Record<string, number>,
    };
  }

  /**
   * Resolve a task by slug WITHOUT its ground truth — the CONTAINER dispatch
   * path's only read. Keeping it separate from `findScoringContext` means the
   * dispatcher physically cannot hold hidden labels.
   */
  async findTaskRefBySlug(slug: string): Promise<EvaluationTaskRefRow | null> {
    const t = await this.prisma.client.evaluationTask.findUnique({
      where: { slug },
      select: { id: true, slug: true },
    });
    if (!t) return null;
    return { id: t.id, slug: t.slug };
  }

  /**
   * The task's item-ID key set (+ its public metric config) for the VALIDATION
   * path. Never returns a label.
   *
   * `ground_truth` is a JSONB map and Prisma cannot project a JSON object's keys
   * server-side, so the map is read and then narrowed to `Object.keys(...)`
   * before this method returns. The labels therefore exist only inside this
   * function's local scope, and `EvaluationTaskItemIdsRow` has no field that
   * could carry them out — the same structural guarantee as `findTaskRefBySlug`
   * not loading ground truth at all.
   *
   * (A raw `jsonb_object_keys` projection would avoid materialising the labels
   * in the API process at all. That needs a `*.raw.ts` file per the repository
   * convention and there is no DB to verify it against here; noted as a
   * follow-up rather than guessed at.)
   */
  async findTaskItemIds(slug: string): Promise<EvaluationTaskItemIdsRow | null> {
    const t = await this.prisma.client.evaluationTask.findUnique({
      where: { slug },
      select: { id: true, slug: true, numClasses: true, groundTruth: true },
    });
    if (!t) return null;
    return {
      id: t.id,
      slug: t.slug,
      numClasses: t.numClasses,
      itemIds: Object.keys((t.groundTruth ?? {}) as Record<string, unknown>),
    };
  }

  /**
   * Count one participant's SCORED-intent submissions against one task, for the
   * quota gate (WP6). `since` bounds it to the current calendar week; omitting
   * it counts the task lifetime.
   *
   * Every status counts — PENDING, SCORED and FAILED alike. A scored submission
   * consumes a host evaluation slot and an oracle query the moment it is
   * accepted, whatever its outcome; and refunding FAILED rows would make cheap
   * deliberate failures a way around the cap. Validation submissions are the
   * free debugging path, and they write no row here at all.
   *
   * Backed by `@@index([taskId, submittedBy, createdAt])`, whose prefix serves
   * the unbounded variant too.
   */
  async countScoredSubmissionsForParticipant(args: {
    taskId: string;
    submittedBy: string;
    since?: Date;
  }): Promise<number> {
    return this.prisma.client.submission.count({
      where: {
        taskId: args.taskId,
        submittedBy: args.submittedBy,
        ...(args.since ? { createdAt: { gte: args.since } } : {}),
      },
    });
  }

  /**
   * Load the scoring context (incl. the HIDDEN ground truth) for the task a
   * submission belongs to. Server-side use only, and called only on the outbox
   * `predictions` branch — the `metrics` branch never touches ground truth
   * because the host already scored against its own labels.
   */
  async findScoringContextBySubmissionId(
    submissionId: string,
  ): Promise<EvaluationTaskScoringRow | null> {
    const s = await this.prisma.client.submission.findUnique({
      where: { id: submissionId },
      select: {
        task: {
          select: {
            id: true,
            taskKind: true,
            numClasses: true,
            referableThreshold: true,
            groundTruth: true,
          },
        },
      },
    });
    if (!s) return null;
    return {
      id: s.task.id,
      taskKind: s.task.taskKind,
      numClasses: s.task.numClasses,
      referableThreshold: s.task.referableThreshold,
      groundTruth: s.task.groundTruth as unknown as Record<string, number>,
    };
  }

  /** Outbox pre-flight state for one submission. Never carries ground truth. */
  async findSubmissionForResult(submissionId: string): Promise<SubmissionResultContextRow | null> {
    const s = await this.prisma.client.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        taskId: true,
        mode: true,
        status: true,
        routeVersion: true,
        resultFingerprint: true,
        failureCode: true,
        scores: true,
      },
    });
    if (!s) return null;
    return {
      id: s.id,
      taskId: s.taskId,
      mode: s.mode,
      status: s.status,
      routeVersion: s.routeVersion,
      resultFingerprint: s.resultFingerprint,
      failureCode: s.failureCode,
      scores: s.scores,
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
    scores: TaskKindScores | null;
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

  /**
   * Insert a PENDING sealed-run (Mode 2) submission. Distinct from
   * `createSubmission` (which hard-codes `PREDICTIONS` and writes a terminal
   * row) because this one is the *dispatch record*: it exists so the result
   * that arrives later can be correlated back to the image that produced it.
   */
  async createContainerSubmission(data: {
    taskId: string;
    methodName: string;
    submittedBy: string | null;
    imageRef: string;
    imageDigest: string;
    routeId: string | null;
    routeVersion: string | null;
  }): Promise<{ id: string }> {
    return this.prisma.client.submission.create({
      data: {
        taskId: data.taskId,
        methodName: data.methodName,
        submittedBy: data.submittedBy,
        mode: 'CONTAINER',
        status: 'PENDING',
        imageRef: data.imageRef,
        imageDigest: data.imageDigest,
        routeId: data.routeId,
        routeVersion: data.routeVersion,
      },
      select: { id: true },
    });
  }

  /**
   * Apply an outbox result, **conditionally on the submission still being
   * PENDING**. This single predicated UPDATE is the idempotency guard: two
   * concurrent POSTs for the same submission cannot both win it, so a result
   * can be applied — and a score written — at most once. Returns the number of
   * rows actually updated; `0` means someone else got there first (or the row
   * is gone), and the caller re-reads to decide replay (200) vs conflict (409).
   */
  async applyResult(submissionId: string, data: SubmissionResultUpdate): Promise<number> {
    const res = await this.prisma.client.submission.updateMany({
      where: { id: submissionId, status: 'PENDING' },
      data: {
        status: data.status,
        error: data.error,
        failureCode: data.failureCode,
        durationMs: data.durationMs,
        resultFingerprint: data.resultFingerprint,
        resultReceivedAt: new Date(),
        // Omit `scores` when null so the column stays SQL NULL (same
        // DbNull / JsonNull sidestep as `createSubmission`).
        ...(data.scores !== null
          ? { scores: data.scores as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    return res.count;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@oci/database';
import type {
  EvaluationTaskKindDb,
  TaskKindScores,
  SubmissionMode,
  SubmissionStatus,
} from '@oci/shared-types';
import type { RouteReviewStatus, SubgroupField, SubgroupResults } from '@oci/shared-types';
import { parseSubgroupConfig, parseSubgroupFields } from './subgroup-config.js';
import type { SubgroupConfig } from './subgroup-scoring.js';
import { PrismaService } from '../../prisma.service.js';
import { SCORED_QUOTA_EXEMPT } from './submission-quota.js';

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

/**
 * One submission with the task context its page needs. Carries `submittedBy`
 * and `error`, which the list row deliberately does not: they are what the
 * service's visibility rule is decided on, and never leave it unconditionally.
 */
export interface SubmissionDetailRow extends SubmissionRow {
  mode: SubmissionMode;
  /** Raw JSON as stored, already suppressed; the service parses it (#410). */
  subgroupScores: unknown;
  /** Participant-facing failure text. Set only when FAILED. */
  error: string | null;
  /** Null for a row created without an identified participant. */
  submittedBy: string | null;
  task: {
    slug: string;
    name: string;
    datasetSlug: string;
    taskKind: EvaluationTaskKindDb;
    numClasses: number;
    referableThreshold: number;
    /** `BINARY_DIAGNOSTIC` only: label 1 in words. Public configuration. */
    positiveClassName: string | null;
  };
}

export interface EvaluationTaskWithSubmissionsRow {
  id: string;
  slug: string;
  name: string;
  datasetSlug: string;
  taskKind: EvaluationTaskKindDb;
  numClasses: number;
  referableThreshold: number;
  /** `BINARY_DIAGNOSTIC` only: label 1 in words. Public configuration. */
  positiveClassName: string | null;
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
  /** The declared subgroup fields (#410). Public; the item map is not read here. */
  subgroupFields: SubgroupField[];
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
  /**
   * Subgroup declaration and item map (#410), null when the task declares no
   * field. Server-side only, like the ground truth it sits beside.
   */
  subgroups: SubgroupConfig | null;
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
  /** Public: decides the label range and whether a score is accepted. */
  taskKind: EvaluationTaskKindDb;
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
  /** Results by subgroup, already suppressed (#410). Null when none. */
  subgroupScores: SubgroupResults | null;
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
        positiveClassName: true,
        createdAt: true,
        updatedAt: true,
        groundTruth: true,
        subgroupFields: true,
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
      positiveClassName: t.positiveClassName,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      // Sorted so the response is deterministic across reads: JSONB does not
      // preserve insertion order, and a key set that reshuffles between calls
      // is a poor thing to diff a predictions file against.
      itemIds: Object.keys((t.groundTruth ?? {}) as Record<string, unknown>).sort(),
      subgroupFields: parseSubgroupFields(t.subgroupFields),
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
        subgroupFields: true,
        subgroupValues: true,
      },
    });
    if (!t) return null;
    return {
      id: t.id,
      taskKind: t.taskKind,
      numClasses: t.numClasses,
      referableThreshold: t.referableThreshold,
      groundTruth: t.groundTruth as unknown as Record<string, number>,
      subgroups: parseSubgroupConfig(
        t.subgroupFields,
        t.subgroupValues,
        Object.keys(t.groundTruth as Record<string, unknown>),
      ),
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
      select: { id: true, slug: true, taskKind: true, numClasses: true, groundTruth: true },
    });
    if (!t) return null;
    return {
      id: t.id,
      slug: t.slug,
      taskKind: t.taskKind,
      numClasses: t.numClasses,
      itemIds: Object.keys((t.groundTruth ?? {}) as Record<string, unknown>),
    };
  }

  /**
   * Count one participant's SCORED-intent submissions against one task, for the
   * quota gate (WP6). `since` bounds it to the current calendar week; omitting
   * it counts the task lifetime.
   *
   * Every row counts except a predictions file refused before scoring
   * (`SCORED_QUOTA_EXEMPT`, #645): it never met the reference labels, so it used
   * no evaluation slot and no oracle query. A sealed run counts whatever its
   * outcome — it holds a host slot from the moment it is accepted, and refunding
   * a failed one would make deliberate failures a way around the cap. The full
   * reasoning is on `consumesScoredQuota`. Validation submissions write no row
   * here at all.
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
        NOT: { mode: SCORED_QUOTA_EXEMPT.mode, status: SCORED_QUOTA_EXEMPT.status },
        ...(args.since ? { createdAt: { gte: args.since } } : {}),
      },
    });
  }

  /**
   * One submission of one task, with what its own page shows (#645).
   *
   * Matched on the task slug as well as the id, so an id is only ever answered
   * under the task it belongs to. `submittedBy`, `error` and `failureCode` ARE
   * read here, unlike in the list query: the service needs the first to decide
   * who may see a FAILED row and returns the second only to them. No ground
   * truth is selected.
   */
  async findSubmissionDetail(
    taskSlug: string,
    submissionId: string,
  ): Promise<SubmissionDetailRow | null> {
    const s = await this.prisma.client.submission.findFirst({
      where: { id: submissionId, task: { slug: taskSlug } },
      select: {
        id: true,
        methodName: true,
        mode: true,
        status: true,
        scores: true,
        subgroupScores: true,
        error: true,
        submittedBy: true,
        createdAt: true,
        retractedAt: true,
        routeVersionRef: {
          select: { version: true, reviewStatus: true, route: { select: { slug: true } } },
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
      error: s.error,
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
      },
    };
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
            subgroupFields: true,
            subgroupValues: true,
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
      subgroups: parseSubgroupConfig(
        s.task.subgroupFields,
        s.task.subgroupValues,
        Object.keys(s.task.groundTruth as Record<string, unknown>),
      ),
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
    positiveClassName: string | null;
    groundTruth: Record<string, number>;
    /** Subgroup declaration and item map (#410), already validated. */
    subgroups: SubgroupConfig | null;
  }): Promise<{ id: string; slug: string }> {
    return this.prisma.client.evaluationTask.create({
      data: {
        slug: data.slug,
        name: data.name,
        datasetSlug: data.datasetSlug,
        taskKind: data.taskKind,
        numClasses: data.numClasses,
        referableThreshold: data.referableThreshold,
        positiveClassName: data.positiveClassName,
        groundTruth: data.groundTruth as unknown as Prisma.InputJsonValue,
        // Absent rather than `[]` / NULL when none: the column defaults are
        // exactly "no subgroup field".
        ...(data.subgroups !== null
          ? {
              subgroupFields: data.subgroups.fields as unknown as Prisma.InputJsonValue,
              subgroupValues: data.subgroups.values as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
      select: { id: true, slug: true },
    });
  }

  /**
   * The reference route version for a mode (WP5 §5). Used to attribute every
   * new submission: invariant 1 requires a SCORED row to carry a route, and a
   * row created after the registry exists is not "legacy" — it just needs
   * attributing. Returns null only if the seed is missing, which is a
   * deployment fault rather than a normal state.
   */
  async findReferenceRouteVersionForMode(mode: 'PREDICTIONS' | 'CONTAINER' | 'ENCRYPTED'): Promise<{
    routeId: string;
    routeSlug: string;
    versionId: string;
    version: string;
    reviewStatus: string;
  } | null> {
    const route = await this.prisma.client.evaluationRoute.findFirst({
      where: { mode, isReference: true },
      select: {
        id: true,
        slug: true,
        versions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, version: true, reviewStatus: true },
        },
      },
    });
    const v = route?.versions.at(0);
    if (!route || !v) return null;
    return {
      routeId: route.id,
      routeSlug: route.slug,
      versionId: v.id,
      version: v.version,
      reviewStatus: v.reviewStatus,
    };
  }

  /**
   * Find the submission already created for an external front-door entry.
   *
   * Backs seam-intake idempotency: an EvalAI submission pk identifies one
   * entry, so a retried POST must return what already exists rather than
   * create a second row and spend a second scored slot.
   */
  async findByExternalRef(ref: {
    externalChallengeId: string;
    externalSubmissionId: string;
  }): Promise<{
    id: string;
    routeSlug: string | null;
    routeVersion: string | null;
    reviewStatus: string | null;
  } | null> {
    const row = await this.prisma.client.submission.findUnique({
      where: {
        externalChallengeId_externalSubmissionId: {
          externalChallengeId: ref.externalChallengeId,
          externalSubmissionId: ref.externalSubmissionId,
        },
      },
      // Same narrow route projection as the read boundary: the response only
      // needs slug/version/status, and the attribution must come from the
      // STORED route rather than being recomputed, or a replay could answer
      // with a different route than the one that actually scored the entry.
      select: {
        id: true,
        routeVersionRef: {
          select: { version: true, reviewStatus: true, route: { select: { slug: true } } },
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      routeSlug: row.routeVersionRef?.route.slug ?? null,
      routeVersion: row.routeVersionRef?.version ?? null,
      reviewStatus: row.routeVersionRef?.reviewStatus ?? null,
    };
  }

  async createSubmission(data: {
    taskId: string;
    methodName: string;
    submittedBy: string | null;
    status: SubmissionStatus;
    scores: TaskKindScores | null;
    /** Results by subgroup, already suppressed (#410). Omitted or null when none. */
    subgroupScores?: SubgroupResults | null;
    error: string | null;
    /** Route attribution (WP5 invariant 1). Null only for rows that predate it. */
    routeId?: string | null;
    routeVersion?: string | null;
    routeVersionId?: string | null;
    /** EvalAI seam provenance (WP4 §4). Null for direct OCI submissions. */
    externalSubmissionId?: string | null;
    externalChallengeId?: string | null;
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
        ...(data.subgroupScores
          ? { subgroupScores: data.subgroupScores as unknown as Prisma.InputJsonValue }
          : {}),
        routeId: data.routeId ?? null,
        routeVersion: data.routeVersion ?? null,
        routeVersionId: data.routeVersionId ?? null,
        externalSubmissionId: data.externalSubmissionId ?? null,
        externalChallengeId: data.externalChallengeId ?? null,
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
        ...(data.subgroupScores !== null
          ? { subgroupScores: data.subgroupScores as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    return res.count;
  }
}

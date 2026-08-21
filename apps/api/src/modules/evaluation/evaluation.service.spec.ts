import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EvaluationTaskDetailSchema,
  SealedRunMessageSchema,
  type SubmitContainerRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvalQueueProvider } from './eval-queue.js';
import type { EvaluationRepository } from './evaluation.repository.js';
import { EvaluationService } from './evaluation.service.js';
import { scoreSubmission } from './scoring.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const SUBMISSION_ID = '22222222-2222-4222-8222-222222222222';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const IMAGE_REF = `601883093460.dkr.ecr.eu-central-1.amazonaws.com/participant/model@${DIGEST}`;

/** The task's HIDDEN ground truth. Must never appear in a response. */
const GROUND_TRUTH = { idrid_01: 0, idrid_02: 1, idrid_03: 3, idrid_04: 4 };

function containerBody(over: Partial<SubmitContainerRequest> = {}): SubmitContainerRequest {
  return {
    methodName: 'acme-dr-grader',
    mode: 'CONTAINER',
    intent: 'SCORED',
    imageRef: IMAGE_REF,
    imageDigest: DIGEST,
    ...over,
  };
}

/**
 * WP6: a SCORED submission must be attributed to an identified participant —
 * an anonymous quota is not a quota. These legacy tests assert scoring
 * behaviour, so they submit as an identified participant.
 */
const PARTICIPANT = { sub: 'participant-sub' } as unknown as CognitoAccessTokenPayload;

interface RepoMock {
  findScoringContext: ReturnType<typeof vi.fn>;
  findReferenceRouteVersionForMode: ReturnType<typeof vi.fn>;
  countScoredSubmissionsForParticipant: ReturnType<typeof vi.fn>;
  findTaskRefBySlug: ReturnType<typeof vi.fn>;
  findBySlugWithSubmissions: ReturnType<typeof vi.fn>;
  createSubmission: ReturnType<typeof vi.fn>;
  createContainerSubmission: ReturnType<typeof vi.fn>;
  applyResult: ReturnType<typeof vi.fn>;
}

interface QueueMock {
  missingConfig: ReturnType<typeof vi.fn>;
  callbackUrlFor: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  runTimeoutSec: number;
}

let repo: RepoMock;
let queue: QueueMock;
let service: EvaluationService;

beforeEach(() => {
  repo = {
    findScoringContext: vi.fn(),
    // WP5 invariant 1: every new scored row is attributed to the reference
    // route. DECLARED, matching the seed — nothing self-approves.
    findReferenceRouteVersionForMode: vi.fn().mockResolvedValue({
      routeId: 'ref-route',
      routeSlug: 'oci-predictions-scoring',
      versionId: 'ref-version',
      version: '1.0.0',
      reviewStatus: 'DECLARED',
    }),
    // WP6: scored submissions are quota-counted per participant. Default to an
    // unused quota so the pre-WP6 behavioural assertions below stay the subject.
    countScoredSubmissionsForParticipant: vi.fn().mockResolvedValue(0),
    findTaskRefBySlug: vi.fn(),
    findBySlugWithSubmissions: vi.fn(),
    createSubmission: vi.fn(),
    createContainerSubmission: vi.fn(),
    applyResult: vi.fn().mockResolvedValue(1),
  };
  queue = {
    missingConfig: vi.fn().mockReturnValue([]),
    callbackUrlFor: vi
      .fn()
      .mockImplementation((id: string) => `https://dev.oci.ai4h.net/v2/submissions/${id}/result`),
    publish: vi.fn().mockResolvedValue(undefined),
    runTimeoutSec: 1800,
  };
  service = new EvaluationService(
    repo as unknown as EvaluationRepository,
    queue as unknown as EvalQueueProvider,
  );
});

// ---------------------------------------------------------------------------
// WP10 / ADR-0020: the service dispatches on the TASK's scoring family, so a
// nominal task is scored with nominal metrics rather than ordinal-agreement
// ones. Without this the whole registry is unreachable — a CLASSIFICATION task
// would silently be scored as if its labels were a severity scale.
// ---------------------------------------------------------------------------

describe('EvaluationService.submitPredictions — CLASSIFICATION dispatch', () => {
  // Three nominal classes, four items. Predictions get item 3 wrong.
  const NOMINAL_GT = { s1: 0, s2: 1, s3: 2, s4: 1 };

  beforeEach(() => {
    repo.findScoringContext.mockResolvedValue({
      id: TASK_ID,
      taskKind: 'CLASSIFICATION' as const,
      numClasses: 3,
      referableThreshold: 2,
      groundTruth: NOMINAL_GT,
    });
    repo.createSubmission.mockResolvedValue({ id: SUBMISSION_ID });
  });

  it('returns CLASSIFICATION metrics, not the ordinal set', async () => {
    const out = await service.submitPredictions(
      'nominal-task',
      {
        methodName: 'nominal-baseline',
        intent: 'SCORED',
        predictions: [
          { imageId: 's1', grade: 0 },
          { imageId: 's2', grade: 1 },
          { imageId: 's3', grade: 0 },
          { imageId: 's4', grade: 1 },
        ],
      },
      PARTICIPANT,
    );

    expect(out.scores.kind).toBe('CLASSIFICATION');
    if (out.scores.kind !== 'CLASSIFICATION') throw new Error('wrong kind');

    // 3 of 4 correct; s3 (true 2) predicted 0.
    expect(out.scores.metrics.accuracy).toBeCloseTo(0.75, 4);
    expect(out.scores.metrics.perClass).toHaveLength(3);
    // No ordinal agreement metric exists on this shape at all.
    expect('qwk' in out.scores.metrics).toBe(false);
    expect(repo.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SCORED', error: null }),
    );
  });

  it('persists the scores envelope, not bare metrics', async () => {
    await service.submitPredictions(
      'nominal-task',
      {
        methodName: 'nominal-baseline',
        intent: 'SCORED',
        predictions: [{ imageId: 's1', grade: 0 }],
      },
      PARTICIPANT,
    );

    const persisted = repo.createSubmission.mock.calls[0]?.[0] as { scores?: { kind?: string } };
    // The kind must reach the database: a stored metric set that does not say
    // which family produced it cannot be rendered or compared later.
    expect(persisted.scores?.kind).toBe('CLASSIFICATION');
  });

  it('fails the submission when a label is outside the task class range', async () => {
    // numClasses = 3, so grade 7 is not a class this task has.
    const out = await service
      .submitPredictions(
        'nominal-task',
        {
          methodName: 'nominal-baseline',
          intent: 'SCORED',
          predictions: [{ imageId: 's1', grade: 7 }],
        },
        PARTICIPANT,
      )
      .catch((err: unknown) => err);

    // Same contract as the grading path: a bad label is a FAILED submission
    // plus a 4xx, never a partially-scored row.
    expect(out).toBeInstanceOf(BadRequestException);
    expect(repo.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FAILED', scores: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// Mode 1 regression. This path is live on dev; it must behave exactly as it
// did before the CONTAINER branch was added.
// ---------------------------------------------------------------------------

describe('EvaluationService.submitPredictions (Mode 1 — unchanged)', () => {
  beforeEach(() => {
    repo.findScoringContext.mockResolvedValue({
      id: TASK_ID,
      taskKind: 'GRADING' as const,
      numClasses: 5,
      referableThreshold: 2,
      groundTruth: GROUND_TRUTH,
    });
    repo.createSubmission.mockResolvedValue({ id: SUBMISSION_ID });
  });

  it('scores in-process against the hidden ground truth and persists SCORED', async () => {
    const out = await service.submitPredictions(
      'idrid-grading-demo',
      {
        methodName: 'baseline',
        intent: 'SCORED',
        predictions: [
          { imageId: 'idrid_01', grade: 0 },
          { imageId: 'idrid_02', grade: 1 },
          { imageId: 'idrid_03', grade: 3 },
          { imageId: 'idrid_04', grade: 4 },
        ],
      },
      PARTICIPANT,
    );

    const expected = scoreSubmission({
      groundTruth: GROUND_TRUTH,
      predictions: { idrid_01: 0, idrid_02: 1, idrid_03: 3, idrid_04: 4 },
      numClasses: 5,
      referableThreshold: 2,
    });

    // The registry wraps the same GRADING numbers in the ADR-0020 envelope;
    // `expected` is still computed by the ADR-0017 scorer directly, so this
    // also asserts the delegation produces identical metrics.
    expect(out).toEqual({ id: SUBMISSION_ID, scores: { kind: 'GRADING', metrics: expected } });
    expect(repo.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: TASK_ID, status: 'SCORED', error: null }),
    );
    // Mode 1 never enqueues.
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('404s on an unknown task without writing anything', async () => {
    repo.findScoringContext.mockResolvedValue(null);

    await expect(
      service.submitPredictions(
        'nope',
        {
          methodName: 'baseline',
          intent: 'SCORED',
          predictions: [{ imageId: 'idrid_01', grade: 0 }],
        },
        PARTICIPANT,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.createSubmission).not.toHaveBeenCalled();
  });

  it('persists FAILED + 400s on a duplicate imageId', async () => {
    await expect(
      service.submitPredictions(
        'idrid-grading-demo',
        {
          methodName: 'baseline',
          intent: 'SCORED',
          predictions: [
            { imageId: 'idrid_01', grade: 0 },
            { imageId: 'idrid_01', grade: 2 },
          ],
        },
        PARTICIPANT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repo.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FAILED', scores: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// Mode 2 dispatch.
// ---------------------------------------------------------------------------

describe('EvaluationService.submitContainer (Mode 2 — dispatch)', () => {
  beforeEach(() => {
    repo.findTaskRefBySlug.mockResolvedValue({ id: TASK_ID, slug: 'idrid-grading-demo' });
    repo.createContainerSubmission.mockResolvedValue({ id: SUBMISSION_ID });
  });

  it('persists PENDING + CONTAINER and enqueues a contract-valid message', async () => {
    const user = { sub: 'cognito-sub-1' } as unknown as CognitoAccessTokenPayload;

    const out = await service.submitContainer('idrid-grading-demo', containerBody(), user);

    expect(out).toEqual({ id: SUBMISSION_ID, status: 'PENDING' });

    // The dispatch record carries what the later result needs to be correlated.
    expect(repo.createContainerSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK_ID,
        methodName: 'acme-dr-grader',
        imageRef: IMAGE_REF,
        imageDigest: DIGEST,
        routeId: null,
        routeVersion: null,
      }),
    );
    // Nothing was scored, and the hidden ground truth was never loaded.
    expect(repo.createSubmission).not.toHaveBeenCalled();
    expect(repo.findScoringContext).not.toHaveBeenCalled();

    expect(queue.publish).toHaveBeenCalledTimes(1);
    const message: unknown = queue.publish.mock.calls[0]?.[0];
    const parsed = SealedRunMessageSchema.safeParse(message);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.submissionId).toBe(SUBMISSION_ID);
    expect(parsed.data.taskSlug).toBe('idrid-grading-demo');
    expect(parsed.data.imageRef).toBe(IMAGE_REF);
    expect(parsed.data.imageDigest).toBe(DIGEST);
    expect(parsed.data.timeoutSec).toBe(1800);
    expect(parsed.data.callbackUrl).toBe(
      `https://dev.oci.ai4h.net/v2/submissions/${SUBMISSION_ID}/result`,
    );
    expect(Date.parse(parsed.data.deadline)).toBeGreaterThan(Date.now());
    // The queue message must not carry ground truth or anything derived from it.
    expect(JSON.stringify(parsed.data)).not.toContain('idrid_01');
  });

  it('404s on an unknown task before touching the queue', async () => {
    repo.findTaskRefBySlug.mockResolvedValue(null);

    await expect(
      service.submitContainer('nope', containerBody(), PARTICIPANT),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.createContainerSubmission).not.toHaveBeenCalled();
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('503s when the queue is not configured — and writes no PENDING row', async () => {
    queue.missingConfig.mockReturnValue(['OCI_EVAL_QUEUE_URL']);

    await expect(
      service.submitContainer('idrid-grading-demo', containerBody(), PARTICIPANT),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.createContainerSubmission).not.toHaveBeenCalled();
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('400s when imageRef is not pinned to the submitted digest', async () => {
    const other = `sha256:${'b'.repeat(64)}`;

    await expect(
      service.submitContainer(
        'idrid-grading-demo',
        containerBody({ imageDigest: other }),
        PARTICIPANT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createContainerSubmission).not.toHaveBeenCalled();
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('marks the submission FAILED (INTERNAL_ERROR) when publishing throws', async () => {
    queue.publish.mockRejectedValue(new Error('AWS.SimpleQueueService.NonExistentQueue'));

    await expect(
      service.submitContainer('idrid-grading-demo', containerBody(), PARTICIPANT),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(repo.applyResult).toHaveBeenCalledWith(
      SUBMISSION_ID,
      expect.objectContaining({ status: 'FAILED', failureCode: 'INTERNAL_ERROR' }),
    );
  });
});

// ---------------------------------------------------------------------------
// #441: the task's item-ID key set is part of the public detail response.
//
// A Mode 1 participant keys `predictions.json` on these identifiers. Before
// this they were reachable only by reading the dataset's Croissant manifest and
// stripping the file extension, which nothing documented — so a guessed
// convention scored as coverage 0 and read as a bad model rather than as bad
// plumbing. The key set is not secret: every sealed run is handed the same set
// as `/input/index.json`.
//
// What must stay true is the other half of that boundary — the response carries
// keys and never a label.
// ---------------------------------------------------------------------------
describe('getTaskDetail — item IDs', () => {
  /** Deliberately unsorted, and non-contiguous like the real IDRiD slice. */
  const STORED_KEYS = ['IDRiD_101', 'IDRiD_001', 'IDRiD_018', 'IDRiD_003'];

  function detailRow(over: Record<string, unknown> = {}) {
    return {
      id: TASK_ID,
      slug: 'idrid-dr-grading',
      name: 'IDRiD — diabetic retinopathy severity grading (demo)',
      datasetSlug: 'idrid-grading-demo',
      taskKind: 'GRADING',
      numClasses: 5,
      referableThreshold: 2,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      itemIds: [...STORED_KEYS].sort(),
      submissions: [],
      ...over,
    };
  }

  it('returns every item ID, sorted, with a matching count', async () => {
    repo.findBySlugWithSubmissions.mockResolvedValue(detailRow());

    const detail = await service.getTaskDetail('idrid-dr-grading');

    expect(detail.itemIds).toEqual(['IDRiD_001', 'IDRiD_003', 'IDRiD_018', 'IDRiD_101']);
    expect(detail.itemCount).toBe(4);
  });

  it('reports itemCount 0 for a task with no items rather than omitting it', async () => {
    repo.findBySlugWithSubmissions.mockResolvedValue(detailRow({ itemIds: [] }));

    const detail = await service.getTaskDetail('empty-task');

    expect(detail.itemIds).toEqual([]);
    expect(detail.itemCount).toBe(0);
  });

  it('carries the keys and NO label — the response validates and contains no grade', async () => {
    repo.findBySlugWithSubmissions.mockResolvedValue(detailRow());

    const detail = await service.getTaskDetail('idrid-dr-grading');
    const parsed = EvaluationTaskDetailSchema.safeParse(detail);
    expect(parsed.success).toBe(true);

    // The structural guarantee: the row the service is handed has no field a
    // label could arrive in, so there is nothing to filter out here. Assert the
    // observable consequence — a `{id: grade}` map would serialise the grades
    // alongside the ids, and an array of ids cannot.
    expect(Array.isArray(detail.itemIds)).toBe(true);
    expect(detail.itemIds.every((id) => typeof id === 'string')).toBe(true);
    expect(detail).not.toHaveProperty('groundTruth');
    expect(Object.keys(detail)).not.toContain('groundTruth');
  });

  it('404s on an unknown task', async () => {
    repo.findBySlugWithSubmissions.mockResolvedValue(null);

    await expect(service.getTaskDetail('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

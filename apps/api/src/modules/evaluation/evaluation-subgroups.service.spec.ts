import { BadRequestException } from '@nestjs/common';
import {
  EvaluationSubmissionDetailSchema,
  EvaluationTaskDetailSchema,
  MIN_SUBGROUP_CELL_SIZE,
  type SubgroupField,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingAuditEmitter } from '../../test-support/recording-audit-emitter.js';
import type { EvalQueueProvider } from './eval-queue.js';
import type { EvaluationRepository } from './evaluation.repository.js';
import { EvaluationService } from './evaluation.service.js';
import { servingVersionStub } from '../../test-support/serving-version-stub.js';
import { SubmissionResultService } from './submission-result.service.js';
import { scoreSubgroups } from './subgroup-scoring.js';

/**
 * #410 through the service: subgroup results are computed at scoring time,
 * stored with the submission, and returned as stored. The repository is
 * mocked; the scorers are not.
 */

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const SUBMISSION_ID = '22222222-2222-4222-8222-222222222222';
const PARTICIPANT = { sub: 'participant-sub' } as unknown as CognitoAccessTokenPayload;

const BAND: SubgroupField = {
  key: 'ageBand',
  label: 'Age band',
  values: [
    { value: '<60', label: 'Under 60' },
    { value: '60+', label: '60 and over' },
  ],
};
const IDS = Array.from({ length: 40 }, (_, i) => `img${String(i).padStart(2, '0')}`);
const GROUND_TRUTH = Object.fromEntries(IDS.map((id, i) => [id, i % 2]));
const VALUES = Object.fromEntries(IDS.map((id, i) => [id, { ageBand: i < 20 ? '<60' : '60+' }]));
/** Right on every item under 60, wrong on every third item of 60 and over. */
const PREDICTIONS = IDS.map((id, i) => ({
  imageId: id,
  grade: i >= 20 && i % 3 === 0 ? 1 - (i % 2) : i % 2,
}));

function service(repo: Record<string, unknown>) {
  return new EvaluationService(
    repo as unknown as EvaluationRepository,
    { missingConfig: () => [] } as unknown as EvalQueueProvider,
    new RecordingAuditEmitter().asEmitter(),
    servingVersionStub().asService(),
  );
}

describe('submitPredictions stores the subgroup results with the scores', () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    repo = {
      findScoringContext: vi.fn().mockResolvedValue({
        id: TASK_ID,
        taskKind: 'CLASSIFICATION',
        numClasses: 2,
        referableThreshold: 1,
        groundTruth: GROUND_TRUTH,
        subgroups: { fields: [BAND], values: VALUES },
      }),
      countScoredSubmissionsForParticipant: vi.fn().mockResolvedValue(0),
      createSubmission: vi.fn().mockResolvedValue({ id: SUBMISSION_ID }),
    };
  });

  it('computes them at the threshold in force and writes them in the same row', async () => {
    await service(repo).submitPredictions(
      'task',
      { methodName: 'm', intent: 'SCORED', predictions: PREDICTIONS },
      PARTICIPANT,
    );
    const written = repo.createSubmission?.mock.calls[0]?.[0] as {
      status: string;
      subgroupScores: unknown;
    };
    expect(written.status).toBe('SCORED');
    expect(written.subgroupScores).toStrictEqual(
      scoreSubgroups({
        kind: 'CLASSIFICATION',
        groundTruth: GROUND_TRUTH,
        predictions: Object.fromEntries(PREDICTIONS.map((p) => [p.imageId, p.grade])),
        config: { numClasses: 2, referableThreshold: 1 },
        subgroups: { fields: [BAND], values: VALUES },
        minCellSize: MIN_SUBGROUP_CELL_SIZE,
      }),
    );
    const cells = (written.subgroupScores as { fields: { cells: { status: string }[] }[] })
      .fields[0]?.cells;
    expect(cells?.map((c) => c.status)).toEqual(['REPORTED', 'REPORTED']);
  });

  it('writes none when the task declares no field', async () => {
    repo.findScoringContext?.mockResolvedValue({
      id: TASK_ID,
      taskKind: 'CLASSIFICATION',
      numClasses: 2,
      referableThreshold: 1,
      groundTruth: GROUND_TRUTH,
      subgroups: null,
    });
    await service(repo).submitPredictions(
      'task',
      { methodName: 'm', intent: 'SCORED', predictions: PREDICTIONS },
      PARTICIPANT,
    );
    expect(repo.createSubmission?.mock.calls[0]?.[0]).toMatchObject({ subgroupScores: null });
  });

  it('a file refused before scoring stores no subgroup result either', async () => {
    await expect(
      service(repo).submitPredictions(
        'task',
        {
          methodName: 'm',
          intent: 'SCORED',
          predictions: [...PREDICTIONS, { imageId: 'img00', grade: 0 }],
        },
        PARTICIPANT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const written = repo.createSubmission?.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(written['status']).toBe('FAILED');
    expect(written['subgroupScores']).toBeUndefined();
  });
});

describe('the outbox scores a sealed run by subgroup too', () => {
  it('stores the same breakdown the predictions path would', async () => {
    const applyResult = vi.fn().mockResolvedValue(1);
    const outbox = new SubmissionResultService(
      {
        findSubmissionForResult: vi.fn().mockResolvedValue({
          id: SUBMISSION_ID,
          taskId: TASK_ID,
          mode: 'CONTAINER',
          status: 'PENDING',
          routeVersion: null,
          resultFingerprint: null,
          failureCode: null,
          scores: null,
        }),
        findScoringContextBySubmissionId: vi.fn().mockResolvedValue({
          id: TASK_ID,
          taskKind: 'CLASSIFICATION',
          numClasses: 2,
          referableThreshold: 1,
          groundTruth: GROUND_TRUTH,
          subgroups: { fields: [BAND], values: VALUES },
        }),
        applyResult,
      } as unknown as EvaluationRepository,
      new RecordingAuditEmitter().asEmitter(),
    );
    const predictions = Object.fromEntries(PREDICTIONS.map((p) => [p.imageId, p.grade]));
    await outbox.recordResult(SUBMISSION_ID, { durationMs: 10, predictions });
    expect(applyResult.mock.calls[0]?.[1]).toMatchObject({
      status: 'SCORED',
      subgroupScores: scoreSubgroups({
        kind: 'CLASSIFICATION',
        groundTruth: GROUND_TRUTH,
        predictions,
        config: { numClasses: 2, referableThreshold: 1 },
        subgroups: { fields: [BAND], values: VALUES },
        minCellSize: MIN_SUBGROUP_CELL_SIZE,
      }),
    });
  });
});

describe('read paths', () => {
  const stored = {
    minCellSize: 11,
    fields: [
      {
        key: 'ageBand',
        label: 'Age band',
        cells: [
          {
            status: 'REPORTED',
            value: '<60',
            label: 'Under 60',
            itemCount: 20,
            scoredCount: 20,
            metrics: { kind: 'CLASSIFICATION', accuracy: 1, balancedAccuracy: 1, macroF1: 1 },
          },
          { status: 'SUPPRESSED', value: '60+', label: '60 and over' },
        ],
      },
    ],
  };
  const row = (subgroupScores: unknown, over: Record<string, unknown> = {}) => ({
    id: SUBMISSION_ID,
    methodName: 'm',
    mode: 'PREDICTIONS',
    status: 'SCORED',
    scores: {
      kind: 'CLASSIFICATION',
      metrics: {
        accuracy: 1,
        balancedAccuracy: 1,
        macroF1: 1,
        microF1: 1,
        perClass: [],
        coverage: 1,
      },
    },
    subgroupScores,
    error: null,
    submittedBy: null,
    createdAt: new Date('2026-11-22T10:00:00Z'),
    retractedAt: null,
    routeVersionRef: null,
    task: {
      slug: 'task',
      name: 'Task',
      datasetSlug: 'ds',
      taskKind: 'CLASSIFICATION',
      numClasses: 2,
      referableThreshold: 1,
      positiveClassName: null,
    },
    ...over,
  });

  it('returns the stored breakdown as stored, and it validates', async () => {
    const detail = await service({
      findSubmissionDetail: vi.fn().mockResolvedValue(row(stored)),
    }).getSubmissionDetail('task', SUBMISSION_ID);
    expect(detail.subgroups).toStrictEqual(stored);
    expect(EvaluationSubmissionDetailSchema.safeParse(detail).success).toBe(true);
  });

  it('gives an administrator the same withheld group: no count, no figure', async () => {
    const admin = {
      sub: 'admin',
      'cognito:groups': ['admin'],
    } as unknown as CognitoAccessTokenPayload;
    const detail = await service({
      findSubmissionDetail: vi.fn().mockResolvedValue(row(stored)),
    }).getSubmissionDetail('task', SUBMISSION_ID, admin);
    expect(detail.subgroups?.fields[0]?.cells[1]).toStrictEqual({
      status: 'SUPPRESSED',
      value: '60+',
      label: '60 and over',
    });
  });

  it('reads a stored value that does not parse as no breakdown, never as a partial one', async () => {
    const tampered = structuredClone(stored);
    (tampered.fields[0]!.cells[1] as Record<string, unknown>)['scoredCount'] = 4;
    const detail = await service({
      findSubmissionDetail: vi.fn().mockResolvedValue(row(tampered)),
    }).getSubmissionDetail('task', SUBMISSION_ID);
    expect(detail.subgroups).toBeNull();
  });

  it('publishes the declared fields on the task, and no item map', async () => {
    const detail = await service({
      findBySlugWithSubmissions: vi.fn().mockResolvedValue({
        id: TASK_ID,
        slug: 'task',
        name: 'Task',
        datasetSlug: 'ds',
        taskKind: 'CLASSIFICATION',
        numClasses: 2,
        referableThreshold: 1,
        positiveClassName: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        itemIds: IDS,
        subgroupFields: [BAND],
        submissions: [],
      }),
    }).getTaskDetail('task');
    expect(detail.subgroupFields).toEqual([BAND]);
    expect(EvaluationTaskDetailSchema.safeParse(detail).success).toBe(true);
    expect(JSON.stringify(detail)).not.toContain('"60+"}');
    expect(Object.keys(detail)).not.toContain('subgroupValues');
  });
});

describe('createTask', () => {
  it('passes the declaration and the item map to the repository', async () => {
    const createTask = vi.fn().mockResolvedValue({ id: TASK_ID, slug: 'task' });
    await service({ createTask }).createTask({
      slug: 'task',
      name: 'Task',
      datasetSlug: 'ds',
      taskKind: 'CLASSIFICATION',
      numClasses: 2,
      referableThreshold: 1,
      groundTruth: GROUND_TRUTH,
      subgroups: { fields: [BAND], values: VALUES },
    });
    expect(createTask.mock.calls[0]?.[0]).toMatchObject({
      subgroups: { fields: [BAND], values: VALUES },
    });
  });

  it('passes null when the request declares none', async () => {
    const createTask = vi.fn().mockResolvedValue({ id: TASK_ID, slug: 'task' });
    await service({ createTask }).createTask({
      slug: 'task',
      name: 'Task',
      datasetSlug: 'ds',
      taskKind: 'CLASSIFICATION',
      numClasses: 2,
      referableThreshold: 1,
      groundTruth: GROUND_TRUTH,
    });
    expect(createTask.mock.calls[0]?.[0]).toMatchObject({ subgroups: null });
  });
});

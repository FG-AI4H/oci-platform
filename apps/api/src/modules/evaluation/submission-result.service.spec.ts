import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { EvaluationScores, SealedRunResult } from '@oci/shared-types';
import { describe, expect, it, vi } from 'vitest';
import type {
  EvaluationRepository,
  SubmissionResultContextRow,
  SubmissionResultUpdate,
} from './evaluation.repository.js';
import { scoreSubmission } from './scoring.js';
import { SubmissionResultService } from './submission-result.service.js';

const SUBMISSION_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '11111111-1111-4111-8111-111111111111';

/**
 * The task's HIDDEN ground truth. Every assertion below that checks a response
 * body checks it against these item ids: ground truth must not reach a DTO.
 */
const GROUND_TRUTH = { idrid_01: 0, idrid_02: 1, idrid_03: 3, idrid_04: 4 };

const WORKER_PREDICTIONS = { idrid_01: 0, idrid_02: 2, idrid_03: 3, idrid_04: 4 };

const HOST_METRICS: EvaluationScores = {
  qwk: 0.8123,
  accuracy: 0.75,
  referableSensitivity: 1,
  referableSpecificity: 0.5,
  coverage: 1,
};

function result(over: Partial<SealedRunResult> = {}): SealedRunResult {
  return { durationMs: 4321, ...over } as SealedRunResult;
}

/**
 * Stateful repository double: `applyResult` mutates the row the way the
 * predicated UPDATE does (only while PENDING, returning the affected count), so
 * the replay path is exercised against real state transitions rather than a
 * pre-canned second response.
 */
function makeRepo(row: Partial<SubmissionResultContextRow> = {}) {
  const state: SubmissionResultContextRow = {
    id: SUBMISSION_ID,
    taskId: TASK_ID,
    mode: 'CONTAINER',
    status: 'PENDING',
    routeVersion: null,
    resultFingerprint: null,
    failureCode: null,
    scores: null,
    ...row,
  };

  const findSubmissionForResult = vi.fn(async (id: string) =>
    id === state.id ? { ...state } : null,
  );
  const findScoringContextBySubmissionId = vi.fn(async (id: string) =>
    id === state.id
      ? {
          id: TASK_ID,
          taskKind: 'GRADING' as const,
          numClasses: 5,
          referableThreshold: 2,
          groundTruth: GROUND_TRUTH,
        }
      : null,
  );
  const applyResult = vi.fn(async (id: string, data: SubmissionResultUpdate) => {
    if (id !== state.id || state.status !== 'PENDING') return 0;
    state.status = data.status;
    state.scores = data.scores;
    state.failureCode = data.failureCode;
    state.resultFingerprint = data.resultFingerprint;
    return 1;
  });

  return {
    state,
    mock: { findSubmissionForResult, findScoringContextBySubmissionId, applyResult },
  };
}

function makeService(repo: ReturnType<typeof makeRepo>): SubmissionResultService {
  return new SubmissionResultService(repo.mock as unknown as EvaluationRepository);
}

describe('SubmissionResultService — predictions branch', () => {
  it('scores server-side with scoring.ts and persists SCORED', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    const out = await service.recordResult(
      SUBMISSION_ID,
      result({ predictions: WORKER_PREDICTIONS }),
    );

    const expected = scoreSubmission({
      groundTruth: GROUND_TRUTH,
      predictions: WORKER_PREDICTIONS,
      numClasses: 5,
      referableThreshold: 2,
    });

    expect(out.status).toBe('SCORED');
    // Same numbers as the ADR-0017 scorer, wrapped in the ADR-0020 envelope.
    expect(out.scores).toEqual({ kind: 'GRADING', metrics: expected });
    expect(out.failure).toBeNull();
    expect(out.replayed).toBe(false);
    expect(repo.state.status).toBe('SCORED');
    expect(repo.mock.applyResult).toHaveBeenCalledTimes(1);
    expect(repo.mock.applyResult).toHaveBeenCalledWith(
      SUBMISSION_ID,
      expect.objectContaining({ status: 'SCORED', durationMs: 4321, failureCode: null }),
    );
  });

  it('records MALFORMED_OUTPUT (not a 400) when a returned label is out of range', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    const out = await service.recordResult(
      SUBMISSION_ID,
      result({ predictions: { ...WORKER_PREDICTIONS, idrid_02: 99 } }),
    );

    expect(out.status).toBe('FAILED');
    expect(out.failure?.code).toBe('MALFORMED_OUTPUT');
    expect(out.scores).toBeNull();
    // The ScoringError text (which quotes ids and labels) never reaches the
    // response — only the code-derived message does.
    expect(out.failure?.message).not.toContain('99');
    expect(JSON.stringify(out)).not.toContain('idrid_02');
  });
});

describe('SubmissionResultService — metrics branch', () => {
  it('persists host-computed metrics as-is and never reads ground truth', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    const out = await service.recordResult(SUBMISSION_ID, result({ metrics: HOST_METRICS }));

    expect(out.status).toBe('SCORED');
    // Host-supplied metrics are stored as-is, wrapped in the ADR-0020 envelope
    // and tagged GRADING — the shape the sealed-run contract types `metrics` as.
    expect(out.scores).toEqual({ kind: 'GRADING', metrics: HOST_METRICS });
    expect(repo.mock.findScoringContextBySubmissionId).not.toHaveBeenCalled();
    expect(repo.mock.applyResult).toHaveBeenCalledWith(
      SUBMISSION_ID,
      expect.objectContaining({
        status: 'SCORED',
        scores: { kind: 'GRADING', metrics: HOST_METRICS },
      }),
    );
  });
});

describe('SubmissionResultService — failure branch', () => {
  it('persists FAILED with the classified code and leaks neither detail nor ground truth', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    // A worst-case operator detail: container stdout that dumped the input.
    const detail = 'stdout: idrid_01=0 idrid_02=1 idrid_03=3 idrid_04=4 SECRET-LABEL-DUMP';

    const out = await service.recordResult(
      SUBMISSION_ID,
      result({ failure: { code: 'TIMEOUT', detail } }),
    );

    expect(out.status).toBe('FAILED');
    expect(out.failure).toEqual({
      code: 'TIMEOUT',
      message: 'The run exceeded the wall-clock limit for this task and was terminated.',
    });
    expect(out.scores).toBeNull();

    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain('detail');
    expect(serialised).not.toContain('SECRET-LABEL-DUMP');
    expect(serialised).not.toContain('stdout');
    for (const itemId of Object.keys(GROUND_TRUTH)) {
      expect(serialised).not.toContain(itemId);
    }

    // The stored participant-facing `error` is code-derived too, so even a
    // future endpoint that exposes it cannot leak the detail.
    const persisted = repo.mock.applyResult.mock.calls[0]?.[1] as SubmissionResultUpdate;
    expect(persisted.failureCode).toBe('TIMEOUT');
    expect(persisted.error).not.toContain('SECRET-LABEL-DUMP');
  });

  it('classifies NETWORK_ATTEMPT_DETECTED as a failure of its own', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    const out = await service.recordResult(
      SUBMISSION_ID,
      result({ failure: { code: 'NETWORK_ATTEMPT_DETECTED', detail: 'connect() to 8.8.8.8:53' } }),
    );

    expect(out.status).toBe('FAILED');
    expect(out.failure?.code).toBe('NETWORK_ATTEMPT_DETECTED');
    expect(JSON.stringify(out)).not.toContain('8.8.8.8');
  });
});

describe('SubmissionResultService — idempotency', () => {
  it('replays the same result as a 200 no-op and scores exactly once', async () => {
    const repo = makeRepo();
    const service = makeService(repo);
    const payload = result({ predictions: WORKER_PREDICTIONS });

    const first = await service.recordResult(SUBMISSION_ID, payload);
    const second = await service.recordResult(SUBMISSION_ID, payload);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.status).toBe('SCORED');
    expect(second.scores).toEqual(first.scores);

    // Scored once: one write, and one read of the (ground-truth-bearing)
    // scoring context.
    expect(repo.mock.applyResult).toHaveBeenCalledTimes(1);
    expect(repo.mock.findScoringContextBySubmissionId).toHaveBeenCalledTimes(1);
  });

  it('treats a retry with a different durationMs as the same result', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await service.recordResult(SUBMISSION_ID, result({ predictions: WORKER_PREDICTIONS }));
    const retry = await service.recordResult(
      SUBMISSION_ID,
      result({ durationMs: 99_999, predictions: WORKER_PREDICTIONS }),
    );

    expect(retry.replayed).toBe(true);
    expect(repo.mock.applyResult).toHaveBeenCalledTimes(1);
  });

  it('replays an identical failure as a 200 no-op even with different detail', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await service.recordResult(
      SUBMISSION_ID,
      result({ failure: { code: 'TIMEOUT', detail: 'first attempt' } }),
    );
    const retry = await service.recordResult(
      SUBMISSION_ID,
      result({ failure: { code: 'TIMEOUT', detail: 'second attempt, more words' } }),
    );

    expect(retry.replayed).toBe(true);
    expect(retry.failure?.code).toBe('TIMEOUT');
    expect(repo.mock.applyResult).toHaveBeenCalledTimes(1);
  });

  it('409s on a DIFFERENT result for a terminal submission', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await service.recordResult(SUBMISSION_ID, result({ predictions: WORKER_PREDICTIONS }));

    await expect(
      service.recordResult(
        SUBMISSION_ID,
        result({ predictions: { ...WORKER_PREDICTIONS, idrid_04: 0 } }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.recordResult(SUBMISSION_ID, result({ failure: { code: 'TIMEOUT' } })),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(repo.mock.applyResult).toHaveBeenCalledTimes(1);
  });

  it('409s on any result for an already-terminal Mode 1 submission (no fingerprint)', async () => {
    const repo = makeRepo({ mode: 'PREDICTIONS', status: 'SCORED', resultFingerprint: null });
    const service = makeService(repo);

    await expect(
      service.recordResult(SUBMISSION_ID, result({ predictions: WORKER_PREDICTIONS })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.mock.applyResult).not.toHaveBeenCalled();
  });

  it('resolves a lost race (0 rows updated) from the stored state, not the computed one', async () => {
    const repo = makeRepo();
    const service = makeService(repo);
    // Simulate a concurrent POST winning the predicated UPDATE in between.
    repo.mock.applyResult.mockImplementationOnce(async () => {
      repo.state.status = 'FAILED';
      repo.state.failureCode = 'TIMEOUT';
      repo.state.resultFingerprint = 'someone-elses-fingerprint';
      return 0;
    });

    await expect(
      service.recordResult(SUBMISSION_ID, result({ predictions: WORKER_PREDICTIONS })),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SubmissionResultService — rejections', () => {
  it('404s on an unknown submission', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await expect(
      service.recordResult(
        '33333333-3333-4333-8333-333333333333',
        result({ predictions: WORKER_PREDICTIONS }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.mock.applyResult).not.toHaveBeenCalled();
  });

  it('400s when both predictions and metrics are present', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await expect(
      service.recordResult(
        SUBMISSION_ID,
        result({ predictions: WORKER_PREDICTIONS, metrics: HOST_METRICS }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.mock.applyResult).not.toHaveBeenCalled();
  });

  it('400s when none of predictions, metrics or failure is present', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await expect(service.recordResult(SUBMISSION_ID, result())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.mock.applyResult).not.toHaveBeenCalled();
  });

  it('409s when routeVersion disagrees with the version recorded at dispatch', async () => {
    const repo = makeRepo({ routeVersion: 'oci-sealed-mode2@2.1.0' });
    const service = makeService(repo);

    await expect(
      service.recordResult(
        SUBMISSION_ID,
        result({ routeVersion: 'oci-sealed-mode2@1.0.0', predictions: WORKER_PREDICTIONS }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.mock.applyResult).not.toHaveBeenCalled();

    // The matching version is accepted.
    const out = await service.recordResult(
      SUBMISSION_ID,
      result({ routeVersion: 'oci-sealed-mode2@2.1.0', predictions: WORKER_PREDICTIONS }),
    );
    expect(out.status).toBe('SCORED');
  });
});

import { BadRequestException } from '@nestjs/common';
import { intentForPhase } from '@oci/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EvalAiSeamService } from './evalai-seam.service.js';
import { externalParticipantAsUuid } from './seam-identity.js';

const BODY = {
  taskSlug: 'idrid-dr-grading',
  predictions: [{ imageId: 'IDRiD_001', grade: 4 }],
  externalSubmissionId: '9001',
  externalChallengeId: '493',
  externalParticipantId: 'participant_team:711',
  phaseCodename: 'test',
};

let evaluation: {
  submitPredictions: ReturnType<typeof vi.fn>;
  validatePredictions: ReturnType<typeof vi.fn>;
};
let repo: { findReferenceRouteVersionForMode: ReturnType<typeof vi.fn> };
let svc: EvalAiSeamService;

beforeEach(() => {
  evaluation = {
    submitPredictions: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }),
    validatePredictions: vi.fn().mockResolvedValue({ ok: true }),
  };
  repo = {
    findReferenceRouteVersionForMode: vi.fn().mockResolvedValue({
      routeId: 'r1',
      routeSlug: 'oci-predictions-scoring',
      versionId: 'v1',
      version: '1.0.0',
      reviewStatus: 'DECLARED',
    }),
  };
  svc = new EvalAiSeamService(evaluation as never, repo as never);
});

describe('phase -> intent mapping', () => {
  it('maps dev to VALIDATION and test to SCORED, case-insensitively', () => {
    expect(intentForPhase('dev')).toBe('VALIDATION');
    expect(intentForPhase('Validation')).toBe('VALIDATION');
    expect(intentForPhase('test')).toBe('SCORED');
    expect(intentForPhase('FINAL')).toBe('SCORED');
  });

  it('refuses an unknown phase rather than guessing', async () => {
    expect(intentForPhase('mystery-phase')).toBeNull();
    await expect(svc.intake({ ...BODY, phaseCodename: 'mystery-phase' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Guessing either way is a silent failure the participant cannot diagnose.
    expect(evaluation.submitPredictions).not.toHaveBeenCalled();
    expect(evaluation.validatePredictions).not.toHaveBeenCalled();
  });
});

describe('VALIDATION (dev) — nothing is created, nothing is spent', () => {
  it('returns synchronously with no submission and no route', async () => {
    const out = await svc.intake({ ...BODY, phaseCodename: 'dev' });
    expect(out).toEqual({
      intent: 'VALIDATION',
      ociSubmissionId: null,
      routeSlug: null,
      routeVersion: null,
      published: false,
      validationOk: true,
    });
    // The scoring path is never touched, so ground truth is never loaded.
    expect(evaluation.submitPredictions).not.toHaveBeenCalled();
    expect(evaluation.validatePredictions).toHaveBeenCalledOnce();
  });
});

describe('SCORED (test) — the quota binds the TEAM, not the calling worker', () => {
  it('attributes the submission to the EvalAI participant_team', async () => {
    await svc.intake(BODY);
    const [, , user, seam] = evaluation.submitPredictions.mock.calls[0] as unknown[];
    // No Cognito user: the caller is a machine, the participant is a team.
    expect(user).toBeUndefined();
    expect(seam).toMatchObject({
      submittedBy: externalParticipantAsUuid('participant_team:711'),
      externalSubmissionId: '9001',
      externalChallengeId: '493',
    });
  });

  it('gives two teams different quota keys, and one team a stable key', () => {
    const a = externalParticipantAsUuid('participant_team:711');
    const b = externalParticipantAsUuid('participant_team:712');
    expect(a).not.toBe(b);
    expect(externalParticipantAsUuid('participant_team:711')).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns 202-shaped provenance and marks a DECLARED route as NOT published', async () => {
    const out = await svc.intake(BODY);
    expect(out).toMatchObject({
      intent: 'SCORED',
      ociSubmissionId: '11111111-1111-4111-8111-111111111111',
      routeSlug: 'oci-predictions-scoring',
      routeVersion: '1.0.0',
      published: false,
      validationOk: null,
    });
  });

  it('marks the result published only once the route version is APPROVED', async () => {
    repo.findReferenceRouteVersionForMode.mockResolvedValue({
      routeId: 'r1',
      routeSlug: 'oci-predictions-scoring',
      versionId: 'v1',
      version: '1.0.0',
      reviewStatus: 'APPROVED',
    });
    const out = await svc.intake(BODY);
    expect(out.published).toBe(true);
  });

  it('never returns a score — the write-back is the only delivery path', async () => {
    const out = await svc.intake(BODY);
    expect(Object.keys(out)).not.toContain('scores');
  });
});

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CertificationRepository, type QuizAttemptRow } from './certification.repository.js';
import { CertificationService } from './certification.service.js';
import { ACTIVE_QUIZ_TYPE, QUIZZES } from './quiz-bank.js';

const REQUESTER_SUB = '00000000-0000-4000-8000-000000000099';
const ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function user(sub: string): CognitoAccessTokenPayload {
  return { sub } as unknown as CognitoAccessTokenPayload;
}

interface RepoMock {
  createAttempt: ReturnType<typeof vi.fn>;
  findAttemptForSubmission: ReturnType<typeof vi.fn>;
  submitAttempt: ReturnType<typeof vi.fn>;
  listForUser: ReturnType<typeof vi.fn>;
  findActiveCertification: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let service: CertificationService;

beforeEach(() => {
  repo = {
    createAttempt: vi.fn(),
    findAttemptForSubmission: vi.fn(),
    submitAttempt: vi.fn(),
    listForUser: vi.fn(),
    findActiveCertification: vi.fn(),
  };
  service = new CertificationService(repo as unknown as CertificationRepository);
});

describe('CertificationService.getDefinition', () => {
  it('returns the canonical quiz without correct-answer keys', () => {
    const def = service.getDefinition(ACTIVE_QUIZ_TYPE);
    expect(def.certificationType).toBe(ACTIVE_QUIZ_TYPE);
    expect(def.questions.length).toBeGreaterThan(0);
    for (const q of def.questions) {
      expect(q).not.toHaveProperty('correctIndex');
      expect(q.choices).toHaveLength(4);
    }
  });

  it('404s on unknown quiz type', () => {
    expect(() => service.getDefinition('non_existent')).toThrow(NotFoundException);
  });
});

describe('CertificationService.start', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      service.start(ACTIVE_QUIZ_TYPE, {} as CognitoAccessTokenPayload),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates an attempt row and returns its id', async () => {
    repo.createAttempt.mockResolvedValue({
      id: ATTEMPT_ID,
      userId: REQUESTER_SUB,
      certificationType: ACTIVE_QUIZ_TYPE,
      startedAt: new Date('2026-05-08T00:00:00.000Z'),
      submittedAt: null,
      score: null,
      passed: null,
      answers: null,
    } satisfies QuizAttemptRow);
    const out = await service.start(ACTIVE_QUIZ_TYPE, user(REQUESTER_SUB));
    expect(out.attemptId).toBe(ATTEMPT_ID);
  });
});

describe('CertificationService.submit', () => {
  function pendingRow(): QuizAttemptRow {
    return {
      id: ATTEMPT_ID,
      userId: REQUESTER_SUB,
      certificationType: ACTIVE_QUIZ_TYPE,
      startedAt: new Date('2026-05-08T00:00:00.000Z'),
      submittedAt: null,
      score: null,
      passed: null,
      answers: null,
    };
  }

  it('404s when attempt does not exist', async () => {
    repo.findAttemptForSubmission.mockResolvedValue(null);
    await expect(
      service.submit({
        certificationType: ACTIVE_QUIZ_TYPE,
        attemptId: ATTEMPT_ID,
        body: { answers: [{ questionId: 'q1-data-min', choiceIndex: 1 }] },
        user: user(REQUESTER_SUB),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when attempt belongs to another user (no oracle)', async () => {
    repo.findAttemptForSubmission.mockResolvedValue({
      ...pendingRow(),
      userId: '11111111-1111-4111-8111-111111111111',
    });
    await expect(
      service.submit({
        certificationType: ACTIVE_QUIZ_TYPE,
        attemptId: ATTEMPT_ID,
        body: { answers: [{ questionId: 'q1-data-min', choiceIndex: 1 }] },
        user: user(REQUESTER_SUB),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects submission of a different quiz type with 400', async () => {
    repo.findAttemptForSubmission.mockResolvedValue({
      ...pendingRow(),
      certificationType: 'data_ethics_v2',
    });
    await expect(
      service.submit({
        certificationType: ACTIVE_QUIZ_TYPE,
        attemptId: ATTEMPT_ID,
        body: { answers: [{ questionId: 'q1-data-min', choiceIndex: 1 }] },
        user: user(REQUESTER_SUB),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects double submission with 409', async () => {
    repo.findAttemptForSubmission.mockResolvedValue({
      ...pendingRow(),
      submittedAt: new Date(),
      score: 90,
      passed: true,
    });
    await expect(
      service.submit({
        certificationType: ACTIVE_QUIZ_TYPE,
        attemptId: ATTEMPT_ID,
        body: { answers: [{ questionId: 'q1-data-min', choiceIndex: 1 }] },
        user: user(REQUESTER_SUB),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('grades all-correct as 100 and passes', async () => {
    repo.findAttemptForSubmission.mockResolvedValue(pendingRow());
    // eslint-disable-next-line security/detect-object-injection -- ACTIVE_QUIZ_TYPE is a literal const
    const def = QUIZZES[ACTIVE_QUIZ_TYPE]!;
    const allCorrect = def.questions.map((q) => ({
      questionId: q.id,
      choiceIndex: q.correctIndex,
    }));
    repo.submitAttempt.mockImplementation(async (input) => ({
      ...pendingRow(),
      submittedAt: new Date('2026-05-08T00:01:00.000Z'),
      score: input.score,
      passed: input.passed,
    }));
    const result = await service.submit({
      certificationType: ACTIVE_QUIZ_TYPE,
      attemptId: ATTEMPT_ID,
      body: { answers: allCorrect },
      user: user(REQUESTER_SUB),
    });
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.expiresAt).not.toBeNull();
  });

  it('grades all-wrong as 0 and fails', async () => {
    repo.findAttemptForSubmission.mockResolvedValue(pendingRow());
    // eslint-disable-next-line security/detect-object-injection -- ACTIVE_QUIZ_TYPE is a literal const
    const def = QUIZZES[ACTIVE_QUIZ_TYPE]!;
    const allWrong = def.questions.map((q) => ({
      questionId: q.id,
      // Pick any choice that's not the correct one (cap at 3).
      choiceIndex: q.correctIndex === 0 ? 1 : 0,
    }));
    repo.submitAttempt.mockImplementation(async (input) => ({
      ...pendingRow(),
      submittedAt: new Date('2026-05-08T00:01:00.000Z'),
      score: input.score,
      passed: input.passed,
    }));
    const result = await service.submit({
      certificationType: ACTIVE_QUIZ_TYPE,
      attemptId: ATTEMPT_ID,
      body: { answers: allWrong },
      user: user(REQUESTER_SUB),
    });
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.expiresAt).toBeNull();
  });

  it('counts skipped questions as wrong (no score boost)', async () => {
    repo.findAttemptForSubmission.mockResolvedValue(pendingRow());
    // eslint-disable-next-line security/detect-object-injection -- ACTIVE_QUIZ_TYPE is a literal const
    const def = QUIZZES[ACTIVE_QUIZ_TYPE]!;
    // Submit only the first question correctly; rest skipped.
    const partial = [
      { questionId: def.questions[0]!.id, choiceIndex: def.questions[0]!.correctIndex },
    ];
    repo.submitAttempt.mockImplementation(async (input) => ({
      ...pendingRow(),
      submittedAt: new Date(),
      score: input.score,
      passed: input.passed,
    }));
    const result = await service.submit({
      certificationType: ACTIVE_QUIZ_TYPE,
      attemptId: ATTEMPT_ID,
      body: { answers: partial },
      user: user(REQUESTER_SUB),
    });
    // 1 of N correct → low score, definitely below 80% pass mark.
    expect(result.score).toBeLessThan(def.passMarkPercent);
    expect(result.passed).toBe(false);
  });
});

describe('CertificationService.listOwnStatus', () => {
  it('reports active=false when no passed attempt within validity', async () => {
    repo.findActiveCertification.mockResolvedValue(null);
    repo.listForUser.mockResolvedValue([]);
    const out = await service.listOwnStatus(user(REQUESTER_SUB), ACTIVE_QUIZ_TYPE);
    expect(out.active).toBe(false);
    expect(out.passedAt).toBeNull();
    expect(out.history).toEqual([]);
  });

  it('reports active=true with expiresAt when an active cert exists', async () => {
    const passedAt = new Date('2026-04-01T00:00:00.000Z');
    repo.findActiveCertification.mockResolvedValue({
      id: 'r1',
      userId: REQUESTER_SUB,
      certificationType: ACTIVE_QUIZ_TYPE,
      startedAt: passedAt,
      submittedAt: passedAt,
      score: 90,
      passed: true,
      answers: [],
    } satisfies QuizAttemptRow);
    repo.listForUser.mockResolvedValue([
      {
        id: 'r1',
        userId: REQUESTER_SUB,
        certificationType: ACTIVE_QUIZ_TYPE,
        startedAt: passedAt,
        submittedAt: passedAt,
        score: 90,
        passed: true,
        answers: [],
      },
    ]);
    const out = await service.listOwnStatus(user(REQUESTER_SUB), ACTIVE_QUIZ_TYPE);
    expect(out.active).toBe(true);
    expect(out.passedAt).toBe(passedAt.toISOString());
    expect(out.expiresAt).not.toBeNull();
    expect(out.history).toHaveLength(1);
  });
});

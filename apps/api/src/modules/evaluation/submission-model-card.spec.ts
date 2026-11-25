import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  EvaluationSubmissionDetailSchema,
  LinkSubmissionModelCardResponseSchema,
  type ModelCardStatus,
  type SubmitContainerRequest,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isFlatPayload,
  RecordingAuditEmitter,
} from '../../test-support/recording-audit-emitter.js';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import type { EvalQueueProvider } from './eval-queue.js';
import type { EvaluationRepository, LinkedModelCardRef } from './evaluation.repository.js';
import { EvaluationService } from './evaluation.service.js';
import { servingVersionStub } from '../../test-support/serving-version-stub.js';

/**
 * #587 — the linking rule between a submission and a model card: on submit in
 * both modes, through the link endpoint, and in the submission detail. Every
 * refusal is checked to write nothing, spend no quota and record no event.
 */

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const SUBMISSION_ID = '22222222-2222-4222-8222-222222222222';
const CARD_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_CARD_ID = '44444444-4444-4444-8444-444444444444';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const IMAGE_REF = `registry.example/participant/model@${DIGEST}`;

const participant = (sub: string, groups: string[] = []) =>
  ({ sub, 'cognito:groups': groups }) as unknown as CognitoAccessTokenPayload;
const ALICE = participant('alice-sub');
const BOB = participant('bob-sub');
const ADMIN = participant('admin-sub', ['admin']);
const REVIEWER = participant('reviewer-sub', ['evaluation-reviewer']);
const ALICE_ID = cognitoSubAsUuid('alice-sub');
const BOB_ID = cognitoSubAsUuid('bob-sub');

function card(over: Partial<LinkedModelCardRef> = {}): LinkedModelCardRef {
  return {
    id: CARD_ID,
    slug: 'alice-retina-grader',
    versionMajorMinorPatch: '1.2.0',
    status: 'SUBMITTED',
    submitterUserId: ALICE_ID,
    ...over,
  };
}

const PREDICTIONS_BODY = {
  methodName: 'alice-method',
  intent: 'SCORED' as const,
  predictions: [
    { imageId: 'img-1', grade: 0 },
    { imageId: 'img-2', grade: 1 },
  ],
};

function containerBody(over: Partial<SubmitContainerRequest> = {}): SubmitContainerRequest {
  return {
    methodName: 'alice-container',
    mode: 'CONTAINER',
    intent: 'SCORED',
    imageRef: IMAGE_REF,
    imageDigest: DIGEST,
    ...over,
  };
}

type Mock = ReturnType<typeof vi.fn>;
let repo: Record<string, Mock>;
let queue: {
  missingConfig: Mock;
  callbackUrlFor: Mock;
  publish: Mock;
  runTimeoutSec: number;
};
let audit: RecordingAuditEmitter;
let service: EvaluationService;

beforeEach(() => {
  repo = {
    findScoringContext: vi.fn().mockResolvedValue({
      id: TASK_ID,
      taskKind: 'GRADING',
      numClasses: 2,
      referableThreshold: 1,
      groundTruth: { 'img-1': 0, 'img-2': 1 },
      subgroups: null,
    }),
    findTaskRefBySlug: vi.fn().mockResolvedValue({ id: TASK_ID, slug: 'task-587' }),
    countScoredSubmissionsForParticipant: vi.fn().mockResolvedValue(0),
    createSubmission: vi.fn().mockResolvedValue({ id: SUBMISSION_ID }),
    createContainerSubmission: vi.fn().mockResolvedValue({ id: SUBMISSION_ID }),
    applyResult: vi.fn().mockResolvedValue(1),
    findTaskItemIds: vi.fn(),
    findModelCardForLink: vi.fn().mockResolvedValue(card()),
    findSubmissionForLink: vi.fn(),
    setSubmissionModelCard: vi.fn().mockResolvedValue(undefined),
    findSubmissionDetail: vi.fn(),
  };
  queue = {
    missingConfig: vi.fn().mockReturnValue([]),
    callbackUrlFor: vi.fn().mockReturnValue('https://api.example/v2/submissions/x/result'),
    publish: vi.fn().mockResolvedValue(undefined),
    runTimeoutSec: 1800,
  };
  audit = new RecordingAuditEmitter();
  service = new EvaluationService(
    repo as unknown as EvaluationRepository,
    queue as unknown as EvalQueueProvider,
    audit.asEmitter(),
    servingVersionStub().asService(),
  );
});

/** A refused link wrote nothing, counted nothing and recorded nothing. */
function expectNothingWritten(): void {
  expect(repo['countScoredSubmissionsForParticipant']).not.toHaveBeenCalled();
  expect(repo['createSubmission']).not.toHaveBeenCalled();
  expect(repo['createContainerSubmission']).not.toHaveBeenCalled();
  expect(repo['setSubmissionModelCard']).not.toHaveBeenCalled();
  expect(queue.publish).not.toHaveBeenCalled();
  expect(audit.events).toEqual([]);
}

describe('linking on a predictions submission (#587)', () => {
  it('links the scored row to the caller’s own card and records the link', async () => {
    await service.submitPredictions(
      'task-587',
      { ...PREDICTIONS_BODY, modelCardId: CARD_ID },
      ALICE,
    );

    expect(repo['findModelCardForLink']).toHaveBeenCalledWith(CARD_ID);
    expect(repo['createSubmission']).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SCORED', modelCardId: CARD_ID }),
    );
    expect(audit.actions()).toEqual([
      'evaluation.submitted',
      'evaluation.scored',
      'evaluation.submission.modelcard.linked',
    ]);
    expect(audit.only('evaluation.submitted').payload['modelCardId']).toBe(CARD_ID);
    const linked = audit.only('evaluation.submission.modelcard.linked');
    expect(linked.via).toBe('emit');
    expect(linked.subjectType).toBe('evaluation-submission');
    expect(linked.subjectId).toBe(SUBMISSION_ID);
    expect(linked.actorUserId).toBe(ALICE_ID);
    expect(linked.payload).toEqual({
      modelCardId: CARD_ID,
      modelCardSlug: 'alice-retina-grader',
      modelCardVersion: '1.2.0',
      modelCardStatus: 'SUBMITTED',
      previousModelCardId: null,
      via: 'SUBMISSION',
    });
    expect(isFlatPayload(linked.payload)).toBe(true);
  });

  it.each<ModelCardStatus>(['DRAFT', 'SUBMITTED', 'PUBLISHED'])(
    'accepts the caller’s own %s card',
    async (status) => {
      repo['findModelCardForLink']?.mockResolvedValue(card({ status }));
      await service.submitPredictions(
        'task-587',
        { ...PREDICTIONS_BODY, modelCardId: CARD_ID },
        ALICE,
      );
      expect(repo['createSubmission']).toHaveBeenCalledWith(
        expect.objectContaining({ modelCardId: CARD_ID }),
      );
    },
  );

  it('without a card, reads none and links none', async () => {
    await service.submitPredictions('task-587', PREDICTIONS_BODY, ALICE);

    expect(repo['findModelCardForLink']).not.toHaveBeenCalled();
    expect(repo['createSubmission']).toHaveBeenCalledWith(
      expect.not.objectContaining({ modelCardId: expect.anything() }),
    );
    expect(audit.actions()).toEqual(['evaluation.submitted', 'evaluation.scored']);
    expect(audit.only('evaluation.submitted').payload['modelCardId']).toBeNull();
  });

  it('404s an unknown card before the quota and writes nothing', async () => {
    repo['findModelCardForLink']?.mockResolvedValue(null);
    await expect(
      service.submitPredictions('task-587', { ...PREDICTIONS_BODY, modelCardId: CARD_ID }, ALICE),
    ).rejects.toBeInstanceOf(NotFoundException);
    expectNothingWritten();
  });

  it('403s a card someone else submitted, without naming it', async () => {
    const err: unknown = await service
      .submitPredictions('task-587', { ...PREDICTIONS_BODY, modelCardId: CARD_ID }, BOB)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    // The slug of a card the caller may not see stays out of the refusal.
    expect((err as Error).message).not.toContain('alice-retina-grader');
    expectNothingWritten();
  });

  it('403s a card with no recorded submitter: nobody can claim it', async () => {
    repo['findModelCardForLink']?.mockResolvedValue(card({ submitterUserId: null }));
    await expect(
      service.submitPredictions('task-587', { ...PREDICTIONS_BODY, modelCardId: CARD_ID }, ALICE),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expectNothingWritten();
  });

  it('409s the caller’s own WITHDRAWN card', async () => {
    repo['findModelCardForLink']?.mockResolvedValue(card({ status: 'WITHDRAWN' }));
    await expect(
      service.submitPredictions('task-587', { ...PREDICTIONS_BODY, modelCardId: CARD_ID }, ALICE),
    ).rejects.toBeInstanceOf(ConflictException);
    expectNothingWritten();
  });

  it('refuses an anonymous caller before reading any card', async () => {
    await expect(
      service.submitPredictions('task-587', { ...PREDICTIONS_BODY, modelCardId: CARD_ID }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo['findModelCardForLink']).not.toHaveBeenCalled();
  });

  it('does not link a file refused on its format: the FAILED row holds no result', async () => {
    const duplicate = [...PREDICTIONS_BODY.predictions, { imageId: 'img-1', grade: 1 }];
    await expect(
      service.submitPredictions(
        'task-587',
        { ...PREDICTIONS_BODY, predictions: duplicate, modelCardId: CARD_ID },
        ALICE,
      ),
    ).rejects.toThrow();
    expect(repo['createSubmission']).toHaveBeenCalledWith(
      expect.not.objectContaining({ modelCardId: expect.anything() }),
    );
    expect(audit.actions()).toEqual(['evaluation.failed']);
  });

  it('ignores a card on a seam submission: its participant is an EvalAI team', async () => {
    await service.submitPredictions(
      'task-587',
      { ...PREDICTIONS_BODY, modelCardId: CARD_ID },
      undefined,
      {
        submittedBy: '55555555-5555-4555-8555-555555555555',
        externalSubmissionId: '1',
        externalChallengeId: '493',
      },
    );
    expect(repo['findModelCardForLink']).not.toHaveBeenCalled();
    expect(repo['createSubmission']).toHaveBeenCalledWith(
      expect.not.objectContaining({ modelCardId: expect.anything() }),
    );
  });

  it('a validation submission reads no card and records nothing', async () => {
    repo['findTaskItemIds']?.mockResolvedValue({
      id: TASK_ID,
      slug: 'task-587',
      itemIds: ['img-1', 'img-2'],
      numClasses: 2,
      taskKind: 'GRADING',
    });
    await service.validatePredictions('task-587', {
      ...PREDICTIONS_BODY,
      intent: 'VALIDATION',
      modelCardId: CARD_ID,
    });
    expect(repo['findModelCardForLink']).not.toHaveBeenCalled();
    expect(audit.events).toEqual([]);
  });
});

describe('linking on a container submission (#587)', () => {
  it('links the dispatch record and records the link after `submitted`', async () => {
    await service.submitContainer('task-587', containerBody({ modelCardId: CARD_ID }), ALICE);

    expect(repo['createContainerSubmission']).toHaveBeenCalledWith(
      expect.objectContaining({ modelCardId: CARD_ID }),
    );
    expect(audit.actions()).toEqual([
      'evaluation.submitted',
      'evaluation.submission.modelcard.linked',
    ]);
    expect(audit.only('evaluation.submitted').payload['modelCardId']).toBe(CARD_ID);
    expect(queue.publish).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an unknown card', null, ALICE, NotFoundException],
    ['someone else’s card', card(), BOB, ForbiddenException],
    ['a WITHDRAWN card', card({ status: 'WITHDRAWN' }), ALICE, ConflictException],
  ] as const)('refuses %s before any row or dispatch', async (_case, found, who, error) => {
    repo['findModelCardForLink']?.mockResolvedValue(found);
    await expect(
      service.submitContainer('task-587', containerBody({ modelCardId: CARD_ID }), who),
    ).rejects.toBeInstanceOf(error);
    expectNothingWritten();
  });
});

describe('PATCH /v2/evaluation/submissions/:id/model-card (#587)', () => {
  function submission(over: Record<string, unknown> = {}) {
    return { id: SUBMISSION_ID, status: 'SCORED', submittedBy: ALICE_ID, modelCard: null, ...over };
  }

  it('links the caller’s submission to the caller’s card, synchronously audited', async () => {
    repo['findSubmissionForLink']?.mockResolvedValue(submission());

    const out = await service.linkModelCard(SUBMISSION_ID, { modelCardId: CARD_ID }, ALICE);

    expect(repo['setSubmissionModelCard']).toHaveBeenCalledWith(SUBMISSION_ID, CARD_ID);
    expect(LinkSubmissionModelCardResponseSchema.parse(out)).toEqual({
      submissionId: SUBMISSION_ID,
      modelCard: {
        id: CARD_ID,
        slug: 'alice-retina-grader',
        version: '1.2.0',
        status: 'SUBMITTED',
      },
    });
    const linked = audit.only('evaluation.submission.modelcard.linked');
    expect(linked.via).toBe('emitSync');
    expect(linked.subjectId).toBe(SUBMISSION_ID);
    expect(linked.actorUserId).toBe(ALICE_ID);
    expect(linked.payload).toMatchObject({
      modelCardId: CARD_ID,
      previousModelCardId: null,
      via: 'LINK_ENDPOINT',
    });
  });

  it('moves a link, naming the card it moved from', async () => {
    repo['findSubmissionForLink']?.mockResolvedValue(
      submission({ modelCard: card({ id: OTHER_CARD_ID, slug: 'alice-older-grader' }) }),
    );

    await service.linkModelCard(SUBMISSION_ID, { modelCardId: CARD_ID }, ALICE);

    expect(repo['setSubmissionModelCard']).toHaveBeenCalledWith(SUBMISSION_ID, CARD_ID);
    expect(audit.only('evaluation.submission.modelcard.linked').payload).toMatchObject({
      modelCardId: CARD_ID,
      previousModelCardId: OTHER_CARD_ID,
    });
  });

  it('restating the current link writes nothing and records nothing', async () => {
    repo['findSubmissionForLink']?.mockResolvedValue(submission({ modelCard: card() }));

    const out = await service.linkModelCard(SUBMISSION_ID, { modelCardId: CARD_ID }, ALICE);

    expect(out.modelCard?.id).toBe(CARD_ID);
    expect(repo['setSubmissionModelCard']).not.toHaveBeenCalled();
    expect(audit.events).toEqual([]);
  });

  it('unlinks, synchronously audited with the card it was linked to', async () => {
    repo['findSubmissionForLink']?.mockResolvedValue(submission({ modelCard: card() }));

    const out = await service.linkModelCard(SUBMISSION_ID, { modelCardId: null }, ALICE);

    expect(out).toEqual({ submissionId: SUBMISSION_ID, modelCard: null });
    expect(repo['setSubmissionModelCard']).toHaveBeenCalledWith(SUBMISSION_ID, null);
    const unlinked = audit.only('evaluation.submission.modelcard.unlinked');
    expect(unlinked.via).toBe('emitSync');
    expect(unlinked.payload).toEqual({
      modelCardId: CARD_ID,
      modelCardSlug: 'alice-retina-grader',
      modelCardVersion: '1.2.0',
    });
    expect(isFlatPayload(unlinked.payload)).toBe(true);
  });

  it('may unlink a card that has since been withdrawn', async () => {
    repo['findSubmissionForLink']?.mockResolvedValue(
      submission({ modelCard: card({ status: 'WITHDRAWN' }) }),
    );
    await service.linkModelCard(SUBMISSION_ID, { modelCardId: null }, ALICE);
    expect(repo['setSubmissionModelCard']).toHaveBeenCalledWith(SUBMISSION_ID, null);
  });

  it('unlinking an unlinked submission writes nothing', async () => {
    repo['findSubmissionForLink']?.mockResolvedValue(submission());
    await service.linkModelCard(SUBMISSION_ID, { modelCardId: null }, ALICE);
    expect(repo['setSubmissionModelCard']).not.toHaveBeenCalled();
    expect(audit.events).toEqual([]);
  });

  it('may link a PENDING container submission before its result arrives', async () => {
    repo['findSubmissionForLink']?.mockResolvedValue(submission({ status: 'PENDING' }));
    await service.linkModelCard(SUBMISSION_ID, { modelCardId: CARD_ID }, ALICE);
    expect(repo['setSubmissionModelCard']).toHaveBeenCalledWith(SUBMISSION_ID, CARD_ID);
  });

  describe('refusals, each writing nothing', () => {
    it('404s an unknown submission', async () => {
      repo['findSubmissionForLink']?.mockResolvedValue(null);
      await expect(
        service.linkModelCard(SUBMISSION_ID, { modelCardId: CARD_ID }, ALICE),
      ).rejects.toBeInstanceOf(NotFoundException);
      expectNothingWritten();
    });

    it('404s someone else’s FAILED submission, as the submission page does', async () => {
      repo['findSubmissionForLink']?.mockResolvedValue(submission({ status: 'FAILED' }));
      await expect(
        service.linkModelCard(SUBMISSION_ID, { modelCardId: CARD_ID }, BOB),
      ).rejects.toBeInstanceOf(NotFoundException);
      expectNothingWritten();
    });

    it('403s someone else’s scored submission', async () => {
      repo['findSubmissionForLink']?.mockResolvedValue(submission());
      await expect(
        service.linkModelCard(SUBMISSION_ID, { modelCardId: CARD_ID }, BOB),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expectNothingWritten();
    });

    it('403s an administrator too: a link is the submitter’s claim', async () => {
      repo['findSubmissionForLink']?.mockResolvedValue(submission({ status: 'FAILED' }));
      await expect(
        service.linkModelCard(SUBMISSION_ID, { modelCardId: CARD_ID }, ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expectNothingWritten();
    });

    it('403s a submission with no recorded submitter', async () => {
      repo['findSubmissionForLink']?.mockResolvedValue(submission({ submittedBy: null }));
      await expect(
        service.linkModelCard(SUBMISSION_ID, { modelCardId: CARD_ID }, ALICE),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expectNothingWritten();
    });

    it('404s an unknown card', async () => {
      repo['findSubmissionForLink']?.mockResolvedValue(submission());
      repo['findModelCardForLink']?.mockResolvedValue(null);
      await expect(
        service.linkModelCard(SUBMISSION_ID, { modelCardId: CARD_ID }, ALICE),
      ).rejects.toBeInstanceOf(NotFoundException);
      expectNothingWritten();
    });

    it('403s a card the caller did not submit, on their own submission', async () => {
      repo['findSubmissionForLink']?.mockResolvedValue(submission({ submittedBy: BOB_ID }));
      await expect(
        service.linkModelCard(SUBMISSION_ID, { modelCardId: CARD_ID }, BOB),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expectNothingWritten();
    });

    it('409s a WITHDRAWN card', async () => {
      repo['findSubmissionForLink']?.mockResolvedValue(submission());
      repo['findModelCardForLink']?.mockResolvedValue(card({ status: 'WITHDRAWN' }));
      await expect(
        service.linkModelCard(SUBMISSION_ID, { modelCardId: CARD_ID }, ALICE),
      ).rejects.toBeInstanceOf(ConflictException);
      expectNothingWritten();
    });

    it('403s removing a link to a card the caller did not submit', async () => {
      repo['findSubmissionForLink']?.mockResolvedValue(
        submission({ modelCard: card({ submitterUserId: BOB_ID }) }),
      );
      await expect(
        service.linkModelCard(SUBMISSION_ID, { modelCardId: null }, ALICE),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expectNothingWritten();
    });
  });

  it('surfaces a failed audit write rather than reporting success', async () => {
    repo['findSubmissionForLink']?.mockResolvedValue(submission());
    audit.emitSyncError = new Error('audit insert failed');
    await expect(
      service.linkModelCard(SUBMISSION_ID, { modelCardId: CARD_ID }, ALICE),
    ).rejects.toThrow('audit insert failed');
  });
});

describe('the linked card in the submission detail (#587)', () => {
  function detailRow(modelCard: LinkedModelCardRef | null) {
    return {
      id: SUBMISSION_ID,
      methodName: 'alice-method',
      mode: 'PREDICTIONS',
      status: 'SCORED',
      scores: null,
      subgroupScores: null,
      error: null,
      submittedBy: ALICE_ID,
      createdAt: new Date('2026-11-24T10:00:00.000Z'),
      retractedAt: null,
      routeVersionRef: null,
      modelCard,
      task: {
        slug: 'task-587',
        name: 'Task',
        datasetSlug: 'ds',
        taskKind: 'GRADING',
        numClasses: 2,
        referableThreshold: 1,
        positiveClassName: null,
      },
    };
  }
  const SHOWN = { id: CARD_ID, slug: 'alice-retina-grader', version: '1.2.0' };

  it('is null when nothing is linked', async () => {
    repo['findSubmissionDetail']?.mockResolvedValue(detailRow(null));
    const out = await service.getSubmissionDetail('task-587', SUBMISSION_ID);
    expect(out.modelCard).toBeNull();
    expect(() => EvaluationSubmissionDetailSchema.parse(out)).not.toThrow();
  });

  it('names a PUBLISHED card to anyone, without its submitter', async () => {
    repo['findSubmissionDetail']?.mockResolvedValue(detailRow(card({ status: 'PUBLISHED' })));
    const out = await service.getSubmissionDetail('task-587', SUBMISSION_ID);
    expect(out.modelCard).toEqual({ ...SHOWN, status: 'PUBLISHED' });
    expect(JSON.stringify(out)).not.toContain(ALICE_ID);
    expect(() => EvaluationSubmissionDetailSchema.parse(out)).not.toThrow();
  });

  it.each([
    ['anonymous', undefined, false],
    ['another participant', BOB, false],
    ['the card’s submitter', ALICE, true],
    ['a reviewer', REVIEWER, true],
    ['an administrator', ADMIN, true],
  ] as const)('a SUBMITTED card is named to %s: %s', async (_who, user, shown) => {
    repo['findSubmissionDetail']?.mockResolvedValue(detailRow(card({ status: 'SUBMITTED' })));
    const out = await service.getSubmissionDetail('task-587', SUBMISSION_ID, user);
    expect(out.modelCard).toEqual(shown ? { ...SHOWN, status: 'SUBMITTED' } : null);
  });

  it('a WITHDRAWN card is named to anyone signed in, not to an anonymous reader', async () => {
    repo['findSubmissionDetail']?.mockResolvedValue(detailRow(card({ status: 'WITHDRAWN' })));
    expect((await service.getSubmissionDetail('task-587', SUBMISSION_ID)).modelCard).toBeNull();
    expect((await service.getSubmissionDetail('task-587', SUBMISSION_ID, BOB)).modelCard).toEqual({
      ...SHOWN,
      status: 'WITHDRAWN',
    });
  });
});

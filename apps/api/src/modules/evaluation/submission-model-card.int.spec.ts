import { randomUUID } from 'node:crypto';
import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuditEmitter, type AuditPrismaPort } from '@oci/audit';
import type { PrismaClient } from '@oci/database';
import {
  EvaluationSubmissionDetailSchema,
  LinkSubmissionModelCardResponseSchema,
  ModelFactsLabelSchema,
} from '@oci/shared-types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { COGNITO_VERIFIER, CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { OptionalCognitoJwtGuard } from '../../auth/optional-cognito-jwt.guard.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { PrismaService } from '../../prisma.service.js';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  startMigratedPostgres,
} from '../../test-support/migrated-postgres.js';
import { AUDIT_EMITTER } from '../audit/audit.tokens.js';
import { IntendedUseService } from '../intended-use/intended-use.service.js';
import { PredictionController } from '../prediction/prediction.controller.js';
import { PredictionRepository } from '../prediction/prediction.repository.js';
import { PredictionService } from '../prediction/prediction.service.js';
import { SubmissionBodyPipe } from './dto/submission-body.pipe.js';
import { EvalQueueProvider } from './eval-queue.js';
import { EvaluationController } from './evaluation.controller.js';
import { EvaluationRepository } from './evaluation.repository.js';
import { EvaluationService } from './evaluation.service.js';
import { RouteRegistryRepository } from './route-registry.repository.js';
import { RouteRegistryService } from './route-registry.service.js';
import { ModelCardEvidenceService } from './model-card-evidence.service.js';

/**
 * #587 — a submission linked to a model card, and the card's Model Facts label
 * reading it, over HTTP against a real Postgres with every migration applied
 * (the new `submissions.model_card_id` column and its foreign key included).
 *
 * Real: both controllers, the JWT guards, the services, the repositories, the
 * audit writer and the database. Stubbed: the Cognito signature check (a token
 * is looked up in a table) and the SQS queue, which nothing here reaches.
 *
 * Needs a Docker daemon. CI always has one; a laptop without Docker skips.
 */

vi.hoisted(() => {
  delete process.env.OCI_ENV;
});

const dockerAvailable = await checkDocker('submission-model-card.int.spec');

const ALICE = { token: 'token-alice', sub: randomUUID(), groups: ['researcher'] };
const BOB = { token: 'token-bob', sub: randomUUID(), groups: ['researcher'] };

const verifier = {
  verify: async (token: string) => {
    const who = [ALICE, BOB].find((u) => u.token === token);
    if (!who) throw new Error('signature verification failed');
    return { sub: who.sub, 'cognito:groups': who.groups };
  },
};

/** The reference predictions method version, seeded DECLARED by a migration. */
const REFERENCE_PREDICTIONS_VERSION_ID = '3f0e6a52-0000-4000-8000-000000000012';

const TASK = 'int-587-grading';
const DATASET = 'int-587-dataset';
const IUS = {
  v: 1,
  medicalPurpose: 'triage',
  foreseeableMisuse: 'Use outside the validated population.',
  contraindications: '',
  riskTier: 'II',
};

describe.skipIf(!dockerAvailable)('Submission to model card link against Postgres (#587)', () => {
  let db: MigratedPostgres;
  let prisma: PrismaClient;
  let app: NestFastifyApplication;
  let aliceCardId: string;
  let withdrawnCardId: string;
  let bobCardId: string;
  let approvedVersionId: string;
  let evaluationRepo: EvaluationRepository;

  beforeAll(async () => {
    db = await startMigratedPostgres();
    prisma = db.prisma;

    const mod = await Test.createTestingModule({
      controllers: [EvaluationController, PredictionController],
      providers: [
        EvaluationService,
        EvaluationRepository,
        RouteRegistryService,
        RouteRegistryRepository,
        ModelCardEvidenceService,
        PredictionService,
        PredictionRepository,
        IntendedUseService,
        SubmissionBodyPipe,
        RolesGuard,
        CognitoJwtGuard,
        OptionalCognitoJwtGuard,
        { provide: COGNITO_VERIFIER, useValue: verifier },
        { provide: PrismaService, useValue: { client: prisma } },
        { provide: EvalQueueProvider, useValue: { missingConfig: () => ['OCI_EVAL_QUEUE_URL'] } },
        {
          provide: AUDIT_EMITTER,
          useValue: new AuditEmitter({ prisma: prisma as unknown as AuditPrismaPort }),
        },
      ],
    }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    evaluationRepo = mod.get(EvaluationRepository);

    await prisma.evaluationTask.create({
      data: {
        slug: TASK,
        name: 'Two-grade task',
        datasetSlug: DATASET,
        taskKind: 'GRADING',
        numClasses: 2,
        referableThreshold: 1,
        groundTruth: { img_a: 0, img_b: 1, img_c: 1, img_d: 0 },
      },
    });
    const dataset = await prisma.dataset.create({
      data: { slug: DATASET, name: 'Dataset for #587', hostId: randomUUID() },
    });
    await prisma.datasetVersion.create({
      data: {
        datasetId: dataset.id,
        version: '1.0.0',
        croissant: {},
        publishedById: randomUUID(),
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const cardOf = async (slug: string, owner: { sub: string }, status: string) =>
      (
        await prisma.modelCard.create({
          data: {
            slug,
            submitterUserId: owner.sub,
            intendedUse: IUS,
            modelClass: 'classical',
            architectureSummary: 'CNN.',
            versionMajorMinorPatch: '1.0.0',
            trainingDataJurisdictions: [],
            status: status as 'DRAFT',
          },
        })
      ).id;
    aliceCardId = await cardOf('alice-grader', ALICE, 'PUBLISHED');
    withdrawnCardId = await cardOf('alice-old-grader', ALICE, 'WITHDRAWN');
    bobCardId = await cardOf('bob-grader', BOB, 'SUBMITTED');

    // An approved method version of another route. A submission is pinned to
    // the reference version, seeded DECLARED (#583); the spec moves the result
    // to this one below to see it published.
    const route = await prisma.evaluationRoute.create({
      data: { slug: 'int-587-route', name: 'Route for #587', mode: 'PREDICTIONS' },
    });
    approvedVersionId = (
      await prisma.routeVersion.create({
        data: {
          routeId: route.id,
          version: '2.0.0',
          threatModel: {},
          disclosureProfile: {},
          operationalEnvelope: {},
          reviewStatus: 'APPROVED',
          reviewedAt: new Date(),
        },
      })
    ).id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  const bearer = (who?: { token: string }) =>
    who ? { authorization: `Bearer ${who.token}` } : undefined;

  const PREDICTIONS = [
    { imageId: 'img_a', grade: 0 },
    { imageId: 'img_b', grade: 1 },
    { imageId: 'img_c', grade: 0 },
    { imageId: 'img_d', grade: 0 },
  ];

  function submit(body: Record<string, unknown>, who?: { token: string }) {
    return app.inject({
      method: 'POST',
      url: `/v2/evaluation/tasks/${TASK}/submissions`,
      payload: { methodName: 'm', predictions: PREDICTIONS, ...body },
      headers: bearer(who),
    });
  }

  function link(submissionId: string, modelCardId: string | null, who?: { token: string }) {
    return app.inject({
      method: 'PATCH',
      url: `/v2/evaluation/submissions/${submissionId}/model-card`,
      payload: { modelCardId },
      headers: bearer(who),
    });
  }

  async function facts() {
    const res = await app.inject({
      method: 'GET',
      url: '/v2/prediction/model-cards/alice-grader/model-facts',
    });
    expect(res.statusCode).toBe(200);
    return ModelFactsLabelSchema.parse(res.json());
  }

  async function markdown() {
    const res = await app.inject({
      method: 'GET',
      url: '/v2/prediction/model-cards/alice-grader/model-facts.md',
    });
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  const linkEvents = (submissionId: string) =>
    prisma.auditEvent.findMany({
      where: { subjectType: 'evaluation-submission', subjectId: submissionId },
      orderBy: { sequenceNumber: 'asc' },
      select: { module: true, action: true, actorUserId: true },
    });

  let linkedId: string;

  it('links a scored submission to the submitter’s card at submission time', async () => {
    const res = await submit({ modelCardId: aliceCardId }, ALICE);
    expect(res.statusCode).toBeLessThan(300);
    linkedId = res.json<{ id: string }>().id;

    const row = await prisma.submission.findUniqueOrThrow({ where: { id: linkedId } });
    expect(row.modelCardId).toBe(aliceCardId);
    // Pinned to the reference predictions method, seeded DECLARED (#583).
    expect(row.routeVersionId).toBe(REFERENCE_PREDICTIONS_VERSION_ID);

    const detail = EvaluationSubmissionDetailSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/v2/evaluation/tasks/${TASK}/submissions/${linkedId}`,
        })
      ).json(),
    );
    expect(detail.modelCard).toEqual({
      id: aliceCardId,
      slug: 'alice-grader',
      version: '1.0.0',
      status: 'PUBLISHED',
    });

    expect((await linkEvents(linkedId)).map((e) => `${e.module}.${e.action}`)).toEqual([
      'evaluation.submitted',
      'evaluation.scored',
      'evaluation.submission.modelcard.linked',
    ]);
  });

  it('reads the linked card the way the evidence summary (#652) needs it', async () => {
    expect(await evaluationRepo.findLinkedModelCard(linkedId)).toEqual({
      slug: 'alice-grader',
      versionMajorMinorPatch: '1.0.0',
      status: 'PUBLISHED',
      modelDeveloper: null,
      clinicalSummary: null,
      intendedUse: IUS,
      knownBiasesOrEthicalConsiderations: null,
    });
    expect(await evaluationRepo.findLinkedModelCard(randomUUID())).toBeNull();
  });

  it('shows the result as provisional, never published, while its method version is not approved', async () => {
    const label = await facts();
    expect(label.validationAndPerformance.entries).toEqual([]);
    expect(label.validationAndPerformance.provisional).toHaveLength(1);
    expect(label.validationAndPerformance.provisional[0]).toMatchObject({
      submissionId: linkedId,
      taskSlug: TASK,
      primaryMetricLabel: 'Quadratic-weighted kappa',
      datasetSlug: DATASET,
      datasetVersion: '1.0.0',
      routeSlug: 'oci-predictions-scoring',
      routeVersion: '1.0.0',
      routeReviewStatus: 'DECLARED',
      standing: 'PROVISIONAL',
    });
    expect(label.gaps.join('\n')).toContain('Per-subgroup performance');

    const md = await markdown();
    expect(md).toContain('_None. No linked result comes from an approved');
  });

  it('still shows a result with no method version (scored before #583) as not attributed', async () => {
    await prisma.submission.update({ where: { id: linkedId }, data: { routeVersionId: null } });
    try {
      const label = await facts();
      expect(label.validationAndPerformance.provisional[0]).toMatchObject({
        submissionId: linkedId,
        routeSlug: null,
        standing: 'NOT_ATTRIBUTED',
      });
      expect(await markdown()).toContain('Provisional (no method version recorded)');
    } finally {
      await prisma.submission.update({
        where: { id: linkedId },
        data: { routeVersionId: REFERENCE_PREDICTIONS_VERSION_ID },
      });
    }
  });

  it('shows it as published once it comes from an approved method version', async () => {
    await prisma.submission.update({
      where: { id: linkedId },
      data: { routeVersionId: approvedVersionId },
    });

    const label = await facts();
    expect(label.validationAndPerformance.provisional).toEqual([]);
    expect(label.validationAndPerformance.entries).toHaveLength(1);
    expect(label.validationAndPerformance.entries[0]).toMatchObject({
      submissionId: linkedId,
      routeSlug: 'int-587-route',
      routeVersion: '2.0.0',
      routeReviewStatus: 'APPROVED',
      standing: 'PUBLISHED',
    });
    expect(await markdown()).toContain('| int-587-route 2.0.0 | Published |');
  });

  it('refuses a link to someone else’s card (403), a withdrawn card (409) or an unknown one (404), writing nothing', async () => {
    const before = await prisma.submission.count();
    expect((await submit({ modelCardId: bobCardId }, ALICE)).statusCode).toBe(403);
    expect((await submit({ modelCardId: withdrawnCardId }, ALICE)).statusCode).toBe(409);
    expect((await submit({ modelCardId: randomUUID() }, ALICE)).statusCode).toBe(404);
    expect(await prisma.submission.count()).toBe(before);
  });

  it('links, refuses and unlinks after the fact through the PATCH endpoint', async () => {
    const res = await submit({}, ALICE);
    const id = res.json<{ id: string }>().id;

    expect((await link(id, aliceCardId)).statusCode).toBe(401);
    expect((await link(id, aliceCardId, BOB)).statusCode).toBe(403);
    expect((await link(id, bobCardId, ALICE)).statusCode).toBe(403);
    expect((await link(id, withdrawnCardId, ALICE)).statusCode).toBe(409);
    expect((await link(id, randomUUID(), ALICE)).statusCode).toBe(404);
    expect((await link(randomUUID(), aliceCardId, ALICE)).statusCode).toBe(404);
    expect((await prisma.submission.findUniqueOrThrow({ where: { id } })).modelCardId).toBeNull();

    const linked = await link(id, aliceCardId, ALICE);
    expect(linked.statusCode).toBe(200);
    expect(LinkSubmissionModelCardResponseSchema.parse(linked.json()).modelCard?.id).toBe(
      aliceCardId,
    );
    // Restating it changes nothing and records nothing.
    expect((await link(id, aliceCardId, ALICE)).statusCode).toBe(200);
    expect((await facts()).validationAndPerformance.provisional).toHaveLength(1);

    const unlinked = await link(id, null, ALICE);
    expect(unlinked.statusCode).toBe(200);
    expect(unlinked.json()).toEqual({ submissionId: id, modelCard: null });
    expect((await prisma.submission.findUniqueOrThrow({ where: { id } })).modelCardId).toBeNull();

    const events = await linkEvents(id);
    const aliceId = (await prisma.submission.findUniqueOrThrow({ where: { id } })).submittedBy;
    expect(events.map((e) => `${e.module}.${e.action}`)).toEqual([
      'evaluation.submitted',
      'evaluation.scored',
      'evaluation.submission.modelcard.linked',
      'evaluation.submission.modelcard.unlinked',
    ]);
    expect(events.at(-1)?.actorUserId).toBe(aliceId);
  });

  it('refuses to delete a card that results are linked to (ON DELETE RESTRICT)', async () => {
    await expect(prisma.modelCard.delete({ where: { id: aliceCardId } })).rejects.toThrow();
    expect(await prisma.modelCard.count({ where: { id: aliceCardId } })).toBe(1);
  });
});

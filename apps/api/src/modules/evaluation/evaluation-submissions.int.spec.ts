import { randomUUID } from 'node:crypto';
import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuditEmitter, canonicalSha256, type AuditPrismaPort } from '@oci/audit';
import type { PrismaClient } from '@oci/database';
import {
  EvaluationSubmissionDetailSchema,
  ScoredSubmissionQuotaSummarySchema,
  SubmissionValidationReportSchema,
  type SubmissionMode,
  type SubmissionStatus,
} from '@oci/shared-types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { COGNITO_VERIFIER, CognitoJwtGuard } from '../../auth/cognito-jwt.guard.js';
import { OptionalCognitoJwtGuard } from '../../auth/optional-cognito-jwt.guard.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { PrismaService } from '../../prisma.service.js';
import { AUDIT_EMITTER } from '../audit/audit.tokens.js';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  startMigratedPostgres,
} from '../../test-support/migrated-postgres.js';
import { SubmissionBodyPipe } from './dto/submission-body.pipe.js';
import { EvalQueueProvider } from './eval-queue.js';
import { EvaluationController } from './evaluation.controller.js';
import { EvaluationRepository } from './evaluation.repository.js';
import { EvaluationService } from './evaluation.service.js';
import { consumesScoredQuota } from './submission-quota.js';

/**
 * #645 — submitting, the quota and reading one submission, over HTTP against a
 * real Postgres with every migration applied.
 *
 * What is real: the controller, both JWT guards, the body pipe, the service,
 * the repository and the database. What is stubbed: only the Cognito signature
 * check (a token is looked up in a table instead of verified against a JWKS)
 * and the SQS queue, which no test here reaches. So "no token", "a token that
 * does not verify" and "someone else's token" each take the path they take in
 * a deployed environment.
 *
 * Needs a Docker daemon. CI (`CI=true`) always has one and runs this spec; a
 * laptop without Docker skips it rather than failing `pnpm test`.
 */

// The JWT guard reads OCI_ENV when its module loads, and in local mode invents
// a user for every request. That stub must not be what these tests exercise.
vi.hoisted(() => {
  delete process.env.OCI_ENV;
});

const dockerAvailable = await checkDocker('evaluation-submissions.int.spec');

const ALICE = { token: 'token-alice', sub: randomUUID(), groups: ['researcher'] };
const BOB = { token: 'token-bob', sub: randomUUID(), groups: ['researcher'] };
const ADMIN = { token: 'token-admin', sub: randomUUID(), groups: ['admin'] };
const CAROL = { token: 'token-carol', sub: randomUUID(), groups: [] as string[] };

/** Stands in for the Cognito verifier: known tokens verify, anything else throws. */
const verifier = {
  verify: async (token: string) => {
    const who = [ALICE, BOB, ADMIN, CAROL].find((u) => u.token === token);
    if (!who) throw new Error('signature verification failed');
    return { sub: who.sub, 'cognito:groups': who.groups };
  },
};

const GRADING = 'int-645-grading';
const CLASSES = 'int-645-classes';

/** Limits small enough to hit inside one test. */
const PER_WEEK = 2;
const PER_TASK = 3;

describe.skipIf(!dockerAvailable)(
  'Evaluation submissions over HTTP against Postgres (#645)',
  () => {
    let db: MigratedPostgres;
    let prisma: PrismaClient;
    let app: NestFastifyApplication;
    let repo: EvaluationRepository;
    let gradingTaskId: string;
    const savedEnv = {
      week: process.env.OCI_EVAL_SCORED_PER_WEEK,
      task: process.env.OCI_EVAL_SCORED_PER_TASK,
    };

    beforeAll(async () => {
      db = await startMigratedPostgres();
      prisma = db.prisma;

      // The service resolves its limits once, when it is constructed.
      process.env.OCI_EVAL_SCORED_PER_WEEK = String(PER_WEEK);
      process.env.OCI_EVAL_SCORED_PER_TASK = String(PER_TASK);

      const mod = await Test.createTestingModule({
        controllers: [EvaluationController],
        providers: [
          EvaluationService,
          EvaluationRepository,
          SubmissionBodyPipe,
          RolesGuard,
          CognitoJwtGuard,
          OptionalCognitoJwtGuard,
          { provide: COGNITO_VERIFIER, useValue: verifier },
          { provide: PrismaService, useValue: { client: prisma } },
          { provide: EvalQueueProvider, useValue: { missingConfig: () => ['OCI_EVAL_QUEUE_URL'] } },
          // The real writer: the audit events land in the migrated database,
          // where the triggers chain them (#653).
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
      repo = mod.get(EvaluationRepository);

      gradingTaskId = (
        await prisma.evaluationTask.create({
          data: {
            slug: GRADING,
            name: 'Binary finding',
            datasetSlug: 'int-645-dataset',
            taskKind: 'GRADING',
            numClasses: 2,
            referableThreshold: 1,
            groundTruth: { img_a: 0, img_b: 1, img_c: 1, img_d: 0 },
          },
        })
      ).id;
      await prisma.evaluationTask.create({
        data: {
          slug: CLASSES,
          name: 'Three findings',
          datasetSlug: 'int-645-dataset',
          taskKind: 'CLASSIFICATION',
          numClasses: 3,
          referableThreshold: 1,
          groundTruth: { img_a: 0, img_b: 1, img_c: 2, img_d: 1 },
        },
      });
    }, 180_000);

    afterAll(async () => {
      process.env.OCI_EVAL_SCORED_PER_WEEK = savedEnv.week;
      process.env.OCI_EVAL_SCORED_PER_TASK = savedEnv.task;
      if (savedEnv.week === undefined) delete process.env.OCI_EVAL_SCORED_PER_WEEK;
      if (savedEnv.task === undefined) delete process.env.OCI_EVAL_SCORED_PER_TASK;
      await app?.close();
      await db?.stop();
    });

    const bearer = (who?: { token: string }) =>
      who ? { authorization: `Bearer ${who.token}` } : undefined;

    function post(slug: string, body: unknown, who?: { token: string }) {
      return app.inject({
        method: 'POST',
        url: `/v2/evaluation/tasks/${slug}/submissions`,
        payload: body as Record<string, unknown>,
        headers: bearer(who),
      });
    }

    function get(path: string, who?: { token: string }) {
      return app.inject({ method: 'GET', url: `/v2/evaluation${path}`, headers: bearer(who) });
    }

    const GOOD = [
      { imageId: 'img_a', grade: 0 },
      { imageId: 'img_b', grade: 1 },
      { imageId: 'img_c', grade: 0 },
    ];
    const DUPLICATED = [...GOOD, { imageId: 'img_a', grade: 1 }];

    async function quotaOf(who: { token: string }, slug = GRADING) {
      const res = await get(`/tasks/${slug}/quota`, who);
      expect(res.statusCode).toBe(200);
      return ScoredSubmissionQuotaSummarySchema.parse(res.json());
    }

    describe('the format check', () => {
      it('answers without a token, names the identifiers, and stores nothing', async () => {
        const before = await prisma.submission.count();

        const res = await post(GRADING, {
          methodName: 'format check',
          intent: 'VALIDATION',
          predictions: [...DUPLICATED, { imageId: 'not_in_task', grade: 1 }],
        });

        // Success, whatever the checks found. The endpoint is a POST with no
        // explicit status, so Nest answers 201 today; what matters to a caller is
        // that it is not a 401 and not a 4xx for a file with problems in it.
        expect(res.statusCode).toBeGreaterThanOrEqual(200);
        expect(res.statusCode).toBeLessThan(300);

        const report = SubmissionValidationReportSchema.parse(res.json());
        expect(report.ok).toBe(false);
        expect(report.quotaConsumed).toBe(false);
        expect(report.submissionId).toBeNull();
        const check = (name: string) => report.checks.find((c) => c.name === name);
        expect(check('DUPLICATE_ITEM_IDS')?.itemIds).toEqual(['img_a']);
        expect(check('ITEM_IDS_RECOGNISED')?.itemIds).toEqual(['not_in_task']);
        // img_d was left out: reported as a count, and allowed.
        expect(report.itemIdSummary?.notPredicted).toBe(1);

        expect(await prisma.submission.count()).toBe(before);
      });

      it('refuses a token that does not verify, rather than treating the caller as anonymous', async () => {
        const res = await post(
          GRADING,
          { methodName: 'm', intent: 'VALIDATION', predictions: GOOD },
          { token: 'forged' },
        );
        expect(res.statusCode).toBe(401);
      });

      it('leaves the quota of a signed-in caller untouched', async () => {
        const before = await quotaOf(CAROL);
        for (let i = 0; i < PER_TASK + 2; i += 1) {
          const res = await post(
            GRADING,
            { methodName: 'm', intent: 'VALIDATION', predictions: GOOD },
            CAROL,
          );
          expect(res.statusCode).toBeLessThan(300);
        }
        expect(await quotaOf(CAROL)).toEqual(before);
      });
    });

    describe('a scored submission', () => {
      it('needs a token, and writes nothing without one', async () => {
        const before = await prisma.submission.count();
        const res = await post(GRADING, { methodName: 'm', predictions: GOOD });
        expect(res.statusCode).toBe(401);
        expect(await prisma.submission.count()).toBe(before);
      });

      it('does not spend quota on a format error, and does on a scored result', async () => {
        // More format failures than the task total allows scored submissions:
        // if they counted, the participant would be locked out before scoring once.
        const failedIds: string[] = [];
        for (let i = 0; i < PER_TASK + 1; i += 1) {
          const res = await post(GRADING, { methodName: 'typo', predictions: DUPLICATED }, ALICE);
          expect(res.statusCode).toBe(400);
          const body = res.json<{ message: string; submissionId: string }>();
          expect(body.message).toBe('duplicate imageId "img_a" in predictions');
          failedIds.push(body.submissionId);
        }
        // A label outside the task's range is the other format failure.
        const outOfRange = await post(
          GRADING,
          { methodName: 'typo', predictions: [{ imageId: 'img_a', grade: 2 }] },
          ALICE,
        );
        expect(outOfRange.statusCode).toBe(400);

        // The attempts are on record…
        const stored = await prisma.submission.findMany({
          where: { submittedBy: ALICE.sub, taskId: gradingTaskId },
          select: { status: true, mode: true },
        });
        expect(stored).toHaveLength(PER_TASK + 2);
        expect(stored.every((s) => s.status === 'FAILED' && s.mode === 'PREDICTIONS')).toBe(true);

        // …and none of them cost anything.
        const untouched = await quotaOf(ALICE);
        expect(untouched.week).toMatchObject({ limit: PER_WEEK, used: 0, remaining: PER_WEEK });
        expect(untouched.total).toMatchObject({ limit: PER_TASK, used: 0, remaining: PER_TASK });
        expect(untouched.remaining).toBe(PER_WEEK);

        // Scored submissions do count, one each, until the weekly limit refuses.
        for (let i = 0; i < PER_WEEK; i += 1) {
          const res = await post(GRADING, { methodName: `run ${i}`, predictions: GOOD }, ALICE);
          expect(res.statusCode).toBeLessThan(300);
          expect((await quotaOf(ALICE)).remaining).toBe(PER_WEEK - i - 1);
        }
        const refused = await post(
          GRADING,
          { methodName: 'one too many', predictions: GOOD },
          ALICE,
        );
        expect(refused.statusCode).toBe(403);
        expect(refused.json<{ quota: { scope: string; used: number } }>().quota).toMatchObject({
          scope: 'WEEK',
          used: PER_WEEK,
        });

        // The quota is per task: the other task is untouched.
        expect((await quotaOf(ALICE, CLASSES)).remaining).toBe(PER_WEEK);
      });

      it('puts a scored submission in the audit trail with its two events, and a refused one with one (#653)', async () => {
        const scoredRes = await post(GRADING, { methodName: 'audited', predictions: GOOD }, CAROL);
        expect(scoredRes.statusCode).toBeLessThan(300);
        const scoredId = scoredRes.json<{ id: string }>().id;
        const refusedRes = await post(
          GRADING,
          { methodName: 'audited', predictions: DUPLICATED },
          CAROL,
        );
        expect(refusedRes.statusCode).toBe(400);
        const refusedId = refusedRes.json<{ submissionId: string }>().submissionId;

        const scored = await prisma.auditEvent.findMany({
          where: { subjectId: scoredId },
          orderBy: { sequenceNumber: 'asc' },
        });
        expect(scored.map((e) => `${e.module}.${e.action}`)).toEqual([
          'evaluation.submitted',
          'evaluation.scored',
        ]);
        for (const e of scored) {
          expect(e.actorUserId).toBe(CAROL.sub);
          expect(e.recordHash).toMatch(/^[0-9a-f]{64}$/);
          expect(e.payload).toMatchObject({ predictionsSha256: canonicalSha256(GOOD) });
        }

        const refused = await prisma.auditEvent.findMany({ where: { subjectId: refusedId } });
        expect(refused.map((e) => `${e.module}.${e.action}`)).toEqual(['evaluation.failed']);
        expect(refused[0]?.payload).toMatchObject({
          predictionsSha256: canonicalSha256(DUPLICATED),
        });

        // No item id (and so no prediction and no label) in any of them.
        for (const e of [...scored, ...refused]) {
          expect(JSON.stringify(e.payload)).not.toMatch(/img_[a-d]/);
        }
      });

      it('counts a failed sealed run, which did hold an evaluation slot', async () => {
        await prisma.submission.create({
          data: {
            taskId: gradingTaskId,
            methodName: 'container',
            submittedBy: BOB.sub,
            mode: 'CONTAINER',
            status: 'FAILED',
            error: 'The run exceeded its time limit.',
            failureCode: 'TIMEOUT',
          },
        });
        expect((await quotaOf(BOB)).week.used).toBe(1);
      });

      it('counts in the database exactly the rows consumesScoredQuota says count', async () => {
        const submittedBy = randomUUID();
        const modes: SubmissionMode[] = ['PREDICTIONS', 'CONTAINER', 'ENCRYPTED'];
        const statuses: SubmissionStatus[] = ['PENDING', 'SCORED', 'FAILED'];
        const rows = modes.flatMap((mode) => statuses.map((status) => ({ mode, status })));
        await prisma.submission.createMany({
          data: rows.map((r) => ({
            ...r,
            taskId: gradingTaskId,
            methodName: 'matrix',
            submittedBy,
          })),
        });

        const counted = await repo.countScoredSubmissionsForParticipant({
          taskId: gradingTaskId,
          submittedBy,
        });
        expect(counted).toBe(rows.filter(consumesScoredQuota).length);
        expect(counted).toBe(rows.length - 1);
      });

      it('refuses the quota read without a token', async () => {
        expect((await get(`/tasks/${GRADING}/quota`)).statusCode).toBe(401);
      });
    });

    describe('reading one submission', () => {
      let failedId: string;
      let scoredId: string;

      beforeAll(async () => {
        // Bob has at most one counted row before this (the sealed-run test), so
        // the scored submission fits inside his weekly limit either way.
        const failed = await post(
          GRADING,
          { methodName: 'bob typo', predictions: DUPLICATED },
          BOB,
        );
        failedId = failed.json<{ submissionId: string }>().submissionId;
        const scored = await post(GRADING, { methodName: 'bob model', predictions: GOOD }, BOB);
        scoredId = scored.json<{ id: string }>().id;
        expect(failedId).toBeTruthy();
        expect(scoredId).toBeTruthy();
      });

      it('shows a failed submission to its submitter, with the reason', async () => {
        const res = await get(`/tasks/${GRADING}/submissions/${failedId}`, BOB);
        expect(res.statusCode).toBe(200);
        const detail = EvaluationSubmissionDetailSchema.parse(res.json());
        expect(detail.status).toBe('FAILED');
        expect(detail.viewerIsSubmitter).toBe(true);
        expect(detail.scores).toBeNull();
        expect(detail.failure).toEqual({
          reason: 'duplicate imageId "img_a" in predictions',
          quotaConsumed: false,
        });
      });

      it('shows it to an administrator, who is not marked as the submitter', async () => {
        const res = await get(`/tasks/${GRADING}/submissions/${failedId}`, ADMIN);
        expect(res.statusCode).toBe(200);
        const detail = EvaluationSubmissionDetailSchema.parse(res.json());
        expect(detail.viewerIsSubmitter).toBe(false);
        expect(detail.failure?.reason).toBe('duplicate imageId "img_a" in predictions');
      });

      it('hides it from another participant and from a signed-out caller, as if it did not exist', async () => {
        const other = await get(`/tasks/${GRADING}/submissions/${failedId}`, ALICE);
        const anonymous = await get(`/tasks/${GRADING}/submissions/${failedId}`);
        const missing = await get(`/tasks/${GRADING}/submissions/${randomUUID()}`, ALICE);

        expect(other.statusCode).toBe(404);
        expect(anonymous.statusCode).toBe(404);
        expect(missing.statusCode).toBe(404);
        // Same shape of answer for "not yours" and "not there".
        const shape = (body: string) => body.replace(/[0-9a-f-]{36}/g, '<id>');
        expect(shape(other.body)).toBe(shape(missing.body));
        expect(other.body).not.toContain('duplicate');
      });

      it('reports a failed sealed run as having used quota', async () => {
        const row = await prisma.submission.create({
          data: {
            taskId: gradingTaskId,
            methodName: 'container',
            submittedBy: CAROL.sub,
            mode: 'CONTAINER',
            status: 'FAILED',
            error: 'The run exceeded its time limit.',
            failureCode: 'TIMEOUT',
          },
          select: { id: true },
        });
        const res = await get(`/tasks/${GRADING}/submissions/${row.id}`, CAROL);
        expect(EvaluationSubmissionDetailSchema.parse(res.json()).failure).toEqual({
          reason: 'The run exceeded its time limit.',
          quotaConsumed: true,
        });
      });

      it('shows a scored submission to anyone, with its metrics and nothing private', async () => {
        const res = await get(`/tasks/${GRADING}/submissions/${scoredId}`);
        expect(res.statusCode).toBe(200);

        const detail = EvaluationSubmissionDetailSchema.parse(res.json());
        expect(detail).toMatchObject({
          id: scoredId,
          methodName: 'bob model',
          mode: 'PREDICTIONS',
          status: 'SCORED',
          failure: null,
          viewerIsSubmitter: false,
          task: { slug: GRADING, taskKind: 'GRADING', numClasses: 2, referableThreshold: 1 },
        });
        // img_a 0/0, img_b 1/1, img_c 1/0 scored; img_d not predicted.
        expect(detail.scores).toEqual({
          kind: 'GRADING',
          metrics: expect.objectContaining({
            accuracy: 0.6667,
            referableSensitivity: 0.5,
            referableSpecificity: 1,
            coverage: 0.75,
          }),
        });
        // A direct submission is not pinned to a route version yet (#583).
        expect(detail.attribution?.kind).toBe('LEGACY');

        // The schema is strict, so the parse above already refuses extra keys.
        // Say the important ones out loud anyway.
        expect(res.body).not.toContain(BOB.sub);
        expect(res.body).not.toContain('groundTruth');
        expect(res.body).not.toContain('submittedBy');
      });

      it('tells the submitter the scored submission is theirs', async () => {
        const res = await get(`/tasks/${GRADING}/submissions/${scoredId}`, BOB);
        expect(EvaluationSubmissionDetailSchema.parse(res.json()).viewerIsSubmitter).toBe(true);
      });

      it('answers only under the task the submission belongs to', async () => {
        const res = await get(`/tasks/${CLASSES}/submissions/${scoredId}`, BOB);
        expect(res.statusCode).toBe(404);
      });

      it('refuses an id that is not a uuid', async () => {
        const res = await get(`/tasks/${GRADING}/submissions/not-a-uuid`);
        expect(res.statusCode).toBe(400);
      });

      it('carries the per-class breakdown for a classification task', async () => {
        const scored = await post(
          CLASSES,
          {
            methodName: 'three classes',
            predictions: [
              { imageId: 'img_a', grade: 0 },
              { imageId: 'img_b', grade: 1 },
              { imageId: 'img_c', grade: 1 },
              { imageId: 'img_d', grade: 1 },
            ],
          },
          BOB,
        );
        const id = scored.json<{ id: string }>().id;

        const res = await get(`/tasks/${CLASSES}/submissions/${id}`);
        const detail = EvaluationSubmissionDetailSchema.parse(res.json());
        if (detail.scores?.kind !== 'CLASSIFICATION') throw new Error('expected classification');
        expect(detail.scores.metrics.perClass).toEqual([
          { label: 0, precision: 1, recall: 1, f1: 1, support: 1 },
          { label: 1, precision: 0.6667, recall: 1, f1: 0.8, support: 2 },
          { label: 2, precision: 0, recall: 0, f1: 0, support: 1 },
        ]);
      });
    });

    describe('results by subgroup (#410)', () => {
      const SLUG = 'int-410-subgroups';
      // 64 items: site A 40, site B 20, site C 4. Site C is too small to publish,
      // and site B must then go too, or C would be the total minus A and B.
      const ids = Array.from({ length: 64 }, (_, i) => `s${String(i).padStart(2, '0')}`);
      const siteOf = (i: number) => (i < 40 ? 'A' : i < 60 ? 'B' : 'C');
      const groundTruth = Object.fromEntries(ids.map((id, i) => [id, i % 2]));
      const subgroups = {
        fields: [
          {
            key: 'site',
            label: 'Site',
            values: ['A', 'B', 'C'].map((v) => ({ value: v, label: `Site ${v}` })),
          },
          {
            key: 'sex',
            label: 'Sex',
            values: [
              { value: 'F', label: 'Female' },
              { value: 'M', label: 'Male' },
            ],
          },
        ],
        values: Object.fromEntries(
          ids.map((id, i) => [id, { site: siteOf(i), sex: i % 4 < 2 ? 'F' : 'M' }]),
        ),
      };
      const createTask = (body: unknown) =>
        app.inject({
          method: 'POST',
          url: '/v2/evaluation/tasks',
          payload: body as Record<string, unknown>,
          headers: bearer(ADMIN),
        });

      it('refuses a task whose map leaves an item without a value, naming no value', async () => {
        const values: Record<string, Record<string, string>> = { ...subgroups.values };
        delete values['s07'];
        const res = await createTask({
          slug: `${SLUG}-bad`,
          name: 'Bad',
          datasetSlug: 'int-410',
          taskKind: 'CLASSIFICATION',
          numClasses: 2,
          referableThreshold: 1,
          groundTruth,
          subgroups: { ...subgroups, values },
        });
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain('item \\"s07\\" has no subgroup values');
        expect(await prisma.evaluationTask.count({ where: { slug: `${SLUG}-bad` } })).toBe(0);
      });

      it('creates a task with fields, scores by subgroup and publishes what was stored', async () => {
        const created = await createTask({
          slug: SLUG,
          name: 'By site',
          datasetSlug: 'int-410',
          taskKind: 'CLASSIFICATION',
          numClasses: 2,
          referableThreshold: 1,
          groundTruth,
          subgroups,
        });
        expect(created.statusCode).toBe(201);
        const stored = await prisma.evaluationTask.findUniqueOrThrow({ where: { slug: SLUG } });
        expect(stored.subgroupValues).toEqual(subgroups.values);

        // The task publishes the declaration, never which item has which value.
        const task = await get(`/tasks/${SLUG}`);
        expect(task.json<{ subgroupFields: unknown }>().subgroupFields).toEqual(subgroups.fields);
        expect(task.body).not.toContain('"s07":{');
        expect(task.body).not.toContain('subgroupValues');

        // Wrong on every site-B item; right elsewhere.
        const predictions = ids.map((id, i) => ({
          imageId: id,
          grade: siteOf(i) === 'B' ? 1 - (i % 2) : i % 2,
        }));
        const scored = await post(SLUG, { methodName: 'by site', predictions }, CAROL);
        expect(scored.statusCode).toBe(201);
        const id = scored.json<{ id: string }>().id;

        const res = await get(`/tasks/${SLUG}/submissions/${id}`);
        const detail = EvaluationSubmissionDetailSchema.parse(res.json());
        const [site, sex] = detail.subgroups?.fields ?? [];
        expect(site?.cells).toEqual([
          {
            status: 'REPORTED',
            value: 'A',
            label: 'Site A',
            itemCount: 40,
            scoredCount: 40,
            metrics: { kind: 'CLASSIFICATION', accuracy: 1, balancedAccuracy: 1, macroF1: 1 },
          },
          { status: 'SUPPRESSED', value: 'B', label: 'Site B' },
          { status: 'SUPPRESSED', value: 'C', label: 'Site C' },
        ]);
        expect(sex?.cells.map((c) => c.status)).toEqual(['REPORTED', 'REPORTED']);

        // The row holds exactly what was published: no figure for site B or C.
        const row = await prisma.submission.findUniqueOrThrow({ where: { id } });
        expect(row.subgroupScores).toEqual(detail.subgroups);
        expect(JSON.stringify(row.subgroupScores)).not.toMatch(/"value":"[BC]","label":"[^"]+","/);

        // The submitter and an administrator read the same withheld groups.
        for (const who of [CAROL, ADMIN]) {
          const again = EvaluationSubmissionDetailSchema.parse(
            (await get(`/tasks/${SLUG}/submissions/${id}`, who)).json(),
          );
          expect(again.subgroups).toEqual(detail.subgroups);
        }
      });
    });
  },
);

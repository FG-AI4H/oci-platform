import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AuditEmitter, type AuditPrismaPort } from '@oci/audit';
import type { PrismaClient } from '@oci/database';
import {
  SubmitPredictionsRequestSchema,
  type CreateRouteVersionRequest,
  type ScoreAttribution,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EvalQueueProvider } from '../modules/evaluation/eval-queue.js';
import { EvaluationRepository } from '../modules/evaluation/evaluation.repository.js';
import { EvaluationService } from '../modules/evaluation/evaluation.service.js';
import { RouteRegistryRepository } from '../modules/evaluation/route-registry.repository.js';
import { RouteRegistryService } from '../modules/evaluation/route-registry.service.js';
import type { PrismaService } from '../prisma.service.js';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  replaySeedFile,
  startMigratedPostgres,
} from '../test-support/migrated-postgres.js';

/**
 * #583, as the December 2026 workshop exercise (#649) runs it: on a database
 * with every migration and the `radiology-workshop` profile, a participant's
 * result on `nih-chestxray14-finding` is pinned to the method version that
 * serves predictions, shows as provisional, and shows as published once a
 * reviewer approves that version. Nothing is mocked but the identities.
 *
 * Review is in pairs as the platform defines it: whoever registered the
 * method or declared the version may not review it, and one evaluation
 * reviewer records the decision. A second reviewer's sign-off is not
 * something the platform records.
 *
 * Needs a Docker daemon. CI always has one; a laptop without Docker skips.
 */
const dockerAvailable = await checkDocker('radiology-workshop-method-review.int.spec');

const here = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.resolve(
  here,
  '../../../../packages/database/seed/profiles/radiology-workshop',
);
const DATASET = 'nih-chestxray14-workshop';
const TASK = 'nih-chestxray14-finding';
const METHOD = 'oci-predictions-scoring';

const profileSql = readFileSync(path.join(PROFILE_DIR, 'seed.sql'), 'utf8');

const predictions = (file: string) =>
  readFileSync(path.join(PROFILE_DIR, 'fixtures', DATASET, file), 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const [imageId = '', label = ''] = line.split(',');
      return { imageId, grade: Number(label) };
    });

function person(...groups: string[]): CognitoAccessTokenPayload {
  return { sub: randomUUID(), 'cognito:groups': groups } as unknown as CognitoAccessTokenPayload;
}

const PARTICIPANT = person('researcher');
const REVIEWER = person('evaluation-reviewer');
const OPERATOR = person('admin');
const BYSTANDER = person('researcher');

const TIMEOUT = { timeout: 120_000 };

describe.skipIf(!dockerAvailable)(
  'radiology-workshop: a result moves from provisional to published when its method version is approved (#583, #649)',
  TIMEOUT,
  () => {
    let db: MigratedPostgres;
    let prisma: PrismaClient;
    let evaluation: EvaluationService;
    let routes: RouteRegistryService;

    beforeAll(async () => {
      db = await startMigratedPostgres();
      prisma = db.prisma;
      replaySeedFile(db.url, profileSql);
      const prismaService = { client: prisma } as unknown as PrismaService;
      const audit = new AuditEmitter({ prisma: prisma as unknown as AuditPrismaPort });
      routes = new RouteRegistryService(new RouteRegistryRepository(prismaService), audit);
      evaluation = new EvaluationService(
        new EvaluationRepository(prismaService),
        new EvalQueueProvider(),
        audit,
        routes,
      );
    }, 180_000);

    afterAll(async () => {
      await db?.stop();
    });

    const submit = async (file: string) =>
      (
        await evaluation.submitPredictions(
          TASK,
          SubmitPredictionsRequestSchema.parse({
            methodName: file,
            predictions: predictions(file),
          }),
          PARTICIPANT,
        )
      ).id;

    /** The result as the task page reads it. */
    const attributionOf = async (id: string): Promise<ScoreAttribution | null> =>
      (await evaluation.getTaskDetail(TASK)).submissions.find((s) => s.id === id)?.attribution ??
      null;

    const review = (
      version: string,
      status: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED',
      who = REVIEWER,
    ) =>
      routes.review(
        METHOD,
        version,
        { status, reviewNotes: status === 'UNDER_REVIEW' ? null : `Decision on ${version}.` },
        who,
      );

    let first = '';

    it('seeds no method of its own: the task is served by the reference method, DECLARED', async () => {
      const route = await routes.getRoute(METHOD);
      expect(route.isReference).toBe(true);
      expect(route.mode).toBe('PREDICTIONS');
      expect(route.versions.map((v) => [v.version, v.reviewStatus])).toEqual([
        ['1.0.0', 'DECLARED'],
      ]);
    });

    it('pins a participant’s result to that version and shows it as provisional', async () => {
      first = await submit('model-a.csv');

      const row = await prisma.submission.findUniqueOrThrow({ where: { id: first } });
      const version = await prisma.routeVersion.findUniqueOrThrow({
        where: { id: row.routeVersionId ?? '' },
        include: { route: true },
      });
      expect([version.route.slug, version.version, row.routeVersion]).toEqual([
        METHOD,
        '1.0.0',
        '1.0.0',
      ]);
      expect(row.routeId).toBe(version.routeId);

      expect(await attributionOf(first)).toEqual({
        kind: 'ROUTED',
        routeSlug: METHOD,
        routeVersion: '1.0.0',
        reviewStatus: 'DECLARED',
        published: false,
        retractedAt: null,
      });
    });

    it('keeps it provisional while the version is under review', async () => {
      await review('1.0.0', 'UNDER_REVIEW');
      expect(await attributionOf(first)).toMatchObject({
        reviewStatus: 'UNDER_REVIEW',
        published: false,
      });
    });

    it('lets no one but an evaluation reviewer approve it', async () => {
      await expect(review('1.0.0', 'APPROVED', BYSTANDER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(await attributionOf(first)).toMatchObject({ published: false });
    });

    it('shows the same result as published once a reviewer approves the version', async () => {
      await review('1.0.0', 'APPROVED');
      expect(await attributionOf(first)).toEqual({
        kind: 'ROUTED',
        routeSlug: METHOD,
        routeVersion: '1.0.0',
        reviewStatus: 'APPROVED',
        published: true,
        retractedAt: null,
      });
    });

    let second = '';

    it('pins a later result to a newly declared version, provisional again; the earlier stays published', async () => {
      const declared = (await routes.getRoute(METHOD)).versions[0];
      if (!declared) throw new Error('no version 1.0.0');
      const next: CreateRouteVersionRequest = {
        version: '1.0.1',
        threatModel: declared.threatModel,
        disclosureProfile: declared.disclosureProfile,
        operationalEnvelope: declared.operationalEnvelope,
      };
      // The reference method has no recorded submitter, so an administrator declares.
      await routes.declareVersion(METHOD, next, OPERATOR);

      second = await submit('model-b.csv');
      expect(await attributionOf(second)).toMatchObject({
        routeVersion: '1.0.1',
        reviewStatus: 'DECLARED',
        published: false,
      });
      expect(await attributionOf(first)).toMatchObject({ routeVersion: '1.0.0', published: true });
    });

    it('does not let whoever declared the version approve it, administrator or not', async () => {
      await review('1.0.1', 'UNDER_REVIEW');
      await expect(review('1.0.1', 'APPROVED', OPERATOR)).rejects.toThrow(
        `you submitted route ${METHOD}@1.0.1 and cannot review it`,
      );
      expect(await attributionOf(second)).toMatchObject({ published: false });
    });

    it('refuses the next submission with a 409, writing nothing, once the serving version is rejected', async () => {
      await review('1.0.1', 'REJECTED');
      // The result it already produced is kept and reads as withdrawn, as before #583.
      expect(await attributionOf(second)).toMatchObject({
        reviewStatus: 'REJECTED',
        published: false,
        retractedAt: null,
      });

      const before = await prisma.submission.count();
      const refused = await submit('model-a.csv').catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(ConflictException);
      expect((refused as ConflictException).getResponse()).toMatchObject({
        statusCode: 409,
        code: 'NO_METHOD_VERSION',
        reason: 'VERSION_CLOSED',
      });
      expect(await prisma.submission.count()).toBe(before);
    });
  },
);

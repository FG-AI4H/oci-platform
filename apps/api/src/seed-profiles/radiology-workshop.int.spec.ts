import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@oci/database';
import { SubmitPredictionsRequestSchema } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EvalQueueProvider } from '../modules/evaluation/eval-queue.js';
import { EvaluationRepository } from '../modules/evaluation/evaluation.repository.js';
import { EvaluationService } from '../modules/evaluation/evaluation.service.js';
import { scoreClassification } from '../modules/evaluation/scoring-classification.js';
import type { PrismaService } from '../prisma.service.js';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  replaySeedFile,
  startMigratedPostgres,
} from '../test-support/migrated-postgres.js';
import { snapshotLines, snapshotTables } from '../test-support/table-snapshot.raw.js';

/**
 * #644: the `radiology-workshop` seed profile against a real Postgres with
 * every migration applied. Nothing is mocked: the committed `seed.sql` is
 * replayed the way the migrate entrypoint replays it, the teaching files are
 * scored by the real evaluation service, and the reset is the script the
 * migrate image runs, started as a child process.
 *
 * The profile's content is the SYNTHETIC STAND-IN committed in the
 * repository. No real image, label or metadata file is involved.
 *
 * Needs a Docker daemon. CI always has one; a laptop without Docker skips.
 */
const dockerAvailable = await checkDocker('radiology-workshop.int.spec');

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../../../..');
const SEED_DIR = path.join(REPO, 'packages/database/seed');
const PROFILE = 'radiology-workshop';
const PROFILE_DIR = path.join(SEED_DIR, 'profiles', PROFILE);
const DATASET = 'nih-chestxray14-workshop';
const TASK = 'nih-chestxray14-finding';
const CAMPAIGN = 'nih-chestxray14-reading';
const WEAK_BAND = '60+';

const read = (file: string) => readFileSync(file, 'utf8');
const profileSql = read(path.join(PROFILE_DIR, 'seed.sql'));
const demoSql = read(path.join(SEED_DIR, 'demo.sql'));

/** Rows of a comma-separated file without quoting (the profile's own small files). */
function rows(relative: string): string[][] {
  return read(path.join(PROFILE_DIR, relative))
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split(','));
}

const predictionsOf = (file: string) =>
  rows(`fixtures/${DATASET}/${file}`).map(([imageId = '', label = '']) => ({
    imageId,
    grade: Number(label),
  }));
const metadata = rows(`fixtures/${DATASET}/metadata.csv`).map(
  ([imageId = '', sex = '', band = '']) => ({
    imageId,
    sex,
    band,
  }),
);
/** The hidden reference labels, read here only to state what the design promises. */
const reference = new Map(
  rows('reference-labels.hidden.csv').map(([id = '', label = '']) => [id, Number(label)]),
);

function user(): CognitoAccessTokenPayload {
  return { sub: randomUUID() } as unknown as CognitoAccessTokenPayload;
}

function runReset(url: string, env: Record<string, string>) {
  const result = spawnSync(process.execPath, [path.join(REPO, 'apps/migrate/reset-profile.mjs')], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      DATABASE_URL: url,
      SEED_PROFILES_DIR: path.join(SEED_DIR, 'profiles'),
      OCI_SEED_RESET: PROFILE,
      ...env,
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// Each case replays a 200 KB seed through a child process, and `pnpm test` runs
// the packages in parallel: the default 5 s is not enough on a loaded machine.
const TIMEOUT = { timeout: 120_000 };

describe.skipIf(!dockerAvailable)(
  'radiology-workshop seed profile against Postgres (#644)',
  TIMEOUT,
  () => {
    let db: MigratedPostgres;
    let prisma: PrismaClient;
    let evaluation: EvaluationService;

    const lines = async () => snapshotLines(await snapshotTables(prisma));

    beforeAll(async () => {
      db = await startMigratedPostgres();
      prisma = db.prisma;
      evaluation = new EvaluationService(
        new EvaluationRepository({ client: prisma } as unknown as PrismaService),
        new EvalQueueProvider(),
      );
    }, 180_000);

    afterAll(async () => {
      await db?.stop();
    });

    describe('seeding', () => {
      it('applies from scratch, on a database that has only the migrations', async () => {
        replaySeedFile(db.url, profileSql);

        const dataset = await prisma.dataset.findUniqueOrThrow({ where: { slug: DATASET } });
        expect([dataset.visibility, dataset.status, dataset.accessTier]).toEqual([
          'PUBLIC',
          'PUBLISHED',
          'OPEN',
        ]);
        const version = await prisma.datasetVersion.findFirstOrThrow({
          where: { datasetId: dataset.id },
        });
        const files = await prisma.distribution.findMany({
          where: { datasetVersionId: version.id },
        });
        expect(files).toHaveLength(204);
        expect(files.filter((f) => f.contentType === 'image/png')).toHaveLength(200);
        expect(new Set(files.map((f) => f.s3Bucket))).toEqual(new Set(['oci-datasets-test']));
        expect(
          files.every((f) => f.s3Key === `${DATASET}/${f.id}/${f.s3Key?.split('/').at(-1)}`),
        ).toBe(true);

        const task = await prisma.evaluationTask.findUniqueOrThrow({ where: { slug: TASK } });
        expect([task.taskKind, task.numClasses, task.referableThreshold, task.datasetSlug]).toEqual(
          ['CLASSIFICATION', 2, 1, DATASET],
        );
        expect(Object.keys(task.groundTruth as object)).toHaveLength(200);

        const campaign = await prisma.annotationCampaign.findUniqueOrThrow({
          where: { slug: CAMPAIGN },
          include: { instructions: true },
        });
        expect([campaign.status, campaign.taskKind, campaign.manifestVersionId]).toEqual([
          'READY',
          'CLASSIFICATION',
          version.id,
        ]);
        expect(campaign.workflowConfig).toEqual({ nAnnotators: 3, taskTimeoutHours: 1 });
        expect(campaign.instructions).toHaveLength(1);
        expect(campaign.currentInstructionsVersion).toBe(campaign.instructions.at(0)?.version);
        expect(campaign.instructions.at(0)?.markdownBody).toContain('Lecture de radiographies');
        // Task creation from the dataset's files is #646: the seed creates none.
        expect(await prisma.annotationTask.count({ where: { campaignId: campaign.id } })).toBe(0);

        const cards = await prisma.modelCard.findMany({
          where: { slug: { startsWith: 'workshop-cxr-model-' } },
          orderBy: { slug: 'asc' },
        });
        expect(cards.map((c) => [c.slug, c.status])).toEqual([
          ['workshop-cxr-model-a', 'PUBLISHED'],
          ['workshop-cxr-model-b', 'DRAFT'],
        ]);
      });

      it('changes no row when replayed', async () => {
        const before = await lines();
        replaySeedFile(db.url, profileSql);
        expect(await lines()).toEqual(before);
      });

      it('leaves the demo seed as it is, and the demo seed leaves the profile as it is', async () => {
        const workshopOnly = await lines();
        replaySeedFile(db.url, demoSql);
        const both = await lines();
        // Every row the profile wrote is still there, untouched by the demo seed.
        expect(both).toEqual(expect.arrayContaining(workshopOnly));

        replaySeedFile(db.url, profileSql);
        expect(await lines()).toEqual(both);
        replaySeedFile(db.url, demoSql);
        expect(await lines()).toEqual(both);
      });

      it('fails, names item ids only and writes nothing when the stored answer key differs', async () => {
        const task = await prisma.evaluationTask.findUniqueOrThrow({ where: { slug: TASK } });
        const stored = task.groundTruth as Record<string, number>;
        const [victim = ''] = Object.keys(stored);
        const tampered = Object.fromEntries(
          Object.entries(stored).map(([id, label]) => [id, id === victim ? 1 - label : label]),
        );
        await prisma.evaluationTask.update({
          where: { slug: TASK },
          data: { groundTruth: tampered },
        });
        // Whatever happens below, the key goes back: the later cases score against it.
        try {
          const before = await lines();

          let message = '';
          try {
            replaySeedFile(db.url, profileSql);
          } catch (error) {
            // Everything the migrate task would print: both streams and the error itself.
            const failure = error as { stdout?: Buffer; stderr?: Buffer; message?: string };
            message = `${String(failure.stdout ?? '')}${String(failure.stderr ?? '')}${failure.message ?? ''}`;
          }
          expect(message).toContain(
            `differs from the ${PROFILE} seed profile for item ids [${victim}]`,
          );
          // No label next to an identifier, and no identifier but the one that differs:
          // the answer key itself was not printed.
          expect(message).not.toMatch(/"\s*:\s*[01]\b/);
          const others = Object.keys(stored).filter((id) => id !== victim);
          expect(others.filter((id) => message.includes(id))).toEqual([]);
          expect(await lines()).toEqual(before);
        } finally {
          await prisma.evaluationTask.update({
            where: { slug: TASK },
            data: { groundTruth: stored },
          });
        }
      });
    });

    describe('teaching files, scored by the evaluation service', () => {
      // The task is CLASSIFICATION with class 0 = absent and 1 = present, so the
      // recall of class 1 is the sensitivity and the recall of class 0 the
      // specificity: the figures a participant reads off the per-class table.
      const accuracyIn = (predictions: { imageId: string; grade: number }[], ids: Set<string>) => {
        const scores = scoreClassification({
          groundTruth: Object.fromEntries([...reference].filter(([id]) => ids.has(id))),
          predictions: Object.fromEntries(predictions.map((p) => [p.imageId, p.grade])),
          numClasses: 2,
        });
        const recallOf = (label: number) =>
          scores.perClass.find((c) => c.label === label)?.recall ?? Number.NaN;
        return {
          accuracy: scores.accuracy,
          referableSensitivity: recallOf(1),
          referableSpecificity: recallOf(0),
        };
      };
      const idsWhere = (keep: (m: (typeof metadata)[number]) => boolean) =>
        new Set(metadata.filter(keep).map((m) => m.imageId));

      it('models A and B get exactly the same overall result', async () => {
        const [a, b] = await Promise.all(
          ['model-a.csv', 'model-b.csv'].map((file) =>
            evaluation.submitPredictions(
              TASK,
              SubmitPredictionsRequestSchema.parse({
                methodName: file,
                predictions: predictionsOf(file),
              }),
              user(),
            ),
          ),
        );
        expect(a?.scores).toEqual(b?.scores);
        expect(a?.scores).toMatchObject({
          kind: 'CLASSIFICATION',
          metrics: {
            accuracy: 0.9,
            balancedAccuracy: 0.9,
            coverage: 1,
            // Class 0 = absent (recall = specificity), class 1 = present
            // (recall = sensitivity).
            perClass: [
              { label: 0, recall: 0.9, support: 120 },
              { label: 1, recall: 0.9, support: 80 },
            ],
          },
        });
      });

      it('model A is good in every subgroup; model B is clearly worse in one age band only', () => {
        const a = predictionsOf('model-a.csv');
        const b = predictionsOf('model-b.csv');
        const subgroups = [
          ...['F', 'M'].map((sex) => idsWhere((m) => m.sex === sex)),
          ...['18-39', '40-59', '60+'].map((band) => idsWhere((m) => m.band === band)),
        ];
        for (const ids of subgroups) {
          const scores = accuracyIn(a, ids);
          expect(scores.accuracy).toBeGreaterThanOrEqual(0.88);
          expect(scores.referableSensitivity).toBeGreaterThanOrEqual(0.85);
          expect(scores.referableSpecificity).toBeGreaterThanOrEqual(0.85);
        }

        const weak = idsWhere((m) => m.band === WEAK_BAND);
        const others = idsWhere((m) => m.band !== WEAK_BAND);
        expect(weak.size).toBe(67);
        // Model B, older patients: 18 of its 20 errors. 49 right out of 67.
        expect(accuracyIn(b, weak)).toMatchObject({
          accuracy: 0.7313,
          referableSensitivity: 0.7037,
          referableSpecificity: 0.75,
        });
        // Model A in the same band, for the comparison a participant makes.
        expect(accuracyIn(a, weak)).toMatchObject({
          accuracy: 0.8955,
          referableSensitivity: 0.8889,
        });
        // Model B everywhere else: 2 errors in 133.
        expect(accuracyIn(b, others)).toMatchObject({ accuracy: 0.985, referableSensitivity: 1 });
        // By sex the two models look alike: the breakdown has to be the right one.
        for (const sex of ['F', 'M']) {
          const ids = idsWhere((m) => m.sex === sex);
          expect(Math.abs(accuracyIn(a, ids).accuracy - accuracyIn(b, ids).accuracy)).toBeLessThan(
            0.03,
          );
        }
      });

      it('model C is refused by the format check, with what to fix', async () => {
        const body = SubmitPredictionsRequestSchema.parse({
          methodName: 'model-c.csv',
          intent: 'VALIDATION',
          predictions: predictionsOf('model-c.csv'),
        });
        const report = await evaluation.validatePredictions(TASK, body);
        expect(report.ok).toBe(false);
        expect(report.itemIdSummary).toEqual({
          submitted: 193,
          recognised: 185,
          unrecognised: 5,
          notPredicted: 15,
        });
        const failed = new Map(report.checks.filter((c) => !c.ok).map((c) => [c.name, c]));
        expect([...failed.keys()].sort()).toEqual([
          'DUPLICATE_ITEM_IDS',
          'ITEM_IDS_RECOGNISED',
          'LABEL_RANGE',
        ]);
        expect(failed.get('DUPLICATE_ITEM_IDS')?.detail).toBe(
          '3 item ID(s) appear more than once. Send exactly one prediction per item ID; the scored path rejects the whole submission on the first duplicate.',
        );
        expect(failed.get('LABEL_RANGE')?.detail).toBe(
          // A classification task has labels, not grades (#650).
          "4 prediction(s) carry a label outside this task's range. Labels must be integers in [0, 1] (numClasses = 2).",
        );
        expect(failed.get('ITEM_IDS_RECOGNISED')?.detail).toContain(
          "5 submitted item ID(s) are not contained in this task's 200 item(s)",
        );
        // The offending identifiers are named, so the file can be corrected line by line.
        expect(failed.get('ITEM_IDS_RECOGNISED')?.itemIds.every((id) => id.endsWith('.png'))).toBe(
          true,
        );
        expect(failed.get('DUPLICATE_ITEM_IDS')?.itemIds).toHaveLength(3);
        expect(failed.get('LABEL_RANGE')?.itemIds).toHaveLength(4);

        // The two valid files pass the same check.
        for (const file of ['model-a.csv', 'model-b.csv']) {
          const ok = await evaluation.validatePredictions(
            TASK,
            SubmitPredictionsRequestSchema.parse({
              methodName: file,
              intent: 'VALIDATION',
              predictions: predictionsOf(file),
            }),
          );
          expect(ok.ok, file).toBe(true);
        }
      });
    });

    describe('reset', () => {
      let workshopTaskId: string;
      let workshopCampaignId: string;
      let workshopAnnotationTaskIds: string[];

      /** Rows the reset must not touch: everything outside the workshop's own objects. */
      const untouchable = async () =>
        snapshotLines(
          (await snapshotTables(prisma)).filter(({ table, row }) => {
            switch (table) {
              case 'evaluation.submissions':
                return row['task_id'] !== workshopTaskId;
              case 'annotation.annotation_task_assignments':
                return !workshopAnnotationTaskIds.includes(String(row['task_id']));
              case 'annotation.annotator_calibration_flags':
              case 'annotation.annotation_tasks':
                return row['campaign_id'] !== workshopCampaignId;
              case 'annotation.annotation_campaigns':
                return row['id'] !== workshopCampaignId;
              default:
                return true;
            }
          }),
        );

      /** One finished reading, one calibration flag and a COMPLETED status on a campaign. */
      async function participantWorkOn(campaignId: string, sampleRef: string): Promise<string> {
        const task = await prisma.annotationTask.create({
          data: {
            campaignId,
            sampleRef,
            nAnnotatorsRequired: 3,
            gateState: 'COMPLETED',
            completedAt: new Date(),
          },
        });
        await prisma.annotationTaskAssignment.createMany({
          data: [0, 1, 2].map(() => ({
            taskId: task.id,
            assigneeUserId: randomUUID(),
            assigneeRole: 'annotator',
            gateAtAssignment: 'INDEPENDENT' as const,
            status: 'SUBMITTED' as const,
            submission: { label: 'present' },
            submittedAt: new Date(),
          })),
        });
        await prisma.annotatorCalibrationFlag.create({
          data: {
            campaignId,
            annotatorUserId: randomUUID(),
            flagType: 'DRIFT',
            metric: 'vs-peers',
            score: 0.4,
            threshold: 0.6,
            sampleSize: 12,
            windowMeta: {},
          },
        });
        await prisma.annotationCampaign.update({
          where: { id: campaignId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        return task.id;
      }

      beforeAll(async () => {
        workshopTaskId = (await prisma.evaluationTask.findUniqueOrThrow({ where: { slug: TASK } }))
          .id;
        workshopCampaignId = (
          await prisma.annotationCampaign.findUniqueOrThrow({ where: { slug: CAMPAIGN } })
        ).id;

        // Work on the workshop objects: two scored submissions exist already.
        workshopAnnotationTaskIds = [
          await participantWorkOn(workshopCampaignId, `${DATASET}/reading-1`),
          await participantWorkOn(workshopCampaignId, `${DATASET}/reading-2`),
        ];

        // The same kinds of rows on objects that are NOT the workshop's: the demo
        // evaluation task and the demo campaign. All of it must survive.
        const idrid = await prisma.annotationCampaign.findUniqueOrThrow({
          where: { slug: 'idrid-dr-grading' },
        });
        await participantWorkOn(idrid.id, 'idrid-grading-demo/extra-sample');
        await evaluation.submitPredictions(
          'idrid-dr-grading',
          SubmitPredictionsRequestSchema.parse({
            methodName: 'unrelated submission',
            predictions: [{ imageId: 'IDRiD_001', grade: 4 }],
          }),
          user(),
        );
        // An account.
        await prisma.user.create({
          data: { cognitoId: randomUUID(), email: 'reader@workshop.example' },
        });
      });

      it('refuses any environment but dev and local, before touching the database', async () => {
        const before = await lines();
        for (const env of ['prod', 'int', 'production', '']) {
          const run = runReset(db.url, {
            OCI_ENV: env,
            OCI_SEED_RESET_CONFIRM: `${PROFILE}@${env}`,
          });
          expect(run.status, env).toBe(2);
          expect(run.output).toContain('REFUSED');
        }
        // An address that looks like production is refused even when the name says dev.
        const lookalike = runReset('postgresql://u:p@oci-prod-db.internal:5432/oci', {
          OCI_ENV: 'dev',
          OCI_SEED_RESET_CONFIRM: `${PROFILE}@dev`,
        });
        expect([lookalike.status, lookalike.output]).toEqual([
          2,
          expect.stringContaining('contains "prod"'),
        ]);
        // A confirmation written for another environment or profile is refused.
        for (const confirm of ['yes', `${PROFILE}@local`, 'other-profile@dev']) {
          expect(runReset(db.url, { OCI_ENV: 'dev', OCI_SEED_RESET_CONFIRM: confirm }).status).toBe(
            2,
          );
        }
        // A profile that does not exist has no reset.
        expect(runReset(db.url, { OCI_ENV: 'dev', OCI_SEED_RESET: 'no-such-profile' }).status).toBe(
          2,
        );
        expect(await lines()).toEqual(before);
      });

      it('is a dry run by default: prints the counts and changes nothing', async () => {
        const before = await lines();
        const run = runReset(db.url, { OCI_ENV: 'dev' });
        expect(run.status).toBe(0);
        expect(run.output).toContain('DRY RUN, nothing will be changed');
        expect(run.output).toMatch(/ 2 {2}evaluation submissions deleted \(would be\)/);
        expect(run.output).toMatch(
          / 6 {2}annotation assignments \(with their answers\) deleted \(would be\)/,
        );
        expect(run.output).toMatch(/ 2 {2}annotator calibration flags deleted \(would be\)/);
        expect(run.output).toMatch(
          / 2 {2}annotation tasks put back at the first reading \(would be\)/,
        );
        expect(run.output).toMatch(/ 1 {2}completed campaigns reopened \(would be\)/);
        expect(run.output).toContain(`OCI_SEED_RESET_CONFIRM=${PROFILE}@dev`);
        expect(await lines()).toEqual(before);
      });

      it('applied, removes the work on the workshop objects and nothing else', async () => {
        const others = await untouchable();
        const started = Date.now();
        const run = runReset(db.url, { OCI_ENV: 'dev', OCI_SEED_RESET_CONFIRM: `${PROFILE}@dev` });
        const elapsedMs = Date.now() - started;
        expect(run.output).toContain('APPLYING');
        expect(run.status).toBe(0);
        expect(elapsedMs).toBeLessThan(60_000);

        // Everything outside the workshop objects is identical, row for row and write for write.
        expect(await untouchable()).toEqual(others);

        // The workshop objects are back to how the seed left them.
        expect(await prisma.submission.count({ where: { taskId: workshopTaskId } })).toBe(0);
        expect(
          await prisma.annotationTaskAssignment.count({
            where: { taskId: { in: workshopAnnotationTaskIds } },
          }),
        ).toBe(0);
        expect(
          await prisma.annotatorCalibrationFlag.count({
            where: { campaignId: workshopCampaignId },
          }),
        ).toBe(0);
        const tasks = await prisma.annotationTask.findMany({
          where: { campaignId: workshopCampaignId },
        });
        expect(tasks.map((t) => [t.gateState, t.completedAt])).toEqual([
          ['INDEPENDENT', null],
          ['INDEPENDENT', null],
        ]);
        const campaign = await prisma.annotationCampaign.findUniqueOrThrow({
          where: { id: workshopCampaignId },
          include: { instructions: true },
        });
        expect([campaign.status, campaign.completedAt, campaign.instructions.length]).toEqual([
          'RUNNING',
          null,
          1,
        ]);

        // Kept: the account, the seeded dataset with its files, the answer key, the cards.
        expect(await prisma.user.count({ where: { email: 'reader@workshop.example' } })).toBe(1);
        expect(
          await prisma.distribution.count({ where: { s3Key: { startsWith: `${DATASET}/` } } }),
        ).toBe(204);
        const task = await prisma.evaluationTask.findUniqueOrThrow({ where: { slug: TASK } });
        expect(task.groundTruth).toEqual(Object.fromEntries(reference));
        expect(
          await prisma.modelCard.count({ where: { slug: { startsWith: 'workshop-cxr-' } } }),
        ).toBe(2);

        // The unrelated objects kept their own submissions and readings.
        expect(
          await prisma.submission.count({ where: { task: { slug: 'idrid-dr-grading' } } }),
        ).toBe(1);
        expect(
          await prisma.annotationTaskAssignment.count({
            where: { task: { sampleRef: 'idrid-grading-demo/extra-sample' } },
          }),
        ).toBe(3);
      });

      it('applied again, finds nothing left to do, and the seed still replays cleanly', async () => {
        const before = await lines();
        const run = runReset(db.url, {
          OCI_ENV: 'local',
          OCI_SEED_RESET_CONFIRM: `${PROFILE}@local`,
        });
        expect(run.status).toBe(0);
        expect(run.output).toMatch(/ 0 {2}evaluation submissions deleted/);
        expect(run.output).toMatch(/ 0 {2}completed campaigns reopened/);
        expect(await lines()).toEqual(before);
        replaySeedFile(db.url, profileSql);
        expect(await lines()).toEqual(before);
      });
    });
  },
);

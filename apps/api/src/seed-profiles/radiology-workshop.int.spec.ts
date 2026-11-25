import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { AuditEmitter, type AuditPrismaPort } from '@oci/audit';
import type { PrismaClient } from '@oci/database';
import {
  DatasetSlugSchema,
  parseFileSampleRef,
  SubmitPredictionsRequestSchema,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AssignmentSampleService } from '../modules/annotation/assignment-sample.service.js';
import { CampaignRepository } from '../modules/annotation/campaign.repository.js';
import { CampaignService } from '../modules/annotation/campaign.service.js';
import { TaskAbandonmentService } from '../modules/annotation/task-abandonment.service.js';
import { TaskRepository } from '../modules/annotation/task.repository.js';
import { TaskService } from '../modules/annotation/task.service.js';
import { CatalogRepository } from '../modules/catalog/catalog.repository.js';
import { CatalogService } from '../modules/catalog/catalog.service.js';
import { EvalQueueProvider } from '../modules/evaluation/eval-queue.js';
import { EvaluationRepository } from '../modules/evaluation/evaluation.repository.js';
import { EvaluationService } from '../modules/evaluation/evaluation.service.js';
import { RouteRegistryRepository } from '../modules/evaluation/route-registry.repository.js';
import { RouteRegistryService } from '../modules/evaluation/route-registry.service.js';
import { scoreClassification } from '../modules/evaluation/scoring-classification.js';
import type { DicomSeriesService } from '../modules/storage/dicom-series.service.js';
import type { StorageService } from '../modules/storage/storage.service.js';
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
/** The user the seed files publish as. */
const SEED_OWNER = '00000000-0000-4000-8000-000000000099';

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
/** The images of the reading subset: flagged `"campaign": true` in selection.json. */
const readingFiles = (
  JSON.parse(read(path.join(PROFILE_DIR, 'selection.json'))) as {
    images: { file: string; campaign: boolean }[];
  }
).images
  .filter((i) => i.campaign)
  .map((i) => i.file)
  .sort();
/** The answers of the reading campaign, as the reader's screen reads them (#646). */
const READING_LABELS = {
  labels: [
    { value: '0', display: 'Absent' },
    { value: '1', display: 'Présent' },
  ],
  cannotAssess: true,
  allowComment: true,
};
const fileNameOfKey = (key: string | null | undefined) => key?.split('/').at(-1) ?? '';

/** The hidden reference labels, read here only to state what the design promises. */
const reference = new Map(
  rows('reference-labels.hidden.csv').map(([id = '', label = '']) => [id, Number(label)]),
);

/**
 * The rows that differ between two snapshots, by table and slug or id, without
 * their content (a manifest runs to kilobytes). Empty when nothing was written.
 */
function changedRows(before: readonly string[], after: readonly string[]): string[] {
  const name = (line: string): string => {
    const [table = ''] = line.split(' ', 1);
    const slug = /"slug": ?"([^"]+)"/.exec(line)?.[1];
    const id = /"id": ?"([^"]+)"/.exec(line)?.[1];
    return `${table} ${slug ?? id ?? line.slice(0, 80)}`;
  };
  const was = new Set(before);
  const now = new Set(after);
  return [
    ...before.filter((line) => !now.has(line)).map((line) => `- ${name(line)}`),
    ...after.filter((line) => !was.has(line)).map((line) => `+ ${name(line)}`),
  ].sort();
}

function user(sub: string = randomUUID()): CognitoAccessTokenPayload {
  return { sub } as unknown as CognitoAccessTokenPayload;
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
    let campaignRepo: CampaignRepository;
    let campaigns: CampaignService;
    let readingTasks: TaskService;
    let samples: AssignmentSampleService;
    /** What the sample service asked storage to sign; storage itself is stubbed. */
    const signed: { bucket: string; key: string; contentType: string }[] = [];

    const lines = async () => snapshotLines(await snapshotTables(prisma));

    beforeAll(async () => {
      // Pulls free abandoned slots themselves; no BullMQ sweeper here.
      delete process.env.REDIS_URL;
      db = await startMigratedPostgres();
      prisma = db.prisma;
      const prismaService = { client: prisma } as unknown as PrismaService;
      const audit = new AuditEmitter({ prisma: prisma as unknown as AuditPrismaPort });
      evaluation = new EvaluationService(
        new EvaluationRepository(prismaService),
        new EvalQueueProvider(),
        audit,
        new RouteRegistryService(new RouteRegistryRepository(prismaService), audit),
      );
      campaignRepo = new CampaignRepository(prismaService);
      campaigns = new CampaignService(campaignRepo);
      const taskRepo = new TaskRepository(prismaService);
      // The reading campaign has image files only, no DICOM series.
      const noSeries = { listTaskSamples: async () => [] } as unknown as DicomSeriesService;
      const storage = {
        authoriseDatasetBytes: async () => ({}),
        signHostedRead: async (args: { bucket: string; key: string; contentType: string }) => {
          signed.push({ bucket: args.bucket, key: args.key, contentType: args.contentType });
          return `https://storage.test/${randomUUID()}`;
        },
      } as unknown as StorageService;
      readingTasks = new TaskService(
        campaignRepo,
        taskRepo,
        new TaskAbandonmentService(taskRepo, audit),
        noSeries,
        storage,
      );
      samples = new AssignmentSampleService(campaignRepo, taskRepo, storage, noSeries);
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
        // #410: results by sex and by age band, with each item's values taken
        // from the same selection as the public metadata file.
        expect(
          (task.subgroupFields as { key: string; values: { value: string }[] }[]).map((f) => [
            f.key,
            f.values.map((v) => v.value),
          ]),
        ).toEqual([
          ['sex', ['F', 'M']],
          ['ageBand', ['18-39', '40-59', '60+']],
        ]);
        expect(task.subgroupValues).toEqual(
          Object.fromEntries(metadata.map((m) => [m.imageId, { sex: m.sex, ageBand: m.band }])),
        );

        const campaign = await prisma.annotationCampaign.findUniqueOrThrow({
          where: { slug: CAMPAIGN },
          include: { instructions: true },
        });
        expect([campaign.status, campaign.taskKind, campaign.manifestVersionId]).toEqual([
          'READY',
          'CLASSIFICATION',
          version.id,
        ]);
        expect(campaign.workflowConfig).toEqual({
          nAnnotators: 3,
          taskTimeoutHours: 1,
          classificationLabels: READING_LABELS,
        });
        // The API reads the labels the way the reader's screen gets them (#646).
        const detail = await campaigns.detail(CAMPAIGN);
        expect(detail.workflowConfig.classificationLabels).toEqual(READING_LABELS);
        expect(campaign.instructions).toHaveLength(1);
        expect(campaign.currentInstructionsVersion).toBe(campaign.instructions.at(0)?.version);
        expect(campaign.instructions.at(0)?.markdownBody).toContain('Lecture de radiographies');
        expect(campaign.instructions.at(0)?.markdownBody).toContain(
          '**Non interprétable** (touche 0)',
        );

        // One reading task per flagged image, each a `file:<distribution id>`
        // reference to a hosted image of the pinned version (#646).
        const tasks = await prisma.annotationTask.findMany({ where: { campaignId: campaign.id } });
        expect(tasks).toHaveLength(60);
        expect(
          tasks.every(
            (t) =>
              t.gateState === 'INDEPENDENT' &&
              t.nAnnotatorsRequired === 3 &&
              t.completedAt === null &&
              /^file:[0-9a-f-]{36}$/.test(t.sampleRef),
          ),
        ).toBe(true);
        const hosted = await Promise.all(
          tasks.map((t) =>
            campaignRepo.findHostedImageFile(version.id, parseFileSampleRef(t.sampleRef) ?? ''),
          ),
        );
        expect(hosted.every((f) => f?.contentType === 'image/png')).toBe(true);
        expect(hosted.map((f) => fileNameOfKey(f?.s3Key)).sort()).toEqual(readingFiles);

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

      it('gives a campaign seeded before #646 its labels and its reading tasks, once', async () => {
        // The campaign as the profile left it before #646: no labels, no task.
        const { id } = await prisma.annotationCampaign.findUniqueOrThrow({
          where: { slug: CAMPAIGN },
        });
        await prisma.annotationTask.deleteMany({ where: { campaignId: id } });
        await prisma.annotationCampaign.update({
          where: { id },
          data: { workflowConfig: { nAnnotators: 3, taskTimeoutHours: 1 } },
        });

        replaySeedFile(db.url, profileSql);
        const campaign = await prisma.annotationCampaign.findUniqueOrThrow({ where: { id } });
        expect(campaign.workflowConfig).toEqual({
          nAnnotators: 3,
          taskTimeoutHours: 1,
          classificationLabels: READING_LABELS,
        });
        expect(await prisma.annotationTask.count({ where: { campaignId: id } })).toBe(60);

        const before = await lines();
        replaySeedFile(db.url, profileSql);
        expect(await lines()).toEqual(before);
      });

      it('never overwrites labels the campaign already declares', async () => {
        const { id, workflowConfig } = await prisma.annotationCampaign.findUniqueOrThrow({
          where: { slug: CAMPAIGN },
        });
        const own = {
          nAnnotators: 3,
          taskTimeoutHours: 1,
          classificationLabels: { ...READING_LABELS, cannotAssess: false },
        };
        await prisma.annotationCampaign.update({ where: { id }, data: { workflowConfig: own } });
        try {
          replaySeedFile(db.url, profileSql);
          expect(
            (await prisma.annotationCampaign.findUniqueOrThrow({ where: { id } })).workflowConfig,
          ).toEqual(own);
        } finally {
          await prisma.annotationCampaign.update({
            where: { id },
            data: { workflowConfig: workflowConfig as object },
          });
        }
      });

      it('fails, naming counts only, when an image of the reading subset is not hosted in the pinned version', async () => {
        const [victimFile = ''] = readingFiles;
        const victim = await prisma.distribution.findFirstOrThrow({
          where: { s3Key: { endsWith: `/${victimFile}` } },
        });
        await prisma.distribution.update({
          where: { id: victim.id },
          data: { s3Key: `${victim.s3Key ?? ''}.moved` },
        });
        try {
          const before = await lines();
          let message = '';
          try {
            replaySeedFile(db.url, profileSql);
          } catch (error) {
            const failure = error as { stdout?: Buffer; stderr?: Buffer; message?: string };
            message = `${String(failure.stdout ?? '')}${String(failure.stderr ?? '')}${failure.message ?? ''}`;
          }
          expect(message).toContain(
            `campaign ${CAMPAIGN}: 59 of the 60 images of the reading subset resolve to exactly one hosted image of the pinned version`,
          );
          expect(message).not.toContain(victimFile);
          expect(await lines()).toEqual(before);
        } finally {
          await prisma.distribution.update({
            where: { id: victim.id },
            data: { s3Key: victim.s3Key },
          });
        }
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

    describe('subgroup values (#410)', () => {
      it('are written once onto a task seeded before they existed', async () => {
        // The task as a database migrated before #410 holds it: no field, no map.
        replaySeedFile(
          db.url,
          `UPDATE "evaluation"."evaluation_tasks" SET subgroup_fields = '[]', subgroup_values = NULL WHERE slug = '${TASK}';`,
        );
        expect(
          (await prisma.evaluationTask.findUniqueOrThrow({ where: { slug: TASK } })).subgroupValues,
        ).toBeNull();
        replaySeedFile(db.url, profileSql);
        const task = await prisma.evaluationTask.findUniqueOrThrow({ where: { slug: TASK } });
        expect(Object.keys(task.subgroupValues as object)).toHaveLength(200);
        const before = await lines();
        replaySeedFile(db.url, profileSql);
        expect(await lines()).toEqual(before);
      });

      it('fail the seed, naming item ids only, when the stored values differ', async () => {
        const task = await prisma.evaluationTask.findUniqueOrThrow({ where: { slug: TASK } });
        const stored = task.subgroupValues as Record<string, { sex: string; ageBand: string }>;
        const [victim = ''] = Object.keys(stored);
        const tampered = Object.fromEntries(
          Object.entries(stored).map(([id, v]) => [
            id,
            id === victim ? { ...v, ageBand: v.ageBand === '60+' ? '18-39' : '60+' } : v,
          ]),
        );
        await prisma.evaluationTask.update({
          where: { slug: TASK },
          data: { subgroupValues: tampered },
        });
        try {
          const before = await lines();
          let message = '';
          try {
            replaySeedFile(db.url, profileSql);
          } catch (error) {
            const failure = error as { stdout?: Buffer; stderr?: Buffer; message?: string };
            message = `${String(failure.stdout ?? '')}${String(failure.stderr ?? '')}${failure.message ?? ''}`;
          }
          expect(message).toContain(
            `subgroup_values differ from the ${PROFILE} seed profile for item ids [${victim}]`,
          );
          expect(message).not.toContain('ageBand');
          expect(await lines()).toEqual(before);
        } finally {
          await prisma.evaluationTask.update({
            where: { slug: TASK },
            data: { subgroupValues: stored },
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

      const submissionIds: { a: string; b: string } = { a: '', b: '' };

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
        submissionIds.a = a?.id ?? '';
        submissionIds.b = b?.id ?? '';
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

      it('the result page breaks both down by subgroup: B drops for patients aged 60 and over, A does not (#410)', async () => {
        const a = await evaluation.getSubmissionDetail(TASK, submissionIds.a);
        const b = await evaluation.getSubmissionDetail(TASK, submissionIds.b);
        const accuracyBy = (detail: typeof a, field: string) =>
          Object.fromEntries(
            (detail.subgroups?.fields.find((f) => f.key === field)?.cells ?? []).map((c) => [
              c.value,
              c.status === 'REPORTED' && c.metrics.kind === 'CLASSIFICATION'
                ? { accuracy: c.metrics.accuracy, items: c.scoredCount }
                : c.status,
            ]),
          );

        // Nothing is withheld: every group holds 66 items or more.
        expect(a.subgroups?.minCellSize).toBe(11);
        expect(accuracyBy(b, 'ageBand')).toEqual({
          '18-39': { accuracy: 0.9851, items: 67 },
          '40-59': { accuracy: 0.9848, items: 66 },
          '60+': { accuracy: 0.7313, items: 67 },
        });
        // Model A: even across the bands, 60 and over included.
        expect(accuracyBy(a, 'ageBand')).toEqual({
          '18-39': { accuracy: 0.8955, items: 67 },
          '40-59': { accuracy: 0.9091, items: 66 },
          '60+': { accuracy: 0.8955, items: 67 },
        });
        // By sex the two models look alike: the breakdown has to be the right one.
        const bySex = { accuracy: 0.9, items: 100 };
        expect(accuracyBy(a, 'sex')).toEqual({ F: bySex, M: bySex });
        expect(accuracyBy(b, 'sex')).toEqual({ F: bySex, M: bySex });
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

    // The room: the facilitator presses Start, readers pull images and answer.
    // Through the services the controllers call, with storage stubbed.
    describe('the reading exercise', () => {
      const READER = ['annotator'] as const;
      const manager = {
        sub: randomUUID(),
        'cognito:groups': ['campaign-manager'],
      } as unknown as CognitoAccessTokenPayload;
      const readers = [randomUUID(), randomUUID(), randomUUID()];

      it('serves no reader until the facilitator starts the campaign', async () => {
        await expect(
          readingTasks.pullNext({ slug: CAMPAIGN, user: user(), userGroups: READER }),
        ).rejects.toBeInstanceOf(ConflictException);

        const started = await campaigns.transition(CAMPAIGN, 'start', undefined, manager);
        expect(started.status).toBe('RUNNING');
      });

      it('gives a reader an image of the pinned version, never a storage key', async () => {
        const { assignment } = await readingTasks.pullNext({
          slug: CAMPAIGN,
          user: user(readers[0]),
          userGroups: READER,
        });
        expect(assignment?.sampleRef).toMatch(/^file:[0-9a-f-]{36}$/);

        const sample = await samples.sample({
          assignmentId: assignment?.id ?? '',
          user: user(readers[0]),
          userGroups: READER,
        });
        expect(sample).toMatchObject({ kind: 'image', contentType: 'image/png' });
        expect(sample.kind === 'image' ? sample.url : '').toMatch(/^https:\/\/storage\.test\//);

        // The file signed is the hosted image the task names, one of the subset.
        const distributionId = parseFileSampleRef(assignment?.sampleRef ?? '');
        const last = signed.at(-1);
        expect(last?.bucket).toBe('oci-datasets-test');
        expect(last?.key).toMatch(new RegExp(`^${DATASET}/${distributionId}/[^/]+\\.png$`));
        expect(readingFiles).toContain(fileNameOfKey(last?.key));
      });

      it('takes the campaign’s answers only, « Non interprétable » included, and lets a reader skip', async () => {
        const { currentInstructionsVersion } = await prisma.annotationCampaign.findUniqueOrThrow({
          where: { slug: CAMPAIGN },
        });
        const pull = async (sub: string) =>
          (await readingTasks.pullNext({ slug: CAMPAIGN, user: user(sub), userGroups: READER }))
            .assignment?.id ?? '';
        const answer = (assignmentId: string, sub: string, label: string) =>
          readingTasks.submit({
            assignmentId,
            submission: { label },
            acknowledgedInstructionsVersion: currentInstructionsVersion,
            user: user(sub),
          });

        const [first = '', second = '', third = ''] = readers;
        const a = await pull(first);
        await expect(answer(a, first, 'present')).rejects.toBeInstanceOf(
          UnprocessableEntityException,
        );
        await answer(a, first, '1');

        await answer(await pull(second), second, 'cannot-assess');

        const skipped = await pull(third);
        await readingTasks.release({ assignmentId: skipped, user: user(third) });

        const { id } = await prisma.annotationCampaign.findUniqueOrThrow({
          where: { slug: CAMPAIGN },
        });
        const rows = await prisma.annotationTaskAssignment.findMany({
          where: { task: { campaignId: id } },
          orderBy: { assignedAt: 'asc' },
        });
        expect(
          rows.map((r) => [r.status, (r.submission as { label?: string } | null)?.label]),
        ).toEqual([
          ['SUBMITTED', '1'],
          ['SUBMITTED', 'cannot-assess'],
          ['RELEASED', undefined],
        ]);
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

      /**
       * A session on the seeded reading tasks, on top of what the reading
       * exercise above left (two answers and a skip): one image read by three
       * readers and settled by the arbiter, one set aside by a supervisor, one
       * open on a reader's screen, a calibration flag, and the campaign
       * COMPLETED.
       */
      async function sessionOnSeededTasks(campaignId: string): Promise<void> {
        const [settled, setAside, open] = await prisma.annotationTask.findMany({
          where: { campaignId },
          orderBy: { sampleRef: 'asc' },
          take: 3,
        });
        if (!settled || !setAside || !open) throw new Error('the seed made fewer than 3 tasks');
        await prisma.annotationTask.update({
          where: { id: settled.id },
          data: { gateState: 'COMPLETED', completedAt: new Date() },
        });
        await prisma.annotationTaskAssignment.createMany({
          data: [
            ...['1', '1', '0'].map((label) => ({
              taskId: settled.id,
              assigneeUserId: randomUUID(),
              assigneeRole: 'annotator',
              gateAtAssignment: 'INDEPENDENT' as const,
              status: 'SUBMITTED' as const,
              submission: { label },
              submittedAt: new Date(),
            })),
            {
              taskId: settled.id,
              assigneeUserId: randomUUID(),
              assigneeRole: 'arbitration-annotator',
              gateAtAssignment: 'AWAITING_ARBITRATION' as const,
              status: 'SUBMITTED' as const,
              submission: { label: '1', reason: 'Opacité nette du lobe inférieur.' },
              submittedAt: new Date(),
            },
            {
              taskId: open.id,
              assigneeUserId: randomUUID(),
              assigneeRole: 'annotator',
              gateAtAssignment: 'INDEPENDENT' as const,
              status: 'IN_PROGRESS' as const,
              startedAt: new Date(),
            },
          ],
        });
        await prisma.annotationTask.update({
          where: { id: setAside.id },
          data: { gateState: 'SKIPPED', skipReason: 'Image en double.' },
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
      }

      beforeAll(async () => {
        workshopTaskId = (await prisma.evaluationTask.findUniqueOrThrow({ where: { slug: TASK } }))
          .id;
        workshopCampaignId = (
          await prisma.annotationCampaign.findUniqueOrThrow({ where: { slug: CAMPAIGN } })
        ).id;
        workshopAnnotationTaskIds = (
          await prisma.annotationTask.findMany({
            where: { campaignId: workshopCampaignId },
            select: { id: true },
          })
        ).map((t) => t.id);

        // Work on the workshop objects: two scored submissions exist already,
        // and the reading exercise above left two answers and a skip.
        await sessionOnSeededTasks(workshopCampaignId);

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
        // The exercise's two answers and skip, three readings, an arbitration
        // and one open image.
        expect(run.output).toMatch(
          / 8 {2}annotation assignments \(with their answers\) deleted \(would be\)/,
        );
        expect(run.output).toMatch(/ 1 {2}annotator calibration flags deleted \(would be\)/);
        expect(run.output).toMatch(
          / 2 {2}annotation tasks put back at the first reading \(would be\)/,
        );
        expect(run.output).toMatch(/ 1 {2}started campaigns put back to READY \(would be\)/);
        expect(run.output).toContain(`OCI_SEED_RESET_CONFIRM=${PROFILE}@dev`);
        expect(await lines()).toEqual(before);
      });

      it('applied, removes the work on the workshop objects and nothing else', async () => {
        const others = await untouchable();
        // #583: the submissions it deletes are pinned to a method version. The
        // method, its versions and their review are not the workshop's work:
        // the reset leaves them as they are (written by nobody, by xmin).
        const methodRows = async () =>
          snapshotLines(
            (await snapshotTables(prisma)).filter(({ table }) =>
              ['evaluation.evaluation_routes', 'evaluation.route_versions'].includes(table),
            ),
          );
        const methodBefore = await methodRows();
        expect(methodBefore.length).toBeGreaterThan(0);
        const scored = await prisma.submission.findMany({ where: { taskId: workshopTaskId } });
        expect(scored.length).toBeGreaterThan(0);
        expect(scored.every((s) => s.routeVersionId !== null)).toBe(true);
        const started = Date.now();
        const run = runReset(db.url, { OCI_ENV: 'dev', OCI_SEED_RESET_CONFIRM: `${PROFILE}@dev` });
        const elapsedMs = Date.now() - started;
        expect(run.output).toContain('APPLYING');
        expect(run.status).toBe(0);
        expect(elapsedMs).toBeLessThan(60_000);

        // Everything outside the workshop objects is identical, row for row and write for write.
        expect(await untouchable()).toEqual(others);
        expect(await methodRows()).toEqual(methodBefore);

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
        // The 60 seeded tasks, the same rows, all open at the first reading.
        const tasks = await prisma.annotationTask.findMany({
          where: { campaignId: workshopCampaignId },
        });
        expect(tasks.map((t) => t.id).sort()).toEqual([...workshopAnnotationTaskIds].sort());
        expect(tasks).toHaveLength(60);
        expect(
          tasks.every(
            (t) => t.gateState === 'INDEPENDENT' && t.completedAt === null && t.skipReason === null,
          ),
        ).toBe(true);
        // READY as seeded, with its pinned version, labels and instructions.
        const campaign = await prisma.annotationCampaign.findUniqueOrThrow({
          where: { id: workshopCampaignId },
          include: { instructions: true },
        });
        const pinned = await prisma.datasetVersion.findFirstOrThrow({
          where: { dataset: { slug: DATASET }, version: '1.0.0' },
        });
        expect([
          campaign.status,
          campaign.startedAt,
          campaign.completedAt,
          campaign.manifestVersionId,
          campaign.instructions.length,
        ]).toEqual(['READY', null, null, pinned.id, 1]);
        expect(
          (campaign.workflowConfig as { classificationLabels?: unknown }).classificationLabels,
        ).toEqual(READING_LABELS);

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
        expect(run.output).toMatch(/ 0 {2}started campaigns put back to READY/);
        expect(await lines()).toEqual(before);
        replaySeedFile(db.url, profileSql);
        expect(await lines()).toEqual(before);
      });

      it('leaves the next session ready: Start, and a reader gets an image again', async () => {
        const manager = {
          sub: randomUUID(),
          'cognito:groups': ['campaign-manager'],
        } as unknown as CognitoAccessTokenPayload;
        await campaigns.transition(CAMPAIGN, 'start', undefined, manager);
        const reader = randomUUID();
        const { assignment } = await readingTasks.pullNext({
          slug: CAMPAIGN,
          user: user(reader),
          userGroups: ['annotator'],
        });
        const sample = await samples.sample({
          assignmentId: assignment?.id ?? '',
          user: user(reader),
          userGroups: ['annotator'],
        });
        expect(sample).toMatchObject({ kind: 'image', contentType: 'image/png' });
      });
    });

    // #738: the profile is replayed on every deploy where it is switched on, so
    // it must leave alone what people published on its dataset in between. Same
    // rule as the demo seed (#641, demo-seed-replay.int.spec.ts). Last in the
    // file: these cases leave the dataset with a version the seed did not write.
    describe('after people used it', () => {
      const admin = {
        sub: randomUUID(),
        'cognito:groups': ['admin'],
      } as unknown as CognitoAccessTokenPayload;

      it('keeps a version an administrator published on the dataset as the current manifest', async () => {
        const catalog = new CatalogService(
          new CatalogRepository({ client: prisma } as unknown as PrismaService),
        );
        const seeded = (await prisma.dataset.findUniqueOrThrow({ where: { slug: DATASET } }))
          .croissant as Record<string, unknown>;
        const revised = {
          ...seeded,
          version: '1.1.0',
          description: `${String(seeded.description)} Revised during the workshop.`,
        };
        await catalog.publishVersion(
          DatasetSlugSchema.parse(DATASET),
          { version: '1.1.0', croissant: revised, notes: 'workshop revision' },
          admin,
        );

        const before = await lines();
        replaySeedFile(db.url, profileSql);
        expect(changedRows(before, await lines())).toEqual([]);

        const ds = await prisma.dataset.findUniqueOrThrow({
          where: { slug: DATASET },
          include: { versions: { orderBy: { version: 'asc' } } },
        });
        expect(ds.croissant).toEqual(revised);
        expect(ds.versions.map((v) => [v.version, v.publishedById])).toEqual([
          ['1.0.0', SEED_OWNER],
          ['1.1.0', admin.sub],
        ]);
        // The seed's own version row still carries the repository's manifest.
        expect(ds.versions[0]?.croissant).toEqual(seeded);
      });

      it('does not rewrite a 1.0.0 that someone other than the seed published', async () => {
        // The campaign pins the seed's version row (ON DELETE RESTRICT), so the
        // row is taken over in place: a 1.0.0 row with another publisher, as on
        // a dataset that existed before the profile was switched on.
        const ds = await prisma.dataset.findUniqueOrThrow({ where: { slug: DATASET } });
        const own = { name: 'Chest X-ray slice, as the host published it' };
        await prisma.datasetVersion.update({
          where: { datasetId_version: { datasetId: ds.id, version: '1.0.0' } },
          data: { publishedById: admin.sub, croissant: own },
        });

        const before = await lines();
        replaySeedFile(db.url, profileSql);
        expect(changedRows(before, await lines())).toEqual([]);
      });
    });
  },
);

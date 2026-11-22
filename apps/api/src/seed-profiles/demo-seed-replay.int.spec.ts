import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditEmitter, type AuditPrismaPort } from '@oci/audit';
import type { PrismaClient } from '@oci/database';
import { CreateDatasetRequestSchema, DatasetSlugSchema } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CampaignRepository } from '../modules/annotation/campaign.repository.js';
import { TaskAbandonmentService } from '../modules/annotation/task-abandonment.service.js';
import { TaskRepository } from '../modules/annotation/task.repository.js';
import { TaskService } from '../modules/annotation/task.service.js';
import { CatalogRepository } from '../modules/catalog/catalog.repository.js';
import { CatalogService } from '../modules/catalog/catalog.service.js';
import type { PrismaService } from '../prisma.service.js';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  replaySeedFile,
  startMigratedPostgres,
} from '../test-support/migrated-postgres.js';
import { snapshotLines, snapshotTables } from '../test-support/table-snapshot.raw.js';
import type { DicomSeriesService } from '../modules/storage/dicom-series.service.js';

/**
 * #641 — the demo seed is replayed on every non-prod deploy, so it must
 * leave alone whatever people did on the seeded objects in between.
 *
 * Real Postgres with every migration applied, and the committed
 * `packages/database/seed/demo.sql` replayed the way the migrate task
 * replays it (`replaySeedFile`; what the entrypoint runs is pinned by
 * `migrate-task.spec.ts`). The sequence is: seed, make the changes a
 * participant or an operator makes through the application, seed again,
 * compare every row of every application table. Changes that have a write
 * path worth exercising go through the same service or repository the
 * controller calls; the rest are the rows those paths write.
 *
 * The seed profiles have specs of their own in this folder
 * (`radiology-workshop.int.spec.ts`). This one is about the demo seed
 * only, and about what happens between two replays of it.
 *
 * Needs a Docker daemon. CI (`CI=true`) always has one and runs this
 * spec; a laptop without Docker skips it rather than failing `pnpm test`.
 */
const dockerAvailable = await checkDocker('demo-seed-replay.int.spec');

const SEED_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/database/seed',
);
const demoSql = readFileSync(path.join(SEED_DIR, 'demo.sql'), 'utf8');
const BUCKET = 'oci-dev-datasets-test';
const SEED_OWNER = '00000000-0000-4000-8000-000000000099';

/**
 * The rows that differ between two snapshots, named by table and by slug or
 * id, without their content: a manifest runs to kilobytes. Empty when the
 * replay wrote nothing. A row counts as changed when its content or the
 * transaction that last wrote it differs.
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

/** The four datasets whose manifest ships in the repo (seed sections 1b, 3, 4). */
const FIXTURE_SLUGS = [
  'rsna-pneumonia-2018',
  'demo-clinical-notes-2024',
  'oci-demo-chest-xr',
  'idrid-grading-demo',
] as const;

/** DUO "non-commercial use only", one of the two terms the restricted demo dataset carries. */
const NON_COMMERCIAL_ONLY = 'DUO_0000046';

type Manifest = Record<string, unknown>;

function fixtureManifest(slug: string): Manifest {
  const file = path.join(SEED_DIR, 'fixtures', slug, 'manifest.json');
  return JSON.parse(readFileSync(file, 'utf8')) as Manifest;
}

function user(sub: string, groups: readonly string[]): CognitoAccessTokenPayload {
  return { sub, 'cognito:groups': groups } as unknown as CognitoAccessTokenPayload;
}

describe.skipIf(!dockerAvailable)('Demo seed replay against Postgres (#641)', () => {
  let db: MigratedPostgres;
  let prisma: PrismaClient;

  const seed = (): void => replaySeedFile(db.url, demoSql, BUCKET);
  const lines = async (): Promise<string[]> => snapshotLines(await snapshotTables(prisma));

  beforeAll(async () => {
    // The annotation service must not reach for a BullMQ scheduler.
    delete process.env.REDIS_URL;
    db = await startMigratedPostgres();
    prisma = db.prisma;
    seed();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('seeds the demo objects on first apply, with the bucket the task passes', async () => {
    expect(await prisma.dataset.count()).toBe(6);
    expect(await prisma.datasetVersion.count()).toBe(4);
    expect(await prisma.distribution.count()).toBe(35);
    expect(await prisma.annotationCampaign.count()).toBe(3);
    expect(await prisma.annotationTask.count()).toBe(38);
    expect(await prisma.evaluationTask.count()).toBe(1);
    expect(await prisma.modelCard.count()).toBe(4);
    const buckets = await prisma.distribution.findMany({
      distinct: ['s3Bucket'],
      select: { s3Bucket: true },
    });
    expect(buckets).toEqual([{ s3Bucket: BUCKET }]);
  });

  it('changes no row when replayed with nothing done in between', async () => {
    const before = await lines();
    seed();
    expect(changedRows(before, await lines())).toEqual([]);
  }, 60_000);

  it('still refreshes a fixture dataset from the repo while nobody has published on it', async () => {
    // An environment seeded from an older manifest: the guard that
    // protects published versions must not stop this refresh.
    const slug = 'rsna-pneumonia-2018';
    const older = { ...fixtureManifest(slug), description: 'An older description.' };
    const ds = await prisma.dataset.findUniqueOrThrow({ where: { slug } });
    await prisma.dataset.update({ where: { slug }, data: { croissant: older } });
    await prisma.datasetVersion.updateMany({
      where: { datasetId: ds.id },
      data: { croissant: older },
    });

    seed();

    const refreshed = await prisma.dataset.findUniqueOrThrow({
      where: { slug },
      include: { versions: true },
    });
    expect(refreshed.croissant).toEqual(fixtureManifest(slug));
    expect(refreshed.versions.map((v) => v.croissant)).toEqual([fixtureManifest(slug)]);
  }, 60_000);

  describe('after people have used the seeded objects', () => {
    const admin = user(randomUUID(), ['admin']);
    const host = user(randomUUID(), ['host']);
    const annotatorA = randomUUID();
    const annotatorB = randomUUID();
    const participant = randomUUID();

    let before: string[];
    let after: string[];
    let submittedAssignmentId: string;
    let openAssignmentId: string;
    let submissionId: string;
    let accessRequestId: string;
    let uploadedDistributionId: string;

    beforeAll(async () => {
      const prismaService = { client: prisma } as unknown as PrismaService;
      const catalog = new CatalogService(new CatalogRepository(prismaService));
      const campaigns = new CampaignRepository(prismaService);
      const taskRepo = new TaskRepository(prismaService);
      const audit = new AuditEmitter({ prisma: prisma as unknown as AuditPrismaPort });
      const tasks = new TaskService(
        campaigns,
        taskRepo,
        new TaskAbandonmentService(taskRepo, audit),
        // No DICOM series in these runs.
        { listTaskSamples: async () => [] } as unknown as DicomSeriesService,
      );

      // -- Catalogue ------------------------------------------------------
      // A new version on each dataset whose manifest the seed refreshes.
      // On the restricted one the revision also narrows the data-use
      // terms, which publishing copies to the dataset's `duo_terms`.
      for (const slug of FIXTURE_SLUGS) {
        const manifest = fixtureManifest(slug);
        const revised: Manifest = {
          ...manifest,
          version: '1.1.0',
          description: `${String(manifest.description)} Revised during the workshop.`,
        };
        if (slug === 'oci-demo-chest-xr') {
          revised['cr:consentCode'] = (manifest['cr:consentCode'] as Manifest[]).filter(
            (term) => term.termCode === NON_COMMERCIAL_ONLY,
          );
        }
        await catalog.publishVersion(
          DatasetSlugSchema.parse(slug),
          { version: '1.1.0', croissant: revised, notes: 'participant revision' },
          admin,
        );
      }

      // A first manifest on a placeholder dataset, declaring no modality.
      const { 'bio:dataModality': _modality, ...noModality } = fixtureManifest(
        'demo-clinical-notes-2024',
      );
      await catalog.publishVersion(
        DatasetSlugSchema.parse('isic-2019-melanoma'),
        {
          version: '1.0.0',
          croissant: { ...noModality, name: 'ISIC 2019, described by a participant' },
        },
        admin,
      );

      // A dataset of the participant's own, with one published version.
      await catalog.create(
        CreateDatasetRequestSchema.parse({
          slug: 'participant-chest-ct',
          name: 'Participant chest CT',
          description: 'Created by a workshop participant.',
          visibility: 'PUBLIC',
        }),
        host,
      );
      await catalog.publishVersion(
        DatasetSlugSchema.parse('participant-chest-ct'),
        {
          version: '1.0.0',
          croissant: {
            ...fixtureManifest('demo-clinical-notes-2024'),
            name: 'Participant chest CT',
          },
        },
        host,
      );

      // A file uploaded to a seeded dataset lands on its latest version,
      // as `StorageService.completeUpload` writes it.
      const idridLatest = await prisma.datasetVersion.findFirstOrThrow({
        where: { dataset: { slug: 'idrid-grading-demo' }, version: '1.1.0' },
      });
      uploadedDistributionId = (
        await prisma.distribution.create({
          data: {
            datasetVersionId: idridLatest.id,
            croissantId: 'participant-upload.png',
            contentUrl: '/v2/catalog/datasets/idrid-grading-demo/distributions',
            contentType: 'image/png',
            contentSizeBytes: 1234n,
            contentHash: 'a'.repeat(64),
            storageBackend: 'S3',
            s3Bucket: BUCKET,
            s3Key: 'idrid-grading-demo/uploads/participant-upload.png',
            uploadStatus: 'READY',
          },
        })
      ).id;

      // An access request on the seeded restricted dataset, approved.
      const restricted = await prisma.dataset.findUniqueOrThrow({
        where: { slug: 'oci-demo-chest-xr' },
      });
      accessRequestId = (
        await prisma.accessRequest.create({
          data: {
            datasetId: restricted.id,
            requesterId: participant,
            justification: 'Non-commercial research on lung opacities.',
            status: 'APPROVED',
            decidedAt: new Date(),
            decidedById: admin.sub,
            decisionNote: 'Approved in the workshop.',
            matchStatus: 'MATCHED',
          },
        })
      ).id;

      // -- Annotation -----------------------------------------------------
      // One reading submitted and one left open on the seeded running
      // campaign, through the service the annotate page calls.
      const first = await tasks.pullNext({
        slug: 'idrid-dr-grading',
        user: user(annotatorA, ['annotator']),
        userGroups: ['annotator'],
      });
      if (!first.assignment) throw new Error('seeded campaign handed out no task');
      submittedAssignmentId = first.assignment.id;
      await tasks.submit({
        assignmentId: submittedAssignmentId,
        submission: { grade: 2 },
        user: user(annotatorA, ['annotator']),
      });
      const second = await tasks.pullNext({
        slug: 'idrid-dr-grading',
        user: user(annotatorB, ['annotator']),
        userGroups: ['annotator'],
      });
      if (!second.assignment) throw new Error('seeded campaign handed out no second task');
      openAssignmentId = second.assignment.id;

      // More tasks added to a seeded campaign by its manager.
      await tasks.seed({
        slug: 'demo-rsna-segmentation',
        sampleRefs: ['rsna-pneumonia-2018/participant-sample-001'],
      });

      // Instructions published on a seeded campaign.
      const segmentation = await prisma.annotationCampaign.findUniqueOrThrow({
        where: { slug: 'demo-rsna-segmentation' },
      });
      await campaigns.publishInstructions({
        campaignId: segmentation.id,
        version: '1',
        markdownBody: 'Outline every opacity.',
        mediaUrls: [],
        createdById: admin.sub,
      });

      // The seeded DRAFT campaign started, the seeded RUNNING one completed.
      const classification = await prisma.annotationCampaign.findUniqueOrThrow({
        where: { slug: 'demo-rsna-classification' },
      });
      await campaigns.updateStatus({ id: classification.id, nextStatus: 'READY' });
      await campaigns.updateStatus({
        id: classification.id,
        nextStatus: 'RUNNING',
        stampStartedAt: true,
      });
      await campaigns.updateStatus({
        id: segmentation.id,
        nextStatus: 'COMPLETED',
        stampCompletedAt: true,
      });

      // -- Evaluation -----------------------------------------------------
      // A scored submission on the seeded task: the row the scoring path
      // writes for a predictions file.
      const task = await prisma.evaluationTask.findUniqueOrThrow({
        where: { slug: 'idrid-dr-grading' },
      });
      submissionId = (
        await prisma.submission.create({
          data: {
            taskId: task.id,
            methodName: 'Workshop team, grader v1',
            submittedBy: participant,
            mode: 'PREDICTIONS',
            status: 'SCORED',
            scores: { quadraticWeightedKappa: 0.968, accuracy: 0.8667 },
          },
        })
      ).id;

      // -- Models ---------------------------------------------------------
      // The seeded draft card published, a seeded published card withdrawn.
      await prisma.modelCard.update({
        where: { slug: 'demo-sepsis-early-warning-draft' },
        data: { status: 'PUBLISHED', clinicalSummary: 'Completed by a participant.' },
      });
      await prisma.modelCard.update({
        where: { slug: 'demo-chest-xray-triage' },
        data: { status: 'WITHDRAWN' },
      });

      before = await lines();
      seed();
      after = await lines();
    }, 180_000);

    it.each(FIXTURE_SLUGS)(
      'keeps the version published on %s as the current manifest',
      async (slug) => {
        const ds = await prisma.dataset.findUniqueOrThrow({
          where: { slug },
          include: { versions: { orderBy: { version: 'asc' } } },
        });
        const seeded = fixtureManifest(slug);
        expect((ds.croissant as Manifest).version).toBe('1.1.0');
        expect((ds.croissant as Manifest).description).toBe(
          `${String(seeded.description)} Revised during the workshop.`,
        );
        expect(ds.versions.map((v) => v.version)).toEqual(['1.0.0', '1.1.0']);
        // The seed's own version row is still the repo's manifest.
        expect(ds.versions[0]?.croissant).toEqual(seeded);
        expect(ds.versions[0]?.publishedById).toBe(SEED_OWNER);
        expect(ds.versions[1]?.publishedById).toBe(admin.sub);
      },
    );

    it('keeps the data-use terms a published version narrowed', async () => {
      const ds = await prisma.dataset.findUniqueOrThrow({ where: { slug: 'oci-demo-chest-xr' } });
      // The seed declares two terms; the participant's version kept one.
      expect(ds.duoTerms).toEqual([NON_COMMERCIAL_ONLY]);
      expect(ds.visibility).toBe('RESTRICTED');
    });

    it('keeps the modalities of a manifest published on a placeholder dataset', async () => {
      const ds = await prisma.dataset.findUniqueOrThrow({ where: { slug: 'isic-2019-melanoma' } });
      expect((ds.croissant as Manifest).name).toBe('ISIC 2019, described by a participant');
      // The manifest declares none, and the seed must not put one back.
      expect(ds.modalities).toEqual([]);
    });

    it("leaves a participant's own dataset and its version alone", async () => {
      const ds = await prisma.dataset.findUniqueOrThrow({
        where: { slug: 'participant-chest-ct' },
        include: { versions: true },
      });
      expect(ds.hostId).toBe(host.sub);
      expect(ds.status).toBe('PUBLISHED');
      expect(ds.versions).toHaveLength(1);
    });

    it('keeps a file uploaded to a seeded dataset and an approved access request', async () => {
      const upload = await prisma.distribution.findUniqueOrThrow({
        where: { id: uploadedDistributionId },
      });
      expect(upload.uploadStatus).toBe('READY');
      const request = await prisma.accessRequest.findUniqueOrThrow({
        where: { id: accessRequestId },
      });
      expect(request.status).toBe('APPROVED');
      expect(request.decisionNote).toBe('Approved in the workshop.');
    });

    it('keeps an annotation with its assignment, and an open assignment', async () => {
      const grading = await prisma.annotationCampaign.findUniqueOrThrow({
        where: { slug: 'idrid-dr-grading' },
      });
      const submitted = await prisma.annotationTaskAssignment.findUniqueOrThrow({
        where: { id: submittedAssignmentId },
        include: { task: true },
      });
      expect(submitted.status).toBe('SUBMITTED');
      expect(submitted.submission).toEqual({ grade: 2 });
      expect(submitted.assigneeUserId).toBe(annotatorA);
      expect(submitted.task.sampleRef).toMatch(/^idrid-grading-demo\/IDRiD_\d{3}\.jpg$/);
      const open = await prisma.annotationTaskAssignment.findUniqueOrThrow({
        where: { id: openAssignmentId },
      });
      expect(open.assigneeUserId).toBe(annotatorB);
      expect(open.status).not.toBe('SUBMITTED');
      expect(open.submission).toBeNull();
      // 30 seeded tasks, none duplicated by the replay.
      expect(await prisma.annotationTask.count({ where: { campaignId: grading.id } })).toBe(30);
    });

    it('keeps campaign status, instructions and added tasks', async () => {
      const classification = await prisma.annotationCampaign.findUniqueOrThrow({
        where: { slug: 'demo-rsna-classification' },
      });
      expect(classification.status).toBe('RUNNING');
      expect(classification.startedAt).not.toBeNull();
      const segmentation = await prisma.annotationCampaign.findUniqueOrThrow({
        where: { slug: 'demo-rsna-segmentation' },
        include: { instructions: true },
      });
      expect(segmentation.status).toBe('COMPLETED');
      expect(segmentation.currentInstructionsVersion).toBe('1');
      expect(segmentation.instructions).toHaveLength(1);
      // 8 seeded + 1 added.
      expect(await prisma.annotationTask.count({ where: { campaignId: segmentation.id } })).toBe(9);
    });

    it('keeps a scored submission on the seeded evaluation task', async () => {
      const submission = await prisma.submission.findUniqueOrThrow({
        where: { id: submissionId },
        include: { task: true },
      });
      expect(submission.status).toBe('SCORED');
      expect(submission.scores).toEqual({ quadraticWeightedKappa: 0.968, accuracy: 0.8667 });
      expect(submission.task.slug).toBe('idrid-dr-grading');
    });

    it('keeps the status a model card was moved to', async () => {
      const cards = await prisma.modelCard.findMany({
        where: { slug: { in: ['demo-sepsis-early-warning-draft', 'demo-chest-xray-triage'] } },
        orderBy: { slug: 'asc' },
      });
      expect(cards.map((c) => [c.slug, c.status])).toEqual([
        ['demo-chest-xray-triage', 'WITHDRAWN'],
        ['demo-sepsis-early-warning-draft', 'PUBLISHED'],
      ]);
      expect(cards[1]?.clinicalSummary).toBe('Completed by a participant.');
    });

    it('changes no row in any table', () => {
      expect(changedRows(before, after)).toEqual([]);
    });

    it('does not rewrite a version someone else published under the number the seed uses', async () => {
      // Possible only where a dataset row is older than the version row
      // the seed gives it, as the two placeholder datasets once were.
      const slug = 'demo-clinical-notes-2024';
      const ds = await prisma.dataset.findUniqueOrThrow({ where: { slug } });
      await prisma.datasetVersion.deleteMany({ where: { datasetId: ds.id } });
      const catalog = new CatalogService(
        new CatalogRepository({ client: prisma } as unknown as PrismaService),
      );
      await catalog.publishVersion(
        DatasetSlugSchema.parse(slug),
        {
          version: '1.0.0',
          croissant: { ...fixtureManifest(slug), description: "The host's own 1.0.0." },
        },
        admin,
      );

      const beforeReplay = await lines();
      seed();
      expect(changedRows(beforeReplay, await lines())).toEqual([]);
    }, 60_000);
  });
});

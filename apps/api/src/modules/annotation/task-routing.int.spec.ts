import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { AuditEmitter, type AuditPrismaPort } from '@oci/audit';
import type { PrismaClient } from '@oci/database';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import type { PrismaService } from '../../prisma.service.js';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  startMigratedPostgres,
} from '../../test-support/migrated-postgres.js';
import { CampaignRepository } from './campaign.repository.js';
import { TaskAbandonmentService } from './task-abandonment.service.js';
import { TaskRepository } from './task.repository.js';
import { TaskService } from './task.service.js';
import type { DicomSeriesService } from '../storage/dicom-series.service.js';
import type { StorageService } from '../storage/storage.service.js';

/**
 * #647 — the annotation router against a real Postgres with every
 * migration applied. Nothing about the cap or expiry is mocked: tasks
 * are seeded, pulled and submitted through `TaskService` exactly as the
 * controller does it, with `REDIS_URL` unset so the BullMQ sweeper is
 * not running.
 *
 * Needs a Docker daemon. CI (`CI=true`) always has one and runs this
 * spec; a laptop without Docker skips it rather than failing `pnpm test`.
 */
const dockerAvailable = await checkDocker('task-routing.int.spec');

const HOUR_MS = 60 * 60 * 1000;
const ANNOTATOR = ['annotator'] as const;

function user(sub: string): CognitoAccessTokenPayload {
  return { sub } as unknown as CognitoAccessTokenPayload;
}

describe.skipIf(!dockerAvailable)('Annotation router against Postgres (#647)', () => {
  let db: MigratedPostgres;
  let prisma: PrismaClient;
  let tasks: TaskRepository;
  let service: TaskService;
  let datasetId: string;
  let toolIntegrationId: string;

  beforeAll(async () => {
    // Pull-next must free abandoned slots without the scheduler.
    delete process.env.REDIS_URL;

    db = await startMigratedPostgres();
    prisma = db.prisma;

    const prismaService = { client: prisma } as unknown as PrismaService;
    tasks = new TaskRepository(prismaService);
    const audit = new AuditEmitter({ prisma: prisma as unknown as AuditPrismaPort });
    service = new TaskService(
      new CampaignRepository(prismaService),
      tasks,
      new TaskAbandonmentService(tasks, audit),
      // No DICOM series in these runs.
      { listTaskSamples: async () => [] } as unknown as DicomSeriesService,
      // The download rule has its own tests; here the manager may.
      { authoriseDatasetBytes: async () => ({}) } as unknown as StorageService,
    );

    datasetId = (
      await prisma.dataset.create({
        data: { slug: 'router-647', name: 'Router #647', hostId: randomUUID() },
      })
    ).id;
    toolIntegrationId = (
      await prisma.annotationToolIntegration.create({
        data: {
          slug: 'router-647-tool',
          name: 'Tool',
          vendor: 'test',
          version: '1',
          supportedTaskKinds: ['CLASSIFICATION'],
        },
      })
    ).id;
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function runningCampaign(args: {
    slug: string;
    nAnnotators: number;
    sampleCount: number;
  }): Promise<string> {
    const campaign = await prisma.annotationCampaign.create({
      data: {
        slug: args.slug,
        name: args.slug,
        status: 'RUNNING',
        taskKind: 'CLASSIFICATION',
        datasetId,
        toolIntegrationId,
        outputLicense: 'CC_BY_4_0',
        workflowConfig: { nAnnotators: args.nAnnotators, taskTimeoutHours: 1 },
        createdById: randomUUID(),
      },
    });
    const refs = Array.from({ length: args.sampleCount }, (_, i) => `${args.slug}-sample-${i}`);
    await service.seed({ slug: args.slug, sampleRefs: refs });
    return campaign.id;
  }

  async function pull(slug: string, sub: string) {
    return (await service.pullNext({ slug, user: user(sub), userGroups: ANNOTATOR })).assignment;
  }

  async function submit(assignmentId: string, sub: string) {
    return service.submit({ assignmentId, submission: { label: 'normal' }, user: user(sub) });
  }

  /** Pretend an assignment was handed out `hours` ago. */
  async function backdate(assignmentId: string, hours: number) {
    await prisma.annotationTaskAssignment.update({
      where: { id: assignmentId },
      data: { assignedAt: new Date(Date.now() - hours * HOUR_MS) },
    });
  }

  /** Pretend an annotator's every assignment and reading happened `hours` ago. */
  async function backdateAnnotator(campaignId: string, sub: string, hours: number) {
    const at = new Date(Date.now() - hours * HOUR_MS);
    const mine = { task: { campaignId }, assigneeUserId: cognitoSubAsUuid(sub) };
    await prisma.annotationTaskAssignment.updateMany({ where: mine, data: { assignedAt: at } });
    await prisma.annotationTaskAssignment.updateMany({
      where: { ...mine, submittedAt: { not: null } },
      data: { submittedAt: at },
    });
  }

  /** Round-robin pull + submit until a full round hands out nothing. */
  async function drain(slug: string, subs: readonly string[]) {
    // Bounded so a regression fails the assertions instead of hanging.
    for (let round = 0; round < 40; round += 1) {
      let handedOut = 0;
      for (const sub of subs) {
        const assignment = await pull(slug, sub);
        if (!assignment) continue;
        handedOut += 1;
        await submit(assignment.id, sub);
      }
      if (handedOut === 0) return;
    }
  }

  async function submittedReadings(campaignId: string) {
    return prisma.annotationTaskAssignment.count({
      where: { task: { campaignId }, gateAtAssignment: 'INDEPENDENT', status: 'SUBMITTED' },
    });
  }

  it('30 tasks × 3 readers × 3 annotators taking turns: every task gets three readings', async () => {
    const slug = 'router-647-three-readers';
    const campaignId = await runningCampaign({ slug, nAnnotators: 3, sampleCount: 30 });
    const annotators = [randomUUID(), randomUUID(), randomUUID()];

    await drain(slug, annotators);

    const rows = await prisma.annotationTask.findMany({
      where: { campaignId },
      include: { assignments: { where: { gateAtAssignment: 'INDEPENDENT', status: 'SUBMITTED' } } },
    });
    expect(rows).toHaveLength(30);
    for (const task of rows) {
      expect(task.assignments).toHaveLength(3);
      expect(new Set(task.assignments.map((a) => a.assigneeUserId)).size).toBe(3);
      // Three identical labels: unanimous, so gate 1 completes the task.
      expect(task.gateState).toBe('COMPLETED');
    }
  }, 120_000);

  it('an abandoned task goes to another annotator after the time limit, with no scheduler', async () => {
    expect(process.env.REDIS_URL).toBeUndefined();
    const slug = 'router-647-abandon';
    const campaignId = await runningCampaign({ slug, nAnnotators: 1, sampleCount: 1 });
    const [quitter, other] = [randomUUID(), randomUUID()];

    const held = await pull(slug, quitter);
    expect(held).not.toBeNull();
    // The only slot is reserved: nothing for anyone else yet.
    expect(await pull(slug, other)).toBeNull();

    await backdate(held!.id, 2); // campaign timeout is 1 h

    const reissued = await pull(slug, other);
    expect(reissued?.taskId).toBe(held!.taskId);

    const expired = await prisma.annotationTaskAssignment.findUniqueOrThrow({
      where: { id: held!.id },
    });
    expect(expired.status).toBe('EXPIRED');
    expect(expired.expiredAt).not.toBeNull();
    const auditRows = await prisma.auditEvent.findMany({
      where: { action: 'task.assignment.expired', subjectId: held!.id },
    });
    expect(auditRows).toHaveLength(1);

    // The quitter's late submission is refused; the new reader's counts.
    await expect(submit(held!.id, quitter)).rejects.toBeInstanceOf(ConflictException);
    const result = await submit(reissued!.id, other);
    expect(result.newGateState).toBe('COMPLETED');
    const task = await prisma.annotationTask.findFirstOrThrow({ where: { campaignId } });
    expect(task.gateState).toBe('COMPLETED');
  }, 60_000);

  it('the annotator who abandoned a task may read it again once it has expired', async () => {
    // Readers per task equal to the number of annotators: if expiry
    // barred the quitter from the task, it could never get its readings.
    const slug = 'router-647-return';
    const campaignId = await runningCampaign({ slug, nAnnotators: 2, sampleCount: 1 });
    const [quitter, other] = [randomUUID(), randomUUID()];

    const held = await pull(slug, quitter);
    await backdate(held!.id, 2);

    const first = await pull(slug, other);
    await submit(first!.id, other);
    const again = await pull(slug, quitter);
    expect(again?.taskId).toBe(held!.taskId);
    expect(again?.id).not.toBe(held!.id);
    await submit(again!.id, quitter);

    const task = await prisma.annotationTask.findFirstOrThrow({ where: { campaignId } });
    expect(task.gateState).toBe('COMPLETED');
  }, 60_000);

  it('a submit that races an expiry loses: the row stays EXPIRED and is not counted (#669 review)', async () => {
    const slug = 'router-669-submit-race';
    const campaignId = await runningCampaign({ slug, nAnnotators: 1, sampleCount: 1 });
    const [slow, other] = [randomUUID(), randomUUID()];

    const held = await pull(slug, slow);
    await backdate(held!.id, 2); // campaign timeout is 1 h

    // Force the interleaving: the slow annotator's submit reads the row
    // while it is still open, then the other annotator's pull expires
    // it and takes the task before the submit writes.
    const realFind = tasks.findAssignmentById.bind(tasks);
    tasks.findAssignmentById = async (id: string) => {
      const snapshot = await realFind(id);
      tasks.findAssignmentById = realFind;
      expect(snapshot?.status).toBe('PENDING');
      expect((await pull(slug, other))?.taskId).toBe(held!.taskId);
      return snapshot;
    };

    await expect(submit(held!.id, slow)).rejects.toBeInstanceOf(ConflictException);

    const row = await prisma.annotationTaskAssignment.findUniqueOrThrow({
      where: { id: held!.id },
    });
    expect(row.status).toBe('EXPIRED');
    expect(row.submission).toBeNull();
    expect(await submittedReadings(campaignId)).toBe(0);
    const task = await prisma.annotationTask.findFirstOrThrow({ where: { campaignId } });
    expect(task.gateState).toBe('INDEPENDENT');
  }, 60_000);

  it('annotators who left stop counting toward the cap, so the rest can finish (#669 review)', async () => {
    // 6 tasks × 2 readers = 12 readings, four annotators. Two read one
    // task each and leave. Counting them for ever gives cap
    // ceil(12 / 4) × 1.5 = 4.5 and the two who stay stall at 4 each:
    // 10 of 12 readings.
    const slug = 'router-669-shrinking-cohort';
    const campaignId = await runningCampaign({ slug, nAnnotators: 2, sampleCount: 6 });
    const [leaverA, leaverB, stayerA, stayerB] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    for (const sub of [leaverA, leaverB]) {
      const assignment = await pull(slug, sub);
      await submit(assignment!.id, sub);
    }
    await pull(slug, stayerA).then((a) => submit(a!.id, stayerA));
    await pull(slug, stayerB).then((a) => submit(a!.id, stayerB));

    // Timeout 1 h, activity window 2 × 1 h: three hours idle is gone.
    await backdateAnnotator(campaignId, leaverA, 3);
    await backdateAnnotator(campaignId, leaverB, 3);

    await drain(slug, [stayerA, stayerB]);

    expect(await submittedReadings(campaignId)).toBe(12);
    const open = await prisma.annotationTask.count({
      where: { campaignId, gateState: { not: 'COMPLETED' } },
    });
    expect(open).toBe(0);
  }, 60_000);

  it('a skipped task goes back to the pool and the skipper is offered another first (#646)', async () => {
    const slug = 'router-646-skip';
    await runningCampaign({ slug, nAnnotators: 1, sampleCount: 2 });
    const [skipper, other] = [randomUUID(), randomUUID()];

    const first = await pull(slug, skipper);
    await service.release({ assignmentId: first!.id, user: user(skipper) });

    const released = await prisma.annotationTaskAssignment.findUniqueOrThrow({
      where: { id: first!.id },
    });
    expect(released.status).toBe('RELEASED');
    expect(released.releasedAt).not.toBeNull();
    expect(
      await prisma.auditEvent.count({
        where: { action: 'task.assignment.released', subjectId: first!.id },
      }),
    ).toBe(1);

    // The skipper moves on to the other image …
    const next = await pull(slug, skipper);
    expect(next?.taskId).not.toBe(first!.taskId);
    // … and the skipped one is open to someone else at once.
    const forOther = await pull(slug, other);
    expect(forOther?.taskId).toBe(first!.taskId);

    // A released assignment can't be submitted or released again.
    await expect(submit(first!.id, skipper)).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.release({ assignmentId: first!.id, user: user(skipper) }),
    ).rejects.toBeInstanceOf(ConflictException);
  }, 60_000);

  it('a skipped task comes back to the skipper when nothing else is open (#646)', async () => {
    const slug = 'router-646-skip-only';
    const campaignId = await runningCampaign({ slug, nAnnotators: 1, sampleCount: 1 });
    const skipper = randomUUID();

    const first = await pull(slug, skipper);
    await service.release({ assignmentId: first!.id, user: user(skipper) });
    const again = await pull(slug, skipper);
    expect(again?.taskId).toBe(first!.taskId);
    await submit(again!.id, skipper);

    const task = await prisma.annotationTask.findFirstOrThrow({ where: { campaignId } });
    expect(task.gateState).toBe('COMPLETED');
  }, 60_000);

  it('opening the queue reserves nothing until the annotator starts (#646)', async () => {
    const slug = 'router-646-current';
    const campaignId = await runningCampaign({ slug, nAnnotators: 1, sampleCount: 1 });
    const sub = randomUUID();

    const before = await service.current({ slug, user: user(sub), userGroups: ANNOTATOR });
    expect(before.assignment).toBeNull();
    expect(await prisma.annotationTaskAssignment.count({ where: { task: { campaignId } } })).toBe(
      0,
    );

    const started = await pull(slug, sub);
    const after = await service.current({ slug, user: user(sub), userGroups: ANNOTATOR });
    expect(after.assignment?.id).toBe(started!.id);
  }, 60_000);

  it('an annotator who has read the first 50 tasks is still offered the open ones after them', async () => {
    const slug = 'router-646-deep-queue';
    await runningCampaign({ slug, nAnnotators: 2, sampleCount: 55 });
    const sub = randomUUID();

    // Seeded in one batch, the tasks share a creation time, so FIFO
    // order is by id: track what was read rather than which sample.
    const read = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const a = await pull(slug, sub);
      read.add(a!.taskId);
      await submit(a!.id, sub);
    }
    const next = await pull(slug, sub);
    expect(next).not.toBeNull();
    expect(read.has(next!.taskId)).toBe(false);
  }, 120_000);

  it('tasks already full do not hide an open one further down the queue', async () => {
    const slug = 'router-646-full-tasks';
    const campaignId = await runningCampaign({ slug, nAnnotators: 1, sampleCount: 52 });
    const tasks = await prisma.annotationTask.findMany({
      where: { campaignId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    // Make the open task strictly the newest, so it sits behind more
    // than a page of full ones whatever the tie order.
    await prisma.annotationTask.update({
      where: { id: tasks[51]!.id },
      data: { createdAt: new Date(tasks[51]!.createdAt.getTime() + 1000) },
    });
    // The first 51 in FIFO order each reserved by someone else: full,
    // but still at the independent step. Only the last one is open.
    await prisma.annotationTaskAssignment.createMany({
      data: tasks.slice(0, 51).map((t) => ({
        taskId: t.id,
        assigneeUserId: randomUUID(),
        assigneeRole: 'annotator',
        gateAtAssignment: 'INDEPENDENT' as const,
        status: 'PENDING' as const,
      })),
    });

    const open = await pull(slug, randomUUID());
    expect(open?.taskId).toBe(tasks[51]!.id);
  }, 120_000);

  it('never gives an arbiter a task they read (#646)', async () => {
    const slug = 'router-646-arbiter';
    const campaignId = await runningCampaign({ slug, nAnnotators: 1, sampleCount: 2 });
    const [read, unread] = await prisma.annotationTask.findMany({
      where: { campaignId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    // Both tasks wait for arbitration. The arbiter read the first one
    // (an earlier group membership); someone else read the second.
    await prisma.annotationTask.updateMany({
      where: { campaignId },
      data: { gateState: 'AWAITING_ARBITRATION' },
    });
    const arbiter = 'arbiter-who-read';
    await prisma.annotationTaskAssignment.createMany({
      data: [
        { taskId: read!.id, assigneeUserId: cognitoSubAsUuid(arbiter) },
        { taskId: unread!.id, assigneeUserId: randomUUID() },
      ].map((a) => ({
        ...a,
        assigneeRole: 'annotator',
        gateAtAssignment: 'INDEPENDENT' as const,
        status: 'SUBMITTED' as const,
        submission: { label: 'normal' },
        submittedAt: new Date(),
      })),
    });
    const arbitrate = async () =>
      (
        await service.pullNext({
          slug,
          user: user(arbiter),
          userGroups: ['arbitration-annotator'],
        })
      ).assignment;

    const first = await arbitrate();
    expect(first?.taskId).toBe(unread!.id);
    await service.submit({
      assignmentId: first!.id,
      submission: { label: 'normal', reason: 'agrees with the reading' },
      user: user(arbiter),
    });
    // Only the task they read is left, and they are not given it.
    expect(await arbitrate()).toBeNull();
  }, 60_000);

  it('readers who press Start together never over-fill a task (#646 review, item 1)', async () => {
    // One task needing 3 readers, 8 readers pulling at once. Without
    // the campaign's pull lock every pull saw 3 free slots: 8 assignments.
    const slug = 'router-646-parallel-start';
    const campaignId = await runningCampaign({ slug, nAnnotators: 3, sampleCount: 1 });
    const readers = Array.from({ length: 8 }, () => randomUUID());

    const pulled = await Promise.all(readers.map((sub) => pull(slug, sub)));

    expect(pulled.filter((a) => a !== null)).toHaveLength(3);
    expect(
      await prisma.annotationTaskAssignment.count({
        where: { task: { campaignId }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      }),
    ).toBe(3);
  }, 60_000);

  /** A task at arbitration, read by three readers who disagreed. */
  async function taskAwaitingArbitration(slug: string): Promise<string> {
    const campaignId = await runningCampaign({ slug, nAnnotators: 3, sampleCount: 1 });
    const task = await prisma.annotationTask.findFirstOrThrow({ where: { campaignId } });
    await prisma.annotationTask.update({
      where: { id: task.id },
      data: { gateState: 'AWAITING_ARBITRATION' },
    });
    await prisma.annotationTaskAssignment.createMany({
      data: ['normal', 'abnormal', 'normal'].map((label) => ({
        taskId: task.id,
        assigneeUserId: randomUUID(),
        assigneeRole: 'annotator',
        gateAtAssignment: 'INDEPENDENT' as const,
        status: 'SUBMITTED' as const,
        submission: { label },
        submittedAt: new Date(),
      })),
    });
    return task.id;
  }

  it('arbitration has one slot, even when arbiters pull together (#646 review, item 2)', async () => {
    const slug = 'router-646-one-arbiter';
    const taskId = await taskAwaitingArbitration(slug);
    const arbiters = [randomUUID(), randomUUID(), randomUUID()];

    const pulled = await Promise.all(
      arbiters.map(
        async (sub) =>
          (
            await service.pullNext({
              slug,
              user: user(sub),
              userGroups: ['arbitration-annotator'],
            })
          ).assignment,
      ),
    );

    const held = pulled.filter((a) => a !== null);
    expect(held).toHaveLength(1);
    expect(held[0]?.taskId).toBe(taskId);
  }, 60_000);

  it('two arbiters settling one task at once: one answer is kept, the other gets 409 (#646 review, item 2)', async () => {
    // Two arbitration assignments on one task, as the old router made
    // them (one slot per reader).
    const slug = 'router-646-two-arbiters';
    const taskId = await taskAwaitingArbitration(slug);
    const [first, second] = [randomUUID(), randomUUID()];
    const held = await Promise.all(
      [first, second].map((sub) =>
        prisma.annotationTaskAssignment.create({
          data: {
            taskId,
            assigneeUserId: cognitoSubAsUuid(sub),
            assigneeRole: 'arbitration-annotator',
            gateAtAssignment: 'AWAITING_ARBITRATION',
            status: 'PENDING',
          },
        }),
      ),
    );

    const results = await Promise.allSettled(
      (
        [
          [held[0]!.id, first, 'normal'],
          [held[1]!.id, second, 'abnormal'],
        ] as const
      ).map(([assignmentId, sub, label]) =>
        service.submit({
          assignmentId,
          submission: { label, reason: 'settles the disagreement' },
          user: user(sub),
        }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

    // One final label on the task, and the losing answer was not stored.
    const answers = await prisma.annotationTaskAssignment.findMany({
      where: { taskId, gateAtAssignment: 'AWAITING_ARBITRATION', status: 'SUBMITTED' },
    });
    expect(answers).toHaveLength(1);
    const task = await prisma.annotationTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.gateState).toBe('COMPLETED');
  }, 60_000);

  it("tasks from the dataset's hosted images: one per image, and a second run adds none (#646)", async () => {
    const version = await prisma.datasetVersion.create({
      data: { datasetId, version: '646.0', croissant: {}, publishedById: randomUUID() },
    });
    const file = (name: string, contentType: string, ready = true) => ({
      datasetVersionId: version.id,
      croissantId: randomUUID(),
      contentType,
      storageBackend: 'S3' as const,
      s3Bucket: 'oci-datasets-test',
      s3Key: `router-646/${randomUUID()}/${name}`,
      uploadStatus: ready ? ('READY' as const) : ('PENDING' as const),
    });
    await prisma.distribution.createMany({
      data: [
        file('a.png', 'image/png'),
        file('b.jpg', 'image/jpeg'),
        file('notes.csv', 'text/csv'),
        file('c.png', 'image/png', false),
      ],
    });
    await prisma.distribution.create({
      data: { datasetVersionId: version.id, croissantId: randomUUID(), contentType: 'image/png' },
    });
    const slug = 'router-646-from-dataset';
    const campaign = await prisma.annotationCampaign.create({
      data: {
        slug,
        name: slug,
        status: 'READY',
        taskKind: 'CLASSIFICATION',
        datasetId,
        manifestVersionId: version.id,
        toolIntegrationId,
        outputLicense: 'CC_BY_4_0',
        workflowConfig: { nAnnotators: 3 },
        createdById: randomUUID(),
      },
    });

    const preview = await service.seedFromDataset({ slug, dryRun: true, user: user(randomUUID()) });
    expect(preview).toEqual({ matched: 2, created: 2, skipped: 0, held: 0, dryRun: true });
    expect(await prisma.annotationTask.count({ where: { campaignId: campaign.id } })).toBe(0);

    const first = await service.seedFromDataset({ slug, dryRun: false, user: user(randomUUID()) });
    expect(first).toEqual({ matched: 2, created: 2, skipped: 0, held: 0, dryRun: false });
    const second = await service.seedFromDataset({ slug, dryRun: false, user: user(randomUUID()) });
    expect(second).toEqual({ matched: 2, created: 0, skipped: 2, held: 0, dryRun: false });

    const tasks = await prisma.annotationTask.findMany({ where: { campaignId: campaign.id } });
    // The task stores the distribution id, never the storage key (#646).
    const read = await prisma.distribution.findMany({
      where: {
        datasetVersionId: version.id,
        OR: [{ s3Key: { endsWith: '/a.png' } }, { s3Key: { endsWith: '/b.jpg' } }],
      },
      select: { id: true },
    });
    const expected = read.map((d) => `file:${d.id}`).sort();
    expect(tasks.map((t) => t.sampleRef).sort()).toEqual(expected);
    expect(tasks.every((t) => t.nAnnotatorsRequired === 3)).toBe(true);
  }, 60_000);
});

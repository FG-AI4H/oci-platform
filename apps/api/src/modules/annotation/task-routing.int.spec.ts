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
});

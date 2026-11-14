import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConflictException } from '@nestjs/common';
import { AuditEmitter, type AuditPrismaPort } from '@oci/audit';
import { PrismaClient } from '@oci/database';
import { PrismaPg } from '@prisma/adapter-pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { getContainerRuntimeClient } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
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
const dockerAvailable = await getContainerRuntimeClient().then(
  () => true,
  () => false,
);
if (!dockerAvailable && process.env.CI) {
  throw new Error('task-routing.int.spec: no Docker daemon reachable in CI');
}

const DATABASE_PKG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../packages/database',
);
const HOUR_MS = 60 * 60 * 1000;
const ANNOTATOR = ['annotator'] as const;

function user(sub: string): CognitoAccessTokenPayload {
  return { sub } as unknown as CognitoAccessTokenPayload;
}

describe.skipIf(!dockerAvailable)('Annotation router against Postgres (#647)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: TaskService;
  let datasetId: string;
  let toolIntegrationId: string;

  beforeAll(async () => {
    // Pull-next must free abandoned slots without the scheduler.
    delete process.env.REDIS_URL;

    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const url = container.getConnectionUri();
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: DATABASE_PKG,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

    const prismaService = { client: prisma } as unknown as PrismaService;
    const tasks = new TaskRepository(prismaService);
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
    await prisma?.$disconnect();
    await container?.stop();
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

  it('30 tasks × 3 readers × 3 annotators taking turns: every task gets three readings', async () => {
    const slug = 'router-647-three-readers';
    const campaignId = await runningCampaign({ slug, nAnnotators: 3, sampleCount: 30 });
    const annotators = [randomUUID(), randomUUID(), randomUUID()];

    // Round-robin until a full round hands out nothing. Bounded so a
    // regression fails the assertions below instead of hanging.
    for (let round = 0; round < 40; round += 1) {
      let handedOut = 0;
      for (const sub of annotators) {
        const assignment = await pull(slug, sub);
        if (!assignment) continue;
        handedOut += 1;
        await submit(assignment.id, sub);
      }
      if (handedOut === 0) break;
    }

    const tasks = await prisma.annotationTask.findMany({
      where: { campaignId },
      include: { assignments: { where: { gateAtAssignment: 'INDEPENDENT', status: 'SUBMITTED' } } },
    });
    expect(tasks).toHaveLength(30);
    for (const task of tasks) {
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
});

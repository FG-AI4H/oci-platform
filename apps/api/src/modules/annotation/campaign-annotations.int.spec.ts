import { randomUUID } from 'node:crypto';
import { AuditEmitter, type AuditPrismaPort } from '@oci/audit';
import type { PrismaClient } from '@oci/database';
import { AnnotationExportSchema, type AnnotationExportRow } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import type { PrismaService } from '../../prisma.service.js';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  startMigratedPostgres,
} from '../../test-support/migrated-postgres.js';
import type { DicomSeriesService } from '../storage/dicom-series.service.js';
import type { StorageService } from '../storage/storage.service.js';
import { CampaignAnnotationsService } from './campaign-annotations.service.js';
import { CampaignRepository } from './campaign.repository.js';
import { ReaderPseudonymiser } from './reader-pseudonym.js';
import { TaskAbandonmentService } from './task-abandonment.service.js';
import { TaskRepository } from './task.repository.js';
import { TaskService } from './task.service.js';

/**
 * #648 — a campaign's agreement and export against a real Postgres with
 * every migration applied. Three readers read eleven images through
 * `TaskService` as the controller does; the readers disagree on three,
 * which go to arbitration, and an arbiter settles one of them. A
 * released and an expired assignment carrying an answer are added
 * directly, to show they are never counted.
 *
 *   sample 0-4    normal × 3                closes at the independent step
 *   sample 5-7    abnormal × 3              closes at the independent step
 *   sample 8, 9   normal, normal, abnormal  arbitration (one settled: abnormal)
 *   sample 10     normal, abnormal, cannot  arbitration
 *
 * Expected, by hand (cannot assess is an answer of its own):
 *   Fleiss: P̄ = (8 + 2·⅓ + 0)/11 = 26/33; totals 20 / 12 / 1 of 33,
 *   P̄e = 545/1089; κ = 313/544 = 0.5754.
 *   Cohen a–b: p_o = 10/11, p_e = 68/121, κ = 42/53 = 0.7925.
 *   Cohen a–c and b–c: p_o = 8/11, p_e = 55/121, κ = 0.5.
 *
 * Needs a Docker daemon; skipped on a laptop without one.
 */
const dockerAvailable = await checkDocker('campaign-annotations.int.spec');

const PLAN = new Map<string, readonly [string, string, string]>(
  Object.entries({
    0: ['normal', 'normal', 'normal'],
    1: ['normal', 'normal', 'normal'],
    2: ['normal', 'normal', 'normal'],
    3: ['normal', 'normal', 'normal'],
    4: ['normal', 'normal', 'normal'],
    5: ['abnormal', 'abnormal', 'abnormal'],
    6: ['abnormal', 'abnormal', 'abnormal'],
    7: ['abnormal', 'abnormal', 'abnormal'],
    8: ['normal', 'normal', 'abnormal'],
    9: ['normal', 'normal', 'abnormal'],
    10: ['normal', 'abnormal', 'cannot-assess'],
  } as Record<string, readonly [string, string, string]>),
);
const READERS = ['reader-a', 'reader-b', 'reader-c'] as const;
const SLUG = 'agreement-648';
const REASON = 'Opacity at the right base, "subtle"; see apex';

function user(sub: string, groups: string[] = []): CognitoAccessTokenPayload {
  return { sub, 'cognito:groups': groups } as unknown as CognitoAccessTokenPayload;
}

describe.skipIf(!dockerAvailable)('Campaign agreement and export against Postgres (#648)', () => {
  let db: MigratedPostgres;
  let prisma: PrismaClient;
  let tasks: TaskService;
  let service: CampaignAnnotationsService;
  let campaignId: string;
  let settledSample: string;
  const savedKey = process.env.OCI_AUDIT_PSEUDONYM_KEY;

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    process.env.OCI_AUDIT_PSEUDONYM_KEY = 'integration-test-key-for-readers-648';
    db = await startMigratedPostgres();
    prisma = db.prisma;

    const prismaService = { client: prisma } as unknown as PrismaService;
    const taskRepo = new TaskRepository(prismaService);
    const campaignRepo = new CampaignRepository(prismaService);
    const audit = new AuditEmitter({ prisma: prisma as unknown as AuditPrismaPort });
    tasks = new TaskService(
      campaignRepo,
      taskRepo,
      new TaskAbandonmentService(taskRepo, audit),
      { listTaskSamples: async () => [] } as unknown as DicomSeriesService,
      { authoriseDatasetBytes: async () => ({}) } as unknown as StorageService,
    );
    service = new CampaignAnnotationsService(
      campaignRepo,
      taskRepo,
      new ReaderPseudonymiser(),
      audit,
    );

    const datasetId = (
      await prisma.dataset.create({
        data: { slug: 'agreement-648-ds', name: 'Agreement #648', hostId: randomUUID() },
      })
    ).id;
    const toolIntegrationId = (
      await prisma.annotationToolIntegration.create({
        data: {
          slug: 'agreement-648-tool',
          name: 'Tool',
          vendor: 'test',
          version: '1',
          supportedTaskKinds: ['CLASSIFICATION'],
        },
      })
    ).id;
    campaignId = (
      await prisma.annotationCampaign.create({
        data: {
          slug: SLUG,
          name: 'Agreement 648',
          status: 'RUNNING',
          taskKind: 'CLASSIFICATION',
          datasetId,
          toolIntegrationId,
          outputLicense: 'CC_BY_4_0',
          workflowConfig: {
            nAnnotators: 3,
            classificationLabels: {
              labels: [
                { value: 'normal', display: 'Normal' },
                { value: 'abnormal', display: 'Abnormal' },
              ],
              cannotAssess: true,
              allowComment: true,
            },
          },
          createdById: randomUUID(),
        },
      })
    ).id;
    await tasks.seed({
      slug: SLUG,
      sampleRefs: [...PLAN.keys()].map((i) => `sample-${i}`),
    });

    // Every reader reads every image; the router decides the order.
    for (let round = 0; round < PLAN.size; round += 1) {
      for (const [r, sub] of READERS.entries()) {
        const { assignment } = await tasks.pullNext({
          slug: SLUG,
          user: user(sub),
          userGroups: ['annotator'],
        });
        if (!assignment) throw new Error(`${sub} got no task in round ${round}`);
        const index = assignment.sampleRef.replace('sample-', '');
        const label = PLAN.get(index)?.at(r);
        if (!label) throw new Error(`no plan for ${assignment.sampleRef}`);
        await tasks.submit({
          assignmentId: assignment.id,
          submission: {
            label,
            ...(index === '0' && r === 0 ? { comment: '=cmd|"/c calc"!A1, then\nmore' } : {}),
          },
          user: user(sub),
        });
      }
    }

    // An arbiter settles the first disagreement.
    const { assignment: arbitration } = await tasks.pullNext({
      slug: SLUG,
      user: user('arbiter'),
      userGroups: ['arbitration-annotator'],
    });
    if (!arbitration) throw new Error('no arbitration task');
    settledSample = arbitration.sampleRef;
    await tasks.submit({
      assignmentId: arbitration.id,
      submission: { label: 'abnormal', reason: REASON },
      user: user('arbiter'),
    });

    // A released and an expired assignment, each with an answer: never counted.
    const closed = await prisma.annotationTask.findFirstOrThrow({
      where: { campaignId, sampleRef: 'sample-0' },
    });
    for (const status of ['RELEASED', 'EXPIRED'] as const) {
      await prisma.annotationTaskAssignment.create({
        data: {
          taskId: closed.id,
          assigneeUserId: cognitoSubAsUuid(`ghost-${status}`),
          assigneeRole: 'annotator',
          gateAtAssignment: 'INDEPENDENT',
          status,
          submission: { label: 'abnormal' },
        },
      });
    }
  }, 240_000);

  afterAll(async () => {
    if (savedKey === undefined) delete process.env.OCI_AUDIT_PSEUDONYM_KEY;
    else process.env.OCI_AUDIT_PSEUDONYM_KEY = savedKey;
    await db?.stop();
  });

  it('routed the disagreements to arbitration', async () => {
    const states = await prisma.annotationTask.groupBy({
      by: ['gateState'],
      where: { campaignId },
      _count: true,
    });
    expect(Object.fromEntries(states.map((s) => [s.gateState, s._count]))).toEqual({
      COMPLETED: 9,
      AWAITING_ARBITRATION: 2,
    });
    expect(['sample-8', 'sample-9', 'sample-10']).toContain(settledSample);
  });

  it('computes the agreement from the independent readings', async () => {
    const r = await service.agreement(SLUG);
    expect(r.tasks).toEqual({
      counted: 11,
      open: 0,
      skipped: 0,
      excluded: 0,
      sentToArbitration: 3,
      arbitrationShare: Math.round((3 / 11) * 10_000) / 10_000,
    });
    expect(r.readersPerTask).toBe(3);
    // The arbiter and the released / expired holders are not readers.
    expect(r.readers).toBe(3);
    expect(r.cannotAssess.readings).toBe(1);
    expect(r.overall.status).toBe('computed');
    expect(r.overall.fleissKappa).toBeCloseTo(313 / 544, 4);
    expect(r.overall.percentAgreement).toBeCloseTo(26 / 33, 4);
    expect(r.overall.unanimousTasks).toBe(8);
    expect(r.overall.interval).not.toBeNull();

    const kappas = r.pairwise.map((p) => p.cohensKappa).sort();
    expect(kappas[0]).toBeCloseTo(0.5, 4);
    expect(kappas[1]).toBeCloseTo(0.5, 4);
    expect(kappas[2]).toBeCloseTo(42 / 53, 4);
    expect(r.pairwise.every((p) => p.sharedTasks === 11)).toBe(true);
    expect(r.labelCountsByReader.map((x) => x.readings)).toEqual([11, 11, 11]);
  });

  it('exports every answer with the final label, pseudonymously, and audits it', async () => {
    const before = await prisma.auditEvent.count({
      where: { module: 'annotation', action: 'campaign.exported' },
    });
    const manager = user('manager-648', ['campaign-manager']);
    const json = await service.export(SLUG, 'json', manager);
    const doc = AnnotationExportSchema.parse(JSON.parse(json.body));

    // 33 readings + 1 arbitration; the released and expired rows are not there.
    expect(doc.rowCount).toBe(34);
    const bySample = new Map<string, AnnotationExportRow[]>();
    for (const row of doc.rows) {
      bySample.set(row.sampleRef, [...(bySample.get(row.sampleRef) ?? []), row]);
    }
    expect(bySample.get('sample-0')?.map((r) => r.label)).toEqual(['normal', 'normal', 'normal']);
    expect(bySample.get('sample-0')?.every((r) => r.finalLabel === 'normal')).toBe(true);
    expect(bySample.get('sample-0')?.[0]?.taskStatus).toBe('closed-independent');

    const settled = bySample.get(settledSample) ?? [];
    expect(settled.map((r) => r.gate)).toEqual([
      'independent',
      'independent',
      'independent',
      'arbitration',
    ]);
    expect(settled.every((r) => r.taskStatus === 'closed-arbitration')).toBe(true);
    expect(settled.every((r) => r.finalLabel === 'abnormal')).toBe(true);
    expect(settled[3]?.arbitrationReason).toBe(REASON);

    const open = ['sample-8', 'sample-9', 'sample-10'].filter((s) => s !== settledSample);
    for (const sample of open) {
      expect(bySample.get(sample)?.every((r) => r.taskStatus === 'open' && !r.finalLabel)).toBe(
        true,
      );
    }

    // The same readers as the agreement view, and no identity anywhere.
    const agreement = await service.agreement(SLUG);
    const readers = new Set(doc.rows.filter((r) => r.gate === 'independent').map((r) => r.reader));
    expect([...readers].sort()).toEqual(agreement.labelCountsByReader.map((x) => x.reader));
    for (const sub of [...READERS, 'arbiter']) {
      expect(json.body).not.toContain(cognitoSubAsUuid(sub));
      expect(json.body).not.toContain(sub);
    }

    const csv = await service.export(SLUG, 'csv', manager);
    expect(csv.body.startsWith('﻿task,sampleRef,taskStatus,reader,gate,label,')).toBe(true);
    expect(csv.body).toContain(`"'=cmd|""/c calc""!A1, then\nmore"`);
    expect(csv.body).toContain(`"Opacity at the right base, ""subtle""; see apex"`);

    const events = await prisma.auditEvent.findMany({
      where: { module: 'annotation', action: 'campaign.exported' },
      orderBy: { sequenceNumber: 'asc' },
    });
    expect(events.length - before).toBe(2);
    expect(events.at(-2)?.payload).toMatchObject({ format: 'json', rowCount: 34, taskCount: 11 });
    expect(events.at(-1)?.payload).toMatchObject({ format: 'csv', rowCount: 34 });
    expect(events.at(-1)).toMatchObject({
      subjectType: 'annotation-campaign',
      subjectId: campaignId,
      actorUserId: cognitoSubAsUuid('manager-648'),
      actorRoles: ['campaign-manager'],
    });
  });
});

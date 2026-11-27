import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@oci/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  startMigratedPostgres,
} from '../../test-support/migrated-postgres.js';
import { ReportingRepository } from './reporting.repository.js';

/**
 * #828: the counting queries of the activity report against a real Postgres
 * with every migration applied. What is in the period, what is just outside
 * it on either side, and what must not be counted at all.
 *
 * Needs a Docker daemon. CI always has one; a laptop without Docker skips.
 */

const dockerAvailable = await checkDocker('reporting.repository.int.spec');

const NOVEMBER = {
  from: new Date('2026-11-01T00:00:00.000Z'),
  to: new Date('2026-12-01T00:00:00.000Z'),
};
const BEFORE = new Date('2026-10-31T23:59:59.999Z');
const FIRST = new Date('2026-11-01T00:00:00.000Z');
const INSIDE = new Date('2026-11-15T12:00:00.000Z');
const AFTER = new Date('2026-12-01T00:00:00.000Z');

describe.skipIf(!dockerAvailable)('Activity report counts against Postgres (#828)', () => {
  let db: MigratedPostgres;
  let prisma: PrismaClient;
  let repo: ReportingRepository;

  beforeAll(async () => {
    db = await startMigratedPostgres();
    prisma = db.prisma;
    repo = new ReportingRepository({ client: prisma } as unknown as PrismaService);
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function dataset(slug: string, visibility: 'PUBLIC' | 'RESTRICTED', versions: Date[]) {
    const row = await prisma.dataset.create({
      data: {
        slug,
        name: `Dataset ${slug}`,
        hostId: randomUUID(),
        visibility,
        status: 'PUBLISHED',
      },
    });
    for (const [i, publishedAt] of versions.entries()) {
      await prisma.datasetVersion.create({
        data: {
          datasetId: row.id,
          version: `1.${i}.0`,
          croissant: {},
          publishedById: randomUUID(),
          publishedAt,
        },
      });
    }
    return row;
  }

  it('counts the versions published in the period on public datasets, the boundaries included', async () => {
    await dataset('int-828-public', 'PUBLIC', [BEFORE, FIRST, INSIDE, AFTER]);
    await dataset('int-828-restricted', 'RESTRICTED', [INSIDE]);
    await dataset('int-828-later', 'PUBLIC', [AFTER]);

    const out = await repo.datasets(NOVEMBER);

    // FIRST and INSIDE; the last instant of October and the first of December are out.
    expect(out.versionsPublished).toBe(2);
    expect(out.versions.map((v) => [v.slug, v.version])).toEqual([
      ['int-828-public', '1.2.0'],
      ['int-828-public', '1.1.0'],
    ]);
    // Published at the end of the period: not the dataset whose first version came after it.
    expect(out.publishedAtEnd).toBe(1);
  });

  it('counts access requests filed, decided and still waiting', async () => {
    const target = await dataset('int-828-requests', 'RESTRICTED', [BEFORE]);
    const request = (
      createdAt: Date,
      status: 'PENDING' | 'APPROVED' | 'DENIED' | 'REVOKED',
      decidedAt: Date | null,
    ) =>
      prisma.accessRequest.create({
        data: {
          datasetId: target.id,
          requesterId: randomUUID(),
          justification: 'int-828',
          status,
          decidedAt,
          createdAt,
        },
      });
    await request(BEFORE, 'APPROVED', INSIDE); // filed before, approved in the period
    await request(INSIDE, 'DENIED', INSIDE); // filed and denied in the period
    await request(INSIDE, 'PENDING', null); // filed in the period, still waiting
    await request(INSIDE, 'APPROVED', AFTER); // filed in the period, decided after it
    await request(BEFORE, 'REVOKED', INSIDE); // approved in the period, revoked since
    await request(AFTER, 'PENDING', null); // filed after the period

    expect(await repo.accessRequests(NOVEMBER)).toEqual({
      submitted: 3,
      approved: 1,
      denied: 1,
      // The one still pending and the one decided only after the period.
      pendingAtEnd: 2,
    });
  });

  it('counts submissions received in the period by task and outcome', async () => {
    const task = await prisma.evaluationTask.create({
      data: {
        slug: 'int-828-task',
        name: 'Task',
        datasetSlug: 'int-828-public',
        taskKind: 'GRADING',
        numClasses: 2,
        referableThreshold: 1,
        groundTruth: { a: 0 },
      },
    });
    const submission = (createdAt: Date, status: 'PENDING' | 'SCORED' | 'FAILED') =>
      prisma.submission.create({
        data: { taskId: task.id, methodName: 'm', status, createdAt },
      });
    await submission(INSIDE, 'SCORED');
    await submission(INSIDE, 'SCORED');
    await submission(INSIDE, 'FAILED');
    await submission(INSIDE, 'PENDING');
    await submission(BEFORE, 'SCORED');
    await submission(AFTER, 'SCORED');

    const byTask = await repo.submissionsByTask(NOVEMBER);

    expect(byTask.get(task.id)).toEqual({ received: 4, scored: 2, failed: 1 });
    expect(byTask.size).toBe(1);
  });

  it('counts the model cards published in the period from the audit trail', async () => {
    const card = (slug: string, status: 'DRAFT' | 'PUBLISHED') =>
      prisma.modelCard.create({
        data: {
          slug,
          intendedUse: {},
          modelClass: 'classical',
          architectureSummary: 'x',
          versionMajorMinorPatch: '1.0.0',
          trainingDataJurisdictions: [],
          status,
        },
      });
    await card('int-828-published', 'PUBLISHED');
    await card('int-828-draft', 'DRAFT');
    const moved = (occurredAt: Date, to: string, action = 'modelcard.status.changed') =>
      prisma.auditEvent.create({
        data: {
          occurredAt,
          module: 'prediction',
          action,
          subjectType: 'model-card',
          subjectId: randomUUID(),
          payload: { to },
          payloadHash: 'x',
        },
      });
    await moved(INSIDE, 'PUBLISHED');
    await moved(INSIDE, 'SUBMITTED'); // another move
    await moved(INSIDE, 'PUBLISHED', 'modelcard.updated'); // another event
    await moved(BEFORE, 'PUBLISHED');
    await moved(AFTER, 'PUBLISHED');

    expect(await repo.models(NOVEMBER)).toEqual({ published: 1, publishedInPeriod: 1 });
    expect(await repo.auditEvents(NOVEMBER)).toBe(3);
  });
});

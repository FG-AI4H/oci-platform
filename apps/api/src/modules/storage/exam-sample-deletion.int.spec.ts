import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditEmitter, payloadHash, type AuditPrismaPort } from '@oci/audit';
import type { PrismaClient } from '@oci/database';
import type { DicomInstanceHeader } from '@oci/dicom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  startMigratedPostgres,
} from '../../test-support/migrated-postgres.js';
import { DicomIndexRepository } from './dicom-index.repository.js';

/**
 * #658 — the deletion runbook's SQL, run as written against a real
 * Postgres with every migration applied.
 *
 * This is a test of the runbook, not of application code: the two
 * statements are read from `apps/migrate/statements/` and executed unchanged
 * apart from the placeholders an operator fills in, so the procedure
 * and its proof cannot drift apart. That is why raw SQL is executed
 * here, outside a `*.raw.ts` repository file.
 *
 * It shows that the deletion removes everything that hangs on one
 * dataset (versions, files' rows, DICOM index and findings, annotation
 * campaigns with tasks and answers, plain access requests), leaves
 * another dataset untouched, refuses as a whole when it meets a signed
 * record, and leaves the audit trail intact with one more event that
 * records the deletion.
 *
 * Needs a Docker daemon. CI (`CI=true`) always has one and runs this
 * spec; a laptop without Docker skips it rather than failing `pnpm test`.
 */
const dockerAvailable = await checkDocker('exam-sample-deletion.int.spec');

const SQL_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../apps/migrate/statements',
);
const COUNT_SQL = readFileSync(path.join(SQL_DIR, 'exam-sample-deletion-count.sql'), 'utf8');
const DELETE_SQL = readFileSync(path.join(SQL_DIR, 'exam-sample-deletion.sql'), 'utf8');

const BUCKET = 'oci-datasets-test';
const HOST = '00000000-0000-4000-8000-000000000658';
const READER = '00000000-0000-4000-8000-000000000659';
const STRANGER = '00000000-0000-4000-8000-000000000660';
const REFERENCE = 'DEL-2026-12-21';
const SHA = 'a'.repeat(64);
/** The one-off run the deletion is part of; the runner sets it (#739). */
const RUN = '00000000-0000-4000-8000-000000000739';

/** What an operator does by hand: put the three values into the file. */
function fill(sql: string, values: { id: string; slug: string; reference?: string }): string {
  return sql
    .replaceAll('__DATASET_ID__', values.id)
    .replaceAll('__DATASET_SLUG__', values.slug)
    .replaceAll('__REFERENCE__', values.reference ?? REFERENCE);
}

function header(overrides: Partial<DicomInstanceHeader>): DicomInstanceHeader {
  return {
    sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
    sopInstanceUid: null,
    studyInstanceUid: '1.2.826.0.1.3680043.8.498.658.1',
    seriesInstanceUid: '1.2.826.0.1.3680043.8.498.658.10',
    frameOfReferenceUid: null,
    transferSyntaxUid: '1.2.840.10008.1.2.1',
    modality: 'CT',
    seriesNumber: 1,
    instanceNumber: 1,
    imagePositionPatient: [0, 0, 0],
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    rows: 4,
    columns: 4,
    numberOfFrames: null,
    bitsAllocated: 16,
    pixelRepresentation: 1,
    photometricInterpretation: 'MONOCHROME2',
    sliceThickness: 5,
    pixelSpacing: [0.5, 0.5],
    windowCenter: 40,
    windowWidth: 80,
    hasPixelData: true,
    ...overrides,
  };
}

interface Seeded {
  id: string;
  slug: string;
  versionId: string;
  campaignId: string;
  campaignSlug: string;
  assignmentIds: string[];
  requestId: string;
}

describe.skipIf(!dockerAvailable)('exam sample deletion SQL against Postgres (#658)', () => {
  let db: MigratedPostgres;
  let prisma: PrismaClient;
  let index: DicomIndexRepository;
  let emitter: AuditEmitter;
  let toolIntegrationId: string;
  let sample: Seeded;
  let bystander: Seeded;

  type CountRow = { n: number; what: string; on_deletion: string; rows: bigint };

  async function counts(target: { id: string; slug: string }): Promise<Record<string, number>> {
    const rows = await prisma.$queryRawUnsafe<CountRow[]>(fill(COUNT_SQL, target));
    return Object.fromEntries(rows.map((row) => [row.what, Number(row.rows)]));
  }

  async function blocking(target: { id: string; slug: string }): Promise<number> {
    const rows = await prisma.$queryRawUnsafe<CountRow[]>(fill(COUNT_SQL, target));
    return rows
      .filter((row) => row.on_deletion === 'blocks')
      .reduce((sum, row) => sum + Number(row.rows), 0);
  }

  /**
   * What the one-off runner does around the statement (#739): one
   * transaction, with the run's id set for the statement to record.
   * The runner itself is tested in `apps/api/src/one-off-sql/`.
   */
  async function runDeletion(target: {
    id: string;
    slug: string;
    reference?: string;
  }): Promise<number> {
    const [, deleted] = await prisma.$transaction([
      prisma.$queryRaw`SELECT set_config('oci.one_off_run', ${RUN}, true)`,
      prisma.$executeRawUnsafe(fill(DELETE_SQL, target)),
    ]);
    return deleted;
  }

  /** A dataset the way uploads, the DICOM check and a reading campaign leave it. */
  async function seed(slug: string): Promise<Seeded> {
    const dataset = await prisma.dataset.create({
      data: {
        slug,
        name: `Deletion test ${slug}`,
        hostId: HOST,
        visibility: 'PRIVATE',
        accessTier: 'CONTROLLED',
        status: 'PUBLISHED',
        duoTerms: ['DUO_0000042'],
      },
    });
    const version = await prisma.datasetVersion.create({
      data: { datasetId: dataset.id, version: '1.0.0', croissant: {}, publishedById: HOST },
    });

    // Three DICOM files as an upload records them (clean, held with
    // findings, unreadable), and one file that is not DICOM.
    const files: Array<{ name: string; status: 'CLEAR' | 'HELD' | 'UNREADABLE' | null }> = [
      { name: 'a1.dcm', status: 'CLEAR' },
      { name: 'a2.dcm', status: 'HELD' },
      { name: 'a3.dcm', status: 'UNREADABLE' },
      { name: 'readme.txt', status: null },
    ];
    for (const [i, file] of files.entries()) {
      const key = `${slug}/${randomUUID()}/${file.name}`;
      if (file.status !== null) {
        await index.save({
          datasetId: dataset.id,
          s3Bucket: BUCKET,
          s3Key: key,
          checkStatus: file.status,
          unreadableReason: file.status === 'UNREADABLE' ? 'test' : null,
          parsed:
            file.status === 'UNREADABLE'
              ? null
              : {
                  header: header({ sopInstanceUid: `1.2.826.0.1.3680043.8.498.658.${i}` }),
                  objectKind: 'single-frame-image',
                },
          findings:
            file.status === 'HELD'
              ? [
                  { attribute: 'PatientID', valueDigest: 'digest-1' },
                  { attribute: 'StudyDate', valueDigest: 'digest-2' },
                ]
              : [],
        });
      }
      await prisma.distribution.create({
        data: {
          datasetVersionId: version.id,
          croissantId: file.name,
          contentType: file.status === null ? 'text/plain' : 'application/dicom',
          storageBackend: 'S3',
          s3Bucket: BUCKET,
          s3Key: key,
          uploadStatus: 'READY',
        },
      });
    }
    // The index writes the series row itself when it records an image
    // (#674); the upsert only makes sure one exists whatever the files were.
    await prisma.dicomSeries.upsert({
      where: {
        datasetId_seriesInstanceUid: {
          datasetId: dataset.id,
          seriesInstanceUid: '1.2.826.0.1.3680043.8.498.658.10',
        },
      },
      create: { datasetId: dataset.id, seriesInstanceUid: '1.2.826.0.1.3680043.8.498.658.10' },
      update: {},
    });

    // A reading campaign pinned to the version, with two tasks, an
    // answer, an expired assignment, and what hangs on them.
    const campaign = await prisma.annotationCampaign.create({
      data: {
        slug: `reading-${slug}`,
        name: 'Reading exercise',
        taskKind: 'CLASSIFICATION',
        datasetId: dataset.id,
        manifestVersionId: version.id,
        toolIntegrationId,
        outputLicense: 'CUSTOM_RESTRICTED',
        workflowConfig: { nAnnotators: 1 },
        createdById: HOST,
      },
    });
    await prisma.annotationCampaignInstructions.create({
      data: {
        campaignId: campaign.id,
        version: SHA,
        markdownBody: 'Read the exam.',
        mediaUrls: [],
        createdById: HOST,
      },
    });
    const assignmentIds: string[] = [];
    for (const sampleRef of ['series-1', 'series-2']) {
      const task = await prisma.annotationTask.create({
        data: { campaignId: campaign.id, sampleRef, nAnnotatorsRequired: 1 },
      });
      const assignment = await prisma.annotationTaskAssignment.create({
        data: {
          taskId: task.id,
          assigneeUserId: READER,
          assigneeRole: 'annotator',
          gateAtAssignment: 'INDEPENDENT',
          status: 'SUBMITTED',
          submission: { label: 'haemorrhage', comment: 'left frontal' },
        },
      });
      assignmentIds.push(assignment.id);
    }
    await prisma.annotatorCalibrationFlag.create({
      data: {
        campaignId: campaign.id,
        annotatorUserId: READER,
        flagType: 'SKILL',
        metric: 'vs-peers',
        score: 0.2,
        threshold: 0.4,
        sampleSize: 2,
        windowMeta: {},
      },
    });
    await prisma.annotationToolCallbackReceipt.create({
      data: {
        idempotencyKey: `key-${slug}`,
        integrationId: toolIntegrationId,
        payloadHash: SHA,
        responseStatus: 202,
        responseBody: { status: 'accepted', assignmentId: assignmentIds[0] },
      },
    });

    // A request anyone signed in could have filed, and the controller's consent.
    const request = await prisma.accessRequest.create({
      data: { datasetId: dataset.id, requesterId: STRANGER, justification: 'curious' },
    });
    await prisma.consentRecord.create({
      data: {
        datasetId: dataset.id,
        consenterSub: 'controller',
        consentType: 'ANNOTATION_USE',
        scope: {},
        disclosureText: 'Agreement of the data controller.',
        textSha256: SHA,
      },
    });

    // The audit trail as the platform writes it today for an abandoned
    // assignment: it names the campaign and the sample reference.
    await emitter.emitSync({
      module: 'annotation',
      action: 'task.assignment.expired',
      subjectType: 'annotation-task-assignment',
      subjectId: assignmentIds[1] ?? '',
      payload: { campaignSlug: campaign.slug, sampleRef: 'series-2', timeoutHours: 24 },
    });

    return {
      id: dataset.id,
      slug,
      versionId: version.id,
      campaignId: campaign.id,
      campaignSlug: campaign.slug,
      assignmentIds,
      requestId: request.id,
    };
  }

  const BEFORE = {
    dataset: 1,
    'dataset versions': 1,
    'distributions (files)': 4,
    'DICOM index: objects': 3,
    'DICOM index: findings': 2,
    'DICOM index: series': 1,
    'annotation campaigns': 1,
    'annotation campaign instructions': 1,
    'annotation tasks': 2,
    'annotation assignments and answers': 2,
    'annotator calibration flags': 1,
    'annotation tool callback receipts': 1,
    'access requests': 1,
    'signed data use agreements for those requests': 0,
    'visas issued for those requests or for this dataset': 0,
    'policy acceptances for those requests': 0,
    "files of OTHER datasets stored under this dataset's prefix": 0,
    'evaluation tasks that name this dataset': 0,
    'consent records for this dataset': 1,
    'audit events that mention the dataset or its campaigns': 1,
    'audit record of this deletion': 0,
  };

  beforeAll(async () => {
    db = await startMigratedPostgres();
    prisma = db.prisma;
    index = new DicomIndexRepository({ client: prisma } as unknown as PrismaService);
    emitter = new AuditEmitter({ prisma: prisma as unknown as AuditPrismaPort });
    toolIntegrationId = (
      await prisma.annotationToolIntegration.create({
        data: {
          slug: 'built-in-viewer-test',
          name: 'Built-in viewer',
          vendor: 'test',
          version: '1',
          supportedTaskKinds: ['CLASSIFICATION'],
        },
      })
    ).id;
    sample = await seed('sample-deletion-658');
    // A second dataset whose slug starts the same way: it must survive.
    bystander = await seed('sample-deletion-658-kept');
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('the count shows everything that hangs on the dataset, and nothing that blocks', async () => {
    expect(await counts(sample)).toEqual(BEFORE);
    expect(await blocking(sample)).toBe(0);
  });

  it('refuses to run outside the one-off runner, and deletes nothing', async () => {
    await expect(prisma.$executeRawUnsafe(fill(DELETE_SQL, sample))).rejects.toThrow(
      /through the one-off runner/,
    );
    expect(await counts(sample)).toEqual(BEFORE);
  });

  it('refuses a file whose placeholders were not filled in', async () => {
    await expect(prisma.$executeRawUnsafe(DELETE_SQL)).rejects.toThrow();
    expect(await counts(sample)).toEqual(BEFORE);
  });

  it('refuses when the slug does not belong to the id, and deletes nothing', async () => {
    await expect(runDeletion({ id: sample.id, slug: bystander.slug })).rejects.toThrow(
      /another slug/,
    );
    await expect(runDeletion({ id: sample.id, slug: sample.slug, reference: '' })).rejects.toThrow(
      /reference/,
    );
    await expect(
      runDeletion({ id: sample.id, slug: sample.slug, reference: `x"y` }),
    ).rejects.toThrow(/reference/);
    expect(await counts(sample)).toEqual(BEFORE);
    expect(await counts(bystander)).toEqual(BEFORE);
  });

  it('refuses as a whole when a signed agreement or a visa exists for the dataset', async () => {
    const signature = await prisma.duaSignature.create({
      data: {
        userId: STRANGER,
        accessRequestId: sample.requestId,
        documentText: 'agreement',
        documentSha256: SHA,
      },
    });
    expect(await blocking(sample)).toBe(1);
    await expect(runDeletion(sample)).rejects.toThrow(/signed records/);
    // All or nothing: the annotation rows deleted first in the script are still there.
    expect(await counts(sample)).toEqual({
      ...BEFORE,
      'signed data use agreements for those requests': 1,
    });
    await prisma.duaSignature.delete({ where: { id: signature.id } });

    const visa = await prisma.issuedPassportVisa.create({
      data: {
        userId: STRANGER,
        visaType: 'ControlledAccessGrants',
        value: sample.slug,
        source: 'https://issuer.example',
        jti: randomUUID(),
        kid: 'test-key',
        assertedAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await expect(runDeletion(sample)).rejects.toThrow(/signed records/);
    expect((await counts(sample))['annotation tasks']).toBe(2);
    await prisma.issuedPassportVisa.delete({ where: { id: visa.id } });
  });

  it("refuses when another dataset's file row points into this dataset's prefix", async () => {
    const stray = await prisma.distribution.create({
      data: {
        datasetVersionId: bystander.versionId,
        croissantId: 'stray.dcm',
        contentType: 'application/dicom',
        storageBackend: 'S3',
        s3Bucket: BUCKET,
        s3Key: `${sample.slug}/${randomUUID()}/stray.dcm`,
        uploadStatus: 'READY',
      },
    });
    await expect(runDeletion(sample)).rejects.toThrow(/another dataset/);
    expect((await counts(sample)).dataset).toBe(1);
    await prisma.distribution.delete({ where: { id: stray.id } });
  });

  it('deletes the dataset and everything that hangs on it, in one go', async () => {
    const auditBefore = await prisma.auditEvent.count();

    await runDeletion(sample);

    const after = await counts(sample);
    for (const [what, rows] of Object.entries(after)) {
      if (what === 'consent records for this dataset') continue;
      if (what === 'audit record of this deletion') continue;
      expect(rows, what).toBe(0);
    }
    // Looked up directly, not through the runbook's own count.
    expect(await prisma.dataset.count({ where: { id: sample.id } })).toBe(0);
    expect(
      await prisma.distribution.count({ where: { s3Key: { startsWith: `${sample.slug}/` } } }),
    ).toBe(0);
    expect(
      await prisma.dicomObject.count({ where: { s3Key: { startsWith: `${sample.slug}/` } } }),
    ).toBe(0);
    expect(await prisma.annotationCampaign.count({ where: { id: sample.campaignId } })).toBe(0);
    expect(await prisma.annotationTask.count({ where: { campaignId: sample.campaignId } })).toBe(0);
    expect(
      await prisma.annotationTaskAssignment.count({ where: { id: { in: sample.assignmentIds } } }),
    ).toBe(0);
    expect(await prisma.accessRequest.count({ where: { id: sample.requestId } })).toBe(0);

    // What stays: the controller's consent, and every earlier audit event.
    expect(after['consent records for this dataset']).toBe(1);
    expect(await prisma.auditEvent.count()).toBe(auditBefore + 1);
    expect(
      await prisma.auditEvent.count({
        where: { action: 'task.assignment.expired', subjectId: sample.assignmentIds[1] },
      }),
    ).toBe(1);
  });

  it('leaves one audit event that records the deletion, hashed as the platform hashes', async () => {
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { module: 'catalog', action: 'dataset.deleted', subjectId: sample.id },
    });
    expect((await counts(sample))['audit record of this deletion']).toBe(1);

    expect(event.subjectType).toBe('dataset');
    expect(event.actorRoles).toEqual(['operator']);
    expect(event.payload).toEqual({
      accessRequests: 1,
      annotationAssignments: 2,
      annotationCampaigns: 1,
      annotationTasks: 2,
      calibrationFlags: 1,
      callbackReceipts: 1,
      campaignInstructions: 1,
      consentRecordsKept: 1,
      datasetSlug: sample.slug,
      datasetVersions: 1,
      dicomFindings: 2,
      dicomObjects: 3,
      dicomSeries: 1,
      distributions: 4,
      oneOffRun: RUN,
      reference: REFERENCE,
      relatedAuditEventsKept: 1,
      runbook: 'exam-sample-deletion',
    });
    // The hash the SQL wrote is the one `@oci/audit` computes for this
    // payload, so an export verifier accepts the row.
    expect(event.payloadHash).toBe(payloadHash(event.payload as Record<string, unknown>));
    // The chain trigger ran: the event links to the one before it.
    const previous = await prisma.auditEvent.findFirstOrThrow({
      where: { sequenceNumber: { lt: event.sequenceNumber } },
      orderBy: { sequenceNumber: 'desc' },
    });
    expect(event.previousHash).toBe(previous.recordHash);
    expect(event.recordHash).toMatch(/^[0-9a-f]{64}$/);
    // Nothing from a file: no key, no file name, no UID, no finding.
    const text = JSON.stringify(event.payload);
    expect(text).not.toContain('.dcm');
    expect(text).not.toContain('1.2.826');
    expect(text).not.toContain('digest');
  });

  it('leaves the other dataset exactly as it was', async () => {
    expect(await counts(bystander)).toEqual(BEFORE);
    expect(await blocking(bystander)).toBe(0);
  });

  it('a second run says the dataset is gone and changes nothing', async () => {
    const auditBefore = await prisma.auditEvent.count();

    await expect(runDeletion(sample)).rejects.toThrow(/no dataset has the id/);

    expect(await prisma.auditEvent.count()).toBe(auditBefore);
    expect(await counts(bystander)).toEqual(BEFORE);
  });

  it('the audit trail cannot be edited afterwards, by this procedure or by hand', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM platform.audit_events WHERE action = 'task.assignment.expired'`,
      ),
    ).rejects.toThrow(/append-only/);
  });
});

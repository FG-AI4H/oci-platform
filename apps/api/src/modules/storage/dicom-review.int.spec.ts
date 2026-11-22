import { randomUUID } from 'node:crypto';
import type { GetObjectCommand } from '@aws-sdk/client-s3';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuditEmitter, type AuditPrismaPort } from '@oci/audit';
import type { PrismaClient } from '@oci/database';
import { ctSlice, type TestElement } from '@oci/dicom/testing';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../prisma.service.js';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  startMigratedPostgres,
} from '../../test-support/migrated-postgres.js';
import { CatalogRepository } from '../catalog/catalog.repository.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { DicomIndexRepository } from './dicom-index.repository.js';
import { DicomIndexService } from './dicom-index.service.js';
import { DicomReviewRepository } from './dicom-review.repository.js';
import { lockDatasetFindings } from './repositories/dicom-review.raw.js';
import { DicomReviewService } from './dicom-review.service.js';
import type { S3ClientProvider } from './s3-client.js';

/**
 * #674, ADR-0026 decision 2 — the operator's review of held DICOM
 * files, against a real Postgres with every migration applied.
 *
 * Nothing between the services and the database is mocked. Files are
 * real Part 10 bytes with invented patient values, indexed by the real
 * header check exactly as an upload indexes them; the values the
 * review shows are read back from those bytes; the audit event is
 * written by the real emitter in the real transaction. Only storage is
 * a stand-in: a map of key to bytes that honours `Range`.
 *
 * Needs a Docker daemon. CI (`CI=true`) always has one and runs this
 * spec; a laptop without Docker skips it rather than failing `pnpm test`.
 */
const dockerAvailable = await checkDocker('dicom-review.int.spec');

const BUCKET = 'oci-datasets-test';
const OPERATOR_SUB = '00000000-0000-4000-8000-000000000701';
const HOST_SUB = '00000000-0000-4000-8000-000000000702';
const OPERATOR = {
  sub: OPERATOR_SUB,
  'cognito:groups': ['admin'],
} as unknown as CognitoAccessTokenPayload;
const REASON = 'Study codes assigned by the host, not hospital identifiers.';

// Invented values. If one of these ever shows up in the database or
// the audit trail, a value was stored.
const PATIENT_A = 'STUDY-CODE-0001';
const PATIENT_B = 'STUDY-CODE-0002';
const NAME_A = 'Example^Anonymised';
const DATE_A = '20200101';

const patient = (id: string, extra: TestElement[] = []): TestElement[] => [
  { tag: '00100020', vr: 'LO', value: id },
  ...extra,
];

describe.skipIf(!dockerAvailable)('DICOM operator review against Postgres (#674)', () => {
  let db: MigratedPostgres;
  let prisma: PrismaClient;
  let index: DicomIndexService;
  let review: DicomReviewService;
  const objects = new Map<string, Uint8Array>();

  let previousEnv: string | undefined;
  let counter = 0;

  async function dataset(slug: string): Promise<string> {
    const row = await prisma.dataset.create({
      data: { slug, name: `Review ${slug}`, hostId: HOST_SUB, visibility: 'PUBLIC' },
    });
    return row.id;
  }

  /** Store a file and run the header check on it, as an upload does. */
  async function upload(
    datasetId: string,
    series: string,
    elements: TestElement[],
  ): Promise<{ key: string; status: string | null }> {
    counter += 1;
    const key = `review/${randomUUID()}/file-${counter}.dcm`;
    objects.set(
      key,
      ctSlice([
        { tag: '00080018', vr: 'UI', value: `${series}.${counter}` },
        { tag: '0020000e', vr: 'UI', value: series },
        ...elements,
      ]),
    );
    const status = await index.indexStoredObject({ datasetId, s3Bucket: BUCKET, s3Key: key });
    return { key, status };
  }

  const statusOf = async (key: string) =>
    (
      await prisma.dicomObject.findUniqueOrThrow({
        where: { s3Bucket_s3Key: { s3Bucket: BUCKET, s3Key: key } },
      })
    ).checkStatus;

  beforeAll(async () => {
    previousEnv = process.env.OCI_ENV;
    // The fixed local digest key; no deployed environment sets this.
    process.env.OCI_ENV = 'local';
    delete process.env.OCI_DICOM_FINDING_DIGEST_KEY;

    db = await startMigratedPostgres();
    prisma = db.prisma;
    const prismaService = { client: prisma } as unknown as PrismaService;

    const s3 = {
      bucket: BUCKET,
      client: {
        send: async (command: GetObjectCommand) => {
          const { Key, Range } = command.input;
          const bytes = objects.get(Key ?? '');
          if (!bytes) throw new Error('NoSuchKey');
          const match = /^bytes=(\d+)-(\d+)$/.exec(Range ?? '');
          if (!match) throw new Error(`unexpected range ${Range}`);
          const start = Number(match[1]);
          const end = Math.min(Number(match[2]), bytes.length - 1);
          return {
            Body: { transformToByteArray: async () => bytes.subarray(start, end + 1) },
            ContentRange: `bytes ${start}-${end}/${bytes.length}`,
          };
        },
      },
    } as unknown as S3ClientProvider;

    const audit = new AuditEmitter({ prisma: prisma as unknown as AuditPrismaPort });
    index = new DicomIndexService(s3, new DicomIndexRepository(prismaService), audit);
    review = new DicomReviewService(
      new DicomReviewRepository(prismaService),
      index,
      new CatalogService(new CatalogRepository(prismaService)),
      audit,
    );
  }, 180_000);

  afterAll(async () => {
    if (previousEnv === undefined) delete process.env.OCI_ENV;
    else process.env.OCI_ENV = previousEnv;
    await db?.stop();
  });

  it('lists what is undecided, with the value read back from the file and the files it is on', async () => {
    const id = await dataset('review-list');
    await upload(id, '1.2.3.1', patient(PATIENT_A, [{ tag: '00080020', vr: 'DA', value: DATE_A }]));
    await upload(id, '1.2.3.1', patient(PATIENT_A, [{ tag: '00080020', vr: 'DA', value: DATE_A }]));
    await upload(id, '1.2.3.2', patient(PATIENT_A));
    await upload(id, '1.2.3.3', patient(PATIENT_B));
    const clean = await upload(id, '1.2.3.4', []);
    expect(clean.status).toBe('CLEAR');

    const out = await review.review('review-list');

    expect(out).toMatchObject({
      datasetSlug: 'review-list',
      datasetName: 'Review review-list',
      heldInstanceCount: 4,
      unreadableInstanceCount: 0,
      totalFindings: 3,
      decisions: [],
    });
    // By attribute, then the most frequent first.
    expect(out.findings.map((f) => [f.attribute, f.value, f.instanceCount, f.seriesCount])).toEqual(
      [
        ['PatientID', PATIENT_A, 3, 2],
        ['PatientID', PATIENT_B, 1, 1],
        ['StudyDate', DATE_A, 2, 1],
      ],
    );
    for (const finding of out.findings) expect(finding.valueDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('releases a file only when every one of its findings is accepted', async () => {
    const id = await dataset('review-partial');
    const onlyId = await upload(id, '1.2.4.1', patient(PATIENT_A));
    const idAndName = await upload(
      id,
      '1.2.4.1',
      patient(PATIENT_A, [{ tag: '00100010', vr: 'PN', value: NAME_A }]),
    );
    const other = await upload(id, '1.2.4.2', patient(PATIENT_B));
    expect([onlyId.status, idAndName.status, other.status]).toEqual(['HELD', 'HELD', 'HELD']);

    const before = await review.review('review-partial');
    const patientA = before.findings.find((f) => f.value === PATIENT_A);
    const name = before.findings.find((f) => f.attribute === 'PatientName');
    if (!patientA || !name) throw new Error('findings missing');

    const first = await review.decide({
      slug: 'review-partial',
      body: { reason: REASON, findings: [patientA] },
      user: OPERATOR,
    });

    expect(first).toMatchObject({
      acceptedFindingCount: 1,
      releasedInstanceCount: 1,
      stillHeldInstanceCount: 2,
    });
    expect(await statusOf(onlyId.key)).toBe('RELEASED');
    // Its patient id is accepted; its patient name is not.
    expect(await statusOf(idAndName.key)).toBe('HELD');
    expect(await statusOf(other.key)).toBe('HELD');

    const after = await review.review('review-partial');
    expect(after.findings.map((f) => [f.attribute, f.value])).toEqual([
      ['PatientID', PATIENT_B],
      ['PatientName', NAME_A],
    ]);
    expect(after.decisions).toHaveLength(1);
    expect(after.decisions[0]).toMatchObject({ reason: REASON, acceptedFindingCount: 1 });

    const second = await review.decide({
      slug: 'review-partial',
      body: { reason: REASON, findings: [name] },
      user: OPERATOR,
    });
    expect(second).toMatchObject({ releasedInstanceCount: 1, stillHeldInstanceCount: 1 });
    expect(await statusOf(idAndName.key)).toBe('RELEASED');
    expect(await statusOf(other.key)).toBe('HELD');
  });

  it('records who decided, why and on what, and no value anywhere', async () => {
    const id = await dataset('review-audit');
    await upload(id, '1.2.5.1', patient(PATIENT_A, [{ tag: '00100010', vr: 'PN', value: NAME_A }]));
    await upload(id, '1.2.5.1', patient(PATIENT_A, [{ tag: '00100010', vr: 'PN', value: NAME_A }]));
    const { findings } = await review.review('review-audit');

    const result = await review.decide({
      slug: 'review-audit',
      body: { reason: REASON, findings },
      user: OPERATOR,
    });

    const decision = await prisma.dicomFindingDecision.findUniqueOrThrow({
      where: { id: result.decisionId },
      include: { accepted: true },
    });
    expect(decision).toMatchObject({ datasetId: id, reason: REASON, decidedById: OPERATOR_SUB });
    expect(decision.accepted).toHaveLength(2);

    const events = await prisma.auditEvent.findMany({
      where: { subjectId: id, action: 'dicom.findings_accepted' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      module: 'storage',
      subjectType: 'dataset',
      actorUserId: OPERATOR_SUB,
      actorRoles: ['admin'],
    });
    expect(events[0]?.payload).toMatchObject({
      datasetSlug: 'review-audit',
      decisionId: result.decisionId,
      reason: REASON,
      releasedInstanceCount: 2,
      stillHeldInstanceCount: 0,
    });
    const payload = events[0]?.payload as {
      acceptedForDataset: Array<Record<string, unknown>>;
      acceptedOnFiles: unknown[];
    };
    expect(payload.acceptedForDataset.map((a) => [a.attribute, a.instanceCount]).sort()).toEqual([
      ['PatientID', 2],
      ['PatientName', 2],
    ]);
    expect(payload.acceptedOnFiles).toEqual([]);

    // The whole database, as text: the values are in no table.
    // (The audit sequence number is a bigint.)
    const asText = (_key: string, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value;
    const dump = JSON.stringify(
      {
        objects: await prisma.dicomObject.findMany({ where: { datasetId: id } }),
        findings: await prisma.dicomFinding.findMany(),
        decisions: await prisma.dicomFindingDecision.findMany(),
        accepted: await prisma.dicomAcceptedFinding.findMany(),
        audit: await prisma.auditEvent.findMany(),
      },
      asText,
    );
    for (const value of [PATIENT_A, PATIENT_B, NAME_A, 'Anonymised']) {
      expect(dump).not.toContain(value);
    }
  });

  it('covers the same values in a file uploaded later, and holds a new value', async () => {
    const id = await dataset('review-later');
    await upload(id, '1.2.6.1', patient(PATIENT_A));
    const { findings } = await review.review('review-later');
    await review.decide({
      slug: 'review-later',
      body: { reason: REASON, findings },
      user: OPERATOR,
    });

    const sameValue = await upload(id, '1.2.6.2', patient(PATIENT_A));
    const newValue = await upload(id, '1.2.6.2', patient(PATIENT_B));
    const sameAndMore = await upload(
      id,
      '1.2.6.2',
      patient(PATIENT_A, [{ tag: '00100010', vr: 'PN', value: NAME_A }]),
    );

    expect(sameValue.status).toBe('RELEASED');
    expect(newValue.status).toBe('HELD');
    expect(sameAndMore.status).toBe('HELD');
    expect((await review.review('review-later')).findings.map((f) => f.value).sort()).toEqual([
      NAME_A,
      PATIENT_B,
    ]);
  });

  it('never lets a decision on one dataset release a file of another', async () => {
    const first = await dataset('review-one');
    const second = await dataset('review-two');
    await upload(first, '1.2.7.1', patient(PATIENT_A));
    const elsewhere = await upload(second, '1.2.7.2', patient(PATIENT_A));
    const { findings } = await review.review('review-one');

    await review.decide({ slug: 'review-one', body: { reason: REASON, findings }, user: OPERATOR });

    // Same patient id, same digest, other dataset: still held, there
    // and for any file uploaded there later.
    expect(await statusOf(elsewhere.key)).toBe('HELD');
    expect((await upload(second, '1.2.7.2', patient(PATIENT_A))).status).toBe('HELD');
    // And the digest of the first dataset cannot be used on the second
    // unless the second shows it, which here it does: it is its own
    // finding, decided on its own.
    expect((await review.review('review-two')).findings).toHaveLength(1);
  });

  it('refuses a decision that names nothing waiting, and writes nothing', async () => {
    const id = await dataset('review-nothing');
    const held = await upload(id, '1.2.8.1', patient(PATIENT_A));
    const neverSeen = { attribute: 'PatientID', valueDigest: 'ab'.repeat(32) };

    await expect(
      review.decide({
        slug: 'review-nothing',
        body: { reason: REASON, findings: [neverSeen] },
        user: OPERATOR,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await statusOf(held.key)).toBe('HELD');
    expect(await prisma.dicomFindingDecision.count({ where: { datasetId: id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { subjectId: id } })).toBe(0);
    // A value no file has shown is not accepted in advance.
    expect(await prisma.dicomAcceptedFinding.count({ where: { datasetId: id } })).toBe(0);
  });

  it('accepts only the findings that exist when given a mix, and says how many', async () => {
    const id = await dataset('review-mix');
    await upload(id, '1.2.9.1', patient(PATIENT_A));
    const { findings } = await review.review('review-mix');

    const result = await review.decide({
      slug: 'review-mix',
      body: {
        reason: REASON,
        findings: [...findings, { attribute: 'PatientID', valueDigest: 'cd'.repeat(32) }],
      },
      user: OPERATOR,
    });

    expect(result.acceptedFindingCount).toBe(1);
    expect(await prisma.dicomAcceptedFinding.count({ where: { datasetId: id } })).toBe(1);
  });

  it('does not accept the same finding twice', async () => {
    const id = await dataset('review-twice');
    await upload(id, '1.2.10.1', patient(PATIENT_A));
    const { findings } = await review.review('review-twice');
    await review.decide({
      slug: 'review-twice',
      body: { reason: REASON, findings },
      user: OPERATOR,
    });

    await expect(
      review.decide({ slug: 'review-twice', body: { reason: REASON, findings }, user: OPERATOR }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.dicomFindingDecision.count({ where: { datasetId: id } })).toBe(1);
  });

  it('reading the review changes nothing', async () => {
    const id = await dataset('review-readonly');
    const held = await upload(id, '1.2.11.1', patient(PATIENT_A));
    const before = JSON.stringify(await prisma.dicomObject.findMany({ where: { datasetId: id } }));

    await review.review('review-readonly');
    await review.review('review-readonly');
    await review.listHeld();

    expect(JSON.stringify(await prisma.dicomObject.findMany({ where: { datasetId: id } }))).toBe(
      before,
    );
    expect(await statusOf(held.key)).toBe('HELD');
    expect(await prisma.auditEvent.count({ where: { subjectId: id } })).toBe(0);
  });

  it('leaves no file behind when uploads and a decision happen at the same moment', async () => {
    const id = await dataset('review-race');
    await upload(id, '1.2.11.2', patient(PATIENT_A));
    const { findings } = await review.review('review-race');

    // Twenty files with the same value arrive while the decision is
    // being recorded. Whichever side goes first, every one of them
    // must end up released: seen by the decision, or seeing it.
    const [, ...uploads] = await Promise.all([
      review.decide({ slug: 'review-race', body: { reason: REASON, findings }, user: OPERATOR }),
      ...Array.from({ length: 20 }, () => upload(id, '1.2.11.2', patient(PATIENT_A))),
    ]);

    for (const file of uploads) expect(await statusOf(file.key)).toBe('RELEASED');
    expect(await review.review('review-race')).toMatchObject({
      heldInstanceCount: 0,
      totalFindings: 0,
    });
  });

  it('gives a finding to one of two operators who accept it at the same moment', async () => {
    const id = await dataset('review-two-operators');
    await upload(id, '1.2.11.3', patient(PATIENT_A));
    const { findings } = await review.review('review-two-operators');
    const decide = () =>
      review
        .decide({
          slug: 'review-two-operators',
          body: { reason: REASON, findings },
          user: OPERATOR,
        })
        .then(
          () => 'recorded',
          (err: unknown) =>
            err instanceof ConflictException ? 'conflict' : `error: ${String(err)}`,
        );

    const outcomes = await Promise.all([decide(), decide(), decide()]);

    expect(outcomes.sort()).toEqual(['conflict', 'conflict', 'recorded']);
    // One decision, one accepted row, one audit event: the trail and
    // the tables say the same thing.
    expect(await prisma.dicomFindingDecision.count({ where: { datasetId: id } })).toBe(1);
    expect(await prisma.dicomAcceptedFinding.count({ where: { datasetId: id } })).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { subjectId: id, action: 'dicom.findings_accepted' },
      }),
    ).toBe(1);
  });

  describe('a finding about a file as a whole', () => {
    const BURNED_IN: TestElement = { tag: '00280301', vr: 'CS', value: 'YES' };

    it('is accepted on the files held now, and holds the next file again', async () => {
      const id = await dataset('review-burned');
      const first = await upload(id, '1.2.14.1', [BURNED_IN]);
      const second = await upload(id, '1.2.14.1', [BURNED_IN]);
      expect([first.status, second.status]).toEqual(['HELD', 'HELD']);

      const before = await review.review('review-burned');
      expect(before.findings).toHaveLength(1);
      expect(before.findings[0]).toMatchObject({
        attribute: 'BurnedInAnnotation',
        wholeFile: true,
        acceptable: true,
        instanceCount: 2,
      });

      const result = await review.decide({
        slug: 'review-burned',
        body: { reason: REASON, findings: before.findings },
        user: OPERATOR,
      });
      expect(result).toMatchObject({ acceptedFindingCount: 1, releasedInstanceCount: 2 });
      expect(await statusOf(first.key)).toBe('RELEASED');
      expect(await statusOf(second.key)).toBe('RELEASED');
      // Not accepted for the dataset: on those two files.
      expect(await prisma.dicomAcceptedFinding.count({ where: { datasetId: id } })).toBe(0);

      // The next file with the same flag was looked at by nobody.
      const later = await upload(id, '1.2.14.1', [BURNED_IN]);
      expect(later.status).toBe('HELD');
      const after = await review.review('review-burned');
      expect(after).toMatchObject({ heldInstanceCount: 1, totalFindings: 1 });
      expect(after.findings[0]).toMatchObject({
        attribute: 'BurnedInAnnotation',
        instanceCount: 1,
      });
      expect(after.decisions[0]).toMatchObject({ acceptedFindingCount: 1 });

      const event = await prisma.auditEvent.findFirstOrThrow({
        where: { subjectId: id, action: 'dicom.findings_accepted' },
      });
      expect(event.payload).toMatchObject({
        acceptedForDataset: [],
        acceptedOnFiles: [{ attribute: 'BurnedInAnnotation', instanceCount: 2 }],
      });
    });

    it('keeps a new file held even when its values are all accepted', async () => {
      const id = await dataset('review-burned-mixed');
      await upload(id, '1.2.14.2', patient(PATIENT_A, [BURNED_IN]));
      const { findings } = await review.review('review-burned-mixed');
      await review.decide({
        slug: 'review-burned-mixed',
        body: { reason: REASON, findings },
        user: OPERATOR,
      });

      // Same patient code, accepted for the dataset; same flag, not.
      expect((await upload(id, '1.2.14.2', patient(PATIENT_A, [BURNED_IN]))).status).toBe('HELD');
      // Without the flag, the accepted code is enough.
      expect((await upload(id, '1.2.14.2', patient(PATIENT_A))).status).toBe('RELEASED');
      const after = await review.review('review-burned-mixed');
      expect(after.findings.map((f) => f.attribute)).toEqual(['BurnedInAnnotation']);
    });
    it('is never carried from one dataset to another', async () => {
      const first = await dataset('review-burned-one');
      const second = await dataset('review-burned-two');
      const here = await upload(first, '1.2.14.3', [BURNED_IN]);
      const elsewhere = await upload(second, '1.2.14.4', [BURNED_IN]);
      const { findings } = await review.review('review-burned-one');

      await review.decide({
        slug: 'review-burned-one',
        body: { reason: REASON, findings },
        user: OPERATOR,
      });

      expect(await statusOf(here.key)).toBe('RELEASED');
      // Same flag, same digest, other dataset.
      expect(await statusOf(elsewhere.key)).toBe('HELD');
      expect((await review.review('review-burned-two')).findings).toHaveLength(1);
    });

    it('ignores a dataset-wide acceptance of it, should such a row ever exist', async () => {
      const id = await dataset('review-burned-row');
      const held = await upload(id, '1.2.14.5', [BURNED_IN]);
      const { findings } = await review.review('review-burned-row');
      const flag = findings[0];
      if (!flag) throw new Error('finding missing');
      // Written past the service, which never writes one.
      const decision = await prisma.dicomFindingDecision.create({
        data: { datasetId: id, reason: REASON, decidedById: OPERATOR_SUB },
      });
      await prisma.dicomAcceptedFinding.create({
        data: {
          decisionId: decision.id,
          datasetId: id,
          attribute: flag.attribute,
          valueDigest: flag.valueDigest,
        },
      });

      // Still waiting for a decision, still held, and so is the next file.
      expect((await review.review('review-burned-row')).findings).toHaveLength(1);
      expect((await upload(id, '1.2.14.5', [BURNED_IN])).status).toBe('HELD');
      expect(await statusOf(held.key)).toBe('HELD');
    });
  });

  it('makes an upload wait while a decision on its dataset is being recorded', async () => {
    const id = await dataset('review-lock');
    let finished = false;
    let pending: Promise<{ key: string; status: string | null }> | undefined;

    // A decision in flight: its transaction holds the dataset's lock.
    await prisma.$transaction(async (tx) => {
      await lockDatasetFindings(tx, id);
      pending = upload(id, '1.2.18.1', patient(PATIENT_A)).then((file) => {
        finished = true;
        return file;
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      // The file's findings are not judged before the decision is in.
      expect(finished).toBe(false);
    });

    await expect(pending).resolves.toMatchObject({ status: 'HELD' });
    expect(finished).toBe(true);
    // A clean file has nothing a decision could change, and does not wait.
    await prisma.$transaction(async (tx) => {
      await lockDatasetFindings(tx, id);
      await expect(upload(id, '1.2.18.1', [])).resolves.toMatchObject({ status: 'CLEAR' });
    });
  });

  it('records which decisions released a file that nobody decided on at that moment', async () => {
    const id = await dataset('review-auto');
    await upload(id, '1.2.15.1', patient(PATIENT_A));
    const { findings } = await review.review('review-auto');
    const { decisionId } = await review.decide({
      slug: 'review-auto',
      body: { reason: REASON, findings },
      user: OPERATOR,
    });

    expect((await upload(id, '1.2.15.1', patient(PATIENT_A))).status).toBe('RELEASED');
    expect((await upload(id, '1.2.15.1', [])).status).toBe('CLEAR');

    const released = await prisma.auditEvent.findMany({
      where: { subjectId: id, action: 'dicom.file_released' },
    });
    // One event, for the one file released at upload; none for the clean one.
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({ module: 'storage', subjectType: 'dataset' });
    expect(released[0]?.payload).toMatchObject({ decisionIds: [decisionId], findingCount: 1 });
    expect(JSON.stringify(released[0]?.payload)).not.toContain(PATIENT_A);
    expect(JSON.stringify(released[0]?.payload)).not.toContain('.dcm');
  });

  describe('a value the platform cannot show', () => {
    it('cannot be accepted when it cannot be read back, and nothing is recorded', async () => {
      const id = await dataset('review-unshown');
      const gone = await upload(id, '1.2.16.1', patient(PATIENT_A));
      const kept = await upload(id, '1.2.16.2', patient(PATIENT_B));
      objects.delete(gone.key);

      const out = await review.review('review-unshown');
      const unshown = out.findings.find((f) => f.value === null);
      const shown = out.findings.find((f) => f.value === PATIENT_B);
      expect(unshown).toMatchObject({ attribute: 'PatientID', acceptable: false });
      expect(shown).toMatchObject({ acceptable: true });
      if (!unshown || !shown) throw new Error('findings missing');

      const refused = await review
        .decide({
          slug: 'review-unshown',
          body: { reason: REASON, findings: [unshown, shown] },
          user: OPERATOR,
        })
        .catch((err: unknown) => err);

      expect(refused).toBeInstanceOf(UnprocessableEntityException);
      // The answer names the finding by attribute and digest only.
      expect(JSON.stringify((refused as UnprocessableEntityException).getResponse())).toContain(
        unshown.valueDigest,
      );
      expect(await prisma.dicomFindingDecision.count({ where: { datasetId: id } })).toBe(0);
      expect(await statusOf(kept.key)).toBe('HELD');

      // The one that can be shown can still be accepted on its own.
      await review.decide({
        slug: 'review-unshown',
        body: { reason: REASON, findings: [shown] },
        user: OPERATOR,
      });
      expect(await statusOf(kept.key)).toBe('RELEASED');
      expect(await statusOf(gone.key)).toBe('HELD');
    });

    it('is shown cut and marked as cut when it is very long, and cannot be accepted', async () => {
      const id = await dataset('review-long');
      const tail = 'REAL-HOSPITAL-NUMBER-998877';
      const long = `${'CODE-'.repeat(300)}${tail}`;
      await upload(id, '1.2.17.1', [{ tag: '00101000', vr: 'LO', value: long }]);

      const out = await review.review('review-long');

      expect(out.findings).toHaveLength(1);
      const finding = out.findings[0];
      if (!finding) throw new Error('finding missing');
      expect(finding).toMatchObject({
        attribute: 'OtherPatientIDs',
        valueTruncated: true,
        acceptable: false,
      });
      expect(finding.value?.length).toBe(1000);
      expect(finding.value).not.toContain(tail);
      await expect(
        review.decide({
          slug: 'review-long',
          body: { reason: REASON, findings: [finding] },
          user: OPERATOR,
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(await prisma.dicomAcceptedFinding.count({ where: { datasetId: id } })).toBe(0);
    });
  });

  it('never releases a file whose header could not be read', async () => {
    const id = await dataset('review-unreadable');
    const key = `review/${randomUUID()}/broken.dcm`;
    const whole = ctSlice(patient(PATIENT_A));
    // Cut in the middle of the header: marked as DICOM, not readable.
    objects.set(key, whole.subarray(0, 200));
    expect(await index.indexStoredObject({ datasetId: id, s3Bucket: BUCKET, s3Key: key })).toBe(
      'UNREADABLE',
    );
    await upload(id, '1.2.12.1', patient(PATIENT_A));

    const before = await review.review('review-unreadable');
    expect(before).toMatchObject({ heldInstanceCount: 1, unreadableInstanceCount: 1 });
    await review.decide({
      slug: 'review-unreadable',
      body: { reason: REASON, findings: before.findings },
      user: OPERATOR,
    });

    expect(await statusOf(key)).toBe('UNREADABLE');
    expect(await review.review('review-unreadable')).toMatchObject({
      heldInstanceCount: 0,
      unreadableInstanceCount: 1,
    });
  });

  it('lists a finding without its value when the file can no longer be read', async () => {
    const id = await dataset('review-gone');
    const gone = await upload(id, '1.2.13.1', patient(PATIENT_A));
    objects.delete(gone.key);

    const out = await review.review('review-gone');

    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({
      attribute: 'PatientID',
      value: null,
      acceptable: false,
      instanceCount: 1,
    });
  });

  it('queues the datasets that have held files, the most held first, and no other', async () => {
    const out = await review.listHeld();

    const slugs = out.datasets.map((d) => d.slug);
    expect(slugs).toContain('review-list');
    expect(slugs).toContain('review-unreadable');
    // Everything of these was released above.
    expect(slugs).not.toContain('review-audit');
    expect(slugs).not.toContain('review-twice');
    const counts = out.datasets.map((d) => d.heldInstanceCount + d.unreadableInstanceCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(out.datasets.find((d) => d.slug === 'review-list')).toMatchObject({
      name: 'Review review-list',
      heldInstanceCount: 4,
      unreadableInstanceCount: 0,
    });
  });

  it('is a 404 for a dataset that does not exist', async () => {
    await expect(review.review('no-such-dataset')).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      review.decide({
        slug: 'no-such-dataset',
        body: {
          reason: REASON,
          findings: [{ attribute: 'PatientID', valueDigest: 'ab'.repeat(32) }],
        },
        user: OPERATOR,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

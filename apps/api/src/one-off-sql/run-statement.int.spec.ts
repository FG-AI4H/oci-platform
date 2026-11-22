import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { payloadHash } from '@oci/audit';
import type { PrismaClient } from '@oci/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  dockerAvailable as checkDocker,
  type MigratedPostgres,
  startMigratedPostgres,
} from '../test-support/migrated-postgres.js';

/**
 * #739 — the one-off statement runner, run for real as a child process
 * against a real Postgres with every migration applied.
 *
 * The statements are the ones in `apps/migrate/statements/`, unchanged:
 * what is tested is what an operator runs. A few cases use a scratch
 * statement folder to show what the runner refuses in a file.
 *
 * Needs a Docker daemon. CI (`CI=true`) always has one and runs this
 * spec; a laptop without Docker skips it rather than failing `pnpm test`.
 */
const dockerAvailable = await checkDocker('run-statement.int.spec');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RUNNER = path.join(REPO, 'apps/migrate/run-statement.mjs');
const STATEMENTS = path.join(REPO, 'apps/migrate/statements');
const DELETION_SHA = createHash('sha256')
  .update(readFileSync(path.join(STATEMENTS, 'exam-sample-deletion.sql'), 'utf8'), 'utf8')
  .digest('hex');
const HOST = '00000000-0000-4000-8000-000000000739';

// Each case starts a process that connects to Postgres; `pnpm test` runs
// the packages in parallel.
const TIMEOUT = { timeout: 120_000 };

describe.skipIf(!dockerAvailable)(
  'one-off statement runner against Postgres (#739)',
  TIMEOUT,
  () => {
    let db: MigratedPostgres;
    let prisma: PrismaClient;
    const scratch: string[] = [];

    function run(env: Record<string, string>) {
      const result = spawnSync(process.execPath, [RUNNER], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', DATABASE_URL: db.url, OCI_ENV: 'local', ...env },
      });
      return { status: result.status, out: `${result.stdout}${result.stderr}` };
    }

    /** A dataset as the deletion finds it: a version, a file row, an index row. */
    async function dataset(slug: string): Promise<{ id: string; slug: string }> {
      const row = await prisma.dataset.create({
        data: { slug, name: slug, hostId: HOST, visibility: 'PRIVATE', status: 'PUBLISHED' },
      });
      const version = await prisma.datasetVersion.create({
        data: { datasetId: row.id, version: '1.0.0', croissant: {}, publishedById: HOST },
      });
      await prisma.distribution.create({
        data: {
          datasetVersionId: version.id,
          croissantId: 'a.dcm',
          contentType: 'application/dicom',
          storageBackend: 'S3',
          s3Bucket: 'oci-datasets-test',
          s3Key: `${slug}/${randomUUID()}/a.dcm`,
          uploadStatus: 'READY',
        },
      });
      return { id: row.id, slug };
    }

    const params = (target: { id: string; slug: string }) => ({
      OCI_SQL_PARAM_DATASET_ID: target.id,
      OCI_SQL_PARAM_DATASET_SLUG: target.slug,
    });
    const applyDeletion = (
      target: { id: string; slug: string },
      extra: Record<string, string> = {},
    ) =>
      run({
        OCI_SQL_STATEMENT: 'exam-sample-deletion',
        ...params(target),
        OCI_SQL_PARAM_REFERENCE: 'DEL-2026-12-21',
        OCI_SQL_CONFIRM: 'exam-sample-deletion@local',
        OCI_SQL_SHA256: DELETION_SHA,
        OCI_SQL_OPERATOR: 'operator.one',
        OCI_SQL_REVIEWER: 'reviewer.two',
        ...extra,
      });

    /** A statement folder of the test's own, for what the runner refuses in a file. */
    function folder(statements: Record<string, { sql: string; writes: boolean; params?: object }>) {
      const dir = mkdtempSync(path.join(tmpdir(), 'oci-statements-'));
      scratch.push(dir);
      const manifest = Object.fromEntries(
        Object.entries(statements).map(([name, s]) => {
          writeFileSync(path.join(dir, `${name}.sql`), s.sql);
          return [name, { file: `${name}.sql`, writes: s.writes, params: s.params ?? {} }];
        }),
      );
      writeFileSync(path.join(dir, 'statements.json'), JSON.stringify({ statements: manifest }));
      return dir;
    }

    let target: { id: string; slug: string };
    let auditBefore: number;

    beforeAll(async () => {
      db = await startMigratedPostgres();
      prisma = db.prisma;
    }, 180_000);

    afterAll(async () => {
      for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
      await db?.stop();
    });

    beforeEach(async () => {
      target = await dataset(`one-off-${randomUUID().slice(0, 8)}`);
      auditBefore = await prisma.auditEvent.count();
    });

    const unchanged = async () => {
      expect(await prisma.dataset.count({ where: { id: target.id } })).toBe(1);
      expect(await prisma.auditEvent.count()).toBe(auditBefore);
    };

    describe('refuses before anything runs', () => {
      it.each([
        ['on prod', { OCI_ENV: 'prod' }, /runs on dev and local only/],
        ['on int', { OCI_ENV: 'int' }, /runs on dev and local only/],
        ['without an environment', { OCI_ENV: '' }, /OCI_ENV is "unset"/],
        [
          'a statement that is not listed',
          { OCI_SQL_STATEMENT: 'drop-everything' },
          /is not a statement/,
        ],
        [
          'a malformed statement name',
          { OCI_SQL_STATEMENT: '../etc/passwd' },
          /must name a statement/,
        ],
        [
          'a missing parameter',
          { OCI_SQL_PARAM_DATASET_SLUG: '' },
          /OCI_SQL_PARAM_DATASET_SLUG is required/,
        ],
        [
          'a parameter that tries to be SQL',
          { OCI_SQL_PARAM_DATASET_SLUG: "x'; DROP TABLE catalog.datasets; --" },
          /not a valid slug/,
        ],
        ['an id that is not a UUID', { OCI_SQL_PARAM_DATASET_ID: '1 OR 1=1' }, /not a valid uuid/],
        [
          'a parameter the statement does not take',
          { OCI_SQL_PARAM_EXTRA: 'x' },
          /is not a parameter/,
        ],
        [
          'a confirmation for another statement',
          { OCI_SQL_CONFIRM: 'exam-sample-deletion@local' },
          /must be exactly/,
        ],
        [
          'a confirmation for another environment',
          { OCI_SQL_CONFIRM: 'exam-sample-deletion-count@dev' },
          /must be exactly/,
        ],
      ])('%s', async (_case, override, message) => {
        const result = run({
          OCI_SQL_STATEMENT: 'exam-sample-deletion-count',
          ...params(target),
          ...override,
        });
        expect(result.status).toBe(2);
        expect(result.out).toMatch(message);
        expect(result.out).toContain('Nothing was run.');
        await unchanged();
      });

      it.each([
        [
          'without the sha256 of the statement',
          { OCI_SQL_SHA256: '' },
          /OCI_SQL_SHA256 does not match/,
        ],
        [
          'with the sha256 of another text',
          { OCI_SQL_SHA256: 'ab'.repeat(32) },
          /OCI_SQL_SHA256 does not match/,
        ],
        ['without an operator', { OCI_SQL_OPERATOR: '' }, /OCI_SQL_OPERATOR must name/],
        ['without a reviewer', { OCI_SQL_REVIEWER: '' }, /OCI_SQL_REVIEWER must name/],
        ['with the operator as reviewer', { OCI_SQL_REVIEWER: 'Operator.One' }, /another person/],
        [
          'with a sentence for a name',
          { OCI_SQL_OPERATOR: 'Robert; DROP' },
          /OCI_SQL_OPERATOR must name/,
        ],
        [
          'against a database whose address says prod',
          { DATABASE_URL: 'postgresql://u:p@db-prod.internal:5432/oci' },
          /contains "prod"/,
        ],
      ])('an apply %s', async (_case, override, message) => {
        const result = applyDeletion(target, override);
        expect(result.status).toBe(2);
        expect(result.out).toMatch(message);
        await unchanged();
      });

      it("on dev, a task whose database is another environment's, whatever OCI_ENV says", async () => {
        // OCI_ENV can be overridden at launch; the database name cannot.
        const result = run({
          OCI_ENV: 'dev',
          DATABASE_URL: '',
          DB_USERNAME: 'u',
          DB_PASSWORD: 'secret-password',
          DB_HOST: 'db.internal',
          DB_PORT: '5432',
          DB_NAME: 'oci_int',
          OCI_SQL_STATEMENT: 'exam-sample-deletion-count',
          ...params(target),
        });
        expect(result.status).toBe(2);
        expect(result.out).toMatch(/is "oci_int", not "oci_dev": this task is not on dev/);
        expect(result.out).not.toContain('secret-password');
      });

      it("on dev, a connection string instead of the task's own database settings", async () => {
        const result = run({
          OCI_ENV: 'dev',
          OCI_SQL_STATEMENT: 'exam-sample-deletion-count',
          ...params(target),
        });
        expect(result.status).toBe(2);
        expect(result.out).toMatch(/A deployed task connects with the DB_\* fields/);
      });

      it("on dev, another statement folder than the image's", async () => {
        const result = run({
          OCI_ENV: 'dev',
          OCI_SQL_DIR: '/tmp',
          OCI_SQL_STATEMENT: 'exam-sample-deletion-count',
        });
        expect(result.status).toBe(2);
        expect(result.out).toMatch(/OCI_SQL_DIR is for a local stack only/);
      });

      it('a parameter named like a property every object has', async () => {
        const result = run({
          OCI_SQL_STATEMENT: 'exam-sample-deletion-count',
          ...params(target),
          OCI_SQL_PARAM_toString: 'x',
        });
        expect(result.status).toBe(2);
        expect(result.out).toMatch(/OCI_SQL_PARAM_toString is not a parameter/);
      });

      it('a malformed connection string, without printing it', async () => {
        const result = run({
          DATABASE_URL: 'postgres://u:secret-password@[not-a-host]:5432/db',
          OCI_SQL_STATEMENT: 'exam-sample-deletion-count',
          ...params(target),
        });
        expect(result.status).toBe(2);
        expect(result.out).toMatch(/DATABASE_URL is not a valid address/);
        expect(result.out).not.toContain('secret-password');
      });

      it('a dry run never prints a hash an operator could paste to apply', async () => {
        const result = run({
          OCI_SQL_STATEMENT: 'exam-sample-deletion',
          ...params(target),
          OCI_SQL_PARAM_REFERENCE: 'DEL-2026-12-21',
        });
        expect(result.status).toBe(0);
        expect(result.out).not.toMatch(/OCI_SQL_SHA256=[0-9a-f]{64}/);
      });

      it('an apply of a statement that only reads', async () => {
        const result = run({
          OCI_SQL_STATEMENT: 'exam-sample-deletion-count',
          ...params(target),
          OCI_SQL_CONFIRM: 'exam-sample-deletion-count@local',
        });
        expect(result.status).toBe(2);
        expect(result.out).toMatch(/only reads: there is nothing to apply/);
        await unchanged();
      });

      it('a file with transaction control in it', async () => {
        const dir = folder({
          sneaky: { sql: 'DELETE FROM catalog.datasets;\nCOMMIT;\n', writes: true },
        });
        const result = run({ OCI_SQL_DIR: dir, OCI_SQL_STATEMENT: 'sneaky' });
        expect(result.status).toBe(2);
        expect(result.out).toMatch(/contains transaction control/);
        await unchanged();
      });

      it('a file with a placeholder the manifest does not declare', async () => {
        const dir = folder({
          undeclared: { sql: "SELECT '__SECRET__'::text AS v;\n", writes: false },
        });
        const result = run({ OCI_SQL_DIR: dir, OCI_SQL_STATEMENT: 'undeclared' });
        expect(result.status).toBe(2);
        expect(result.out).toMatch(/placeholders the manifest does not declare: SECRET/);
      });
    });

    describe('a statement that ends the transaction itself', () => {
      it('is reported as possibly committed, never as a dry run', async () => {
        // Passes the file check (END is not at the start of a line), so the
        // runner's own check after the statement is what catches it.
        const dir = folder({
          sneaky: {
            sql: "UPDATE catalog.datasets SET name = 'changed' WHERE slug = '__SLUG__'; END;\n",
            writes: true,
            params: { SLUG: 'slug' },
          },
        });
        const result = run({
          OCI_SQL_DIR: dir,
          OCI_SQL_STATEMENT: 'sneaky',
          OCI_SQL_PARAM_SLUG: target.slug,
        });

        expect(result.status).toBe(1);
        expect(result.out).toMatch(/MAY HAVE BEEN COMMITTED/);
        expect(result.out).not.toContain('rolled back, nothing was changed');
        // And it was: the runner says so because it cannot undo it.
        const row = await prisma.dataset.findUniqueOrThrow({ where: { id: target.id } });
        expect(row.name).toBe('changed');
      });
    });

    describe('a statement that only reads', () => {
      it('prints its rows and changes nothing', async () => {
        const result = run({ OCI_SQL_STATEMENT: 'exam-sample-deletion-count', ...params(target) });

        expect(result.status).toBe(0);
        expect(result.out).toContain('reads only; DRY RUN');
        expect(result.out).toMatch(/row \{.*"what":"distributions \(files\)".*\}/);
        expect(result.out).toContain('rolled back, nothing was changed');
        await unchanged();
      });

      it('cannot write, even if its file tries to', async () => {
        const dir = folder({
          mislabelled: { sql: 'DELETE FROM catalog.datasets;\n', writes: false },
        });
        const result = run({ OCI_SQL_DIR: dir, OCI_SQL_STATEMENT: 'mislabelled' });

        expect(result.status).toBe(1);
        expect(result.out).toMatch(/read-only transaction/);
        expect(result.out).toContain('rolled back, nothing was changed');
        await unchanged();
      });
    });

    describe('the sample deletion', () => {
      it('as a dry run, shows what it would delete and deletes nothing', async () => {
        const result = run({
          OCI_SQL_STATEMENT: 'exam-sample-deletion',
          ...params(target),
          OCI_SQL_PARAM_REFERENCE: 'DEL-2026-12-21',
        });

        expect(result.status).toBe(0);
        expect(result.out).toContain('writes; DRY RUN');
        expect(result.out).toMatch(/notice: deleted dataset .*: 1 version\(s\), 1 file row\(s\)/);
        expect(result.out).toContain('OCI_SQL_SHA256 computed from the file you reviewed');
        await unchanged();
      });

      it('applied, deletes the dataset and records the run twice, chained as the platform chains', async () => {
        const result = applyDeletion(target);

        expect(result.status).toBe(0);
        expect(result.out).toContain('APPLY');
        expect(await prisma.dataset.count({ where: { id: target.id } })).toBe(0);

        const events = await prisma.auditEvent.findMany({
          where: { sequenceNumber: { gt: 0 } },
          orderBy: { sequenceNumber: 'asc' },
        });
        const fresh = events.slice(auditBefore);
        expect(fresh.map((e) => `${e.module}.${e.action}`)).toEqual([
          'catalog.dataset.deleted',
          'platform.sql.statement_applied',
        ]);
        const [deleted, applied] = fresh;
        if (!deleted || !applied) throw new Error('events missing');

        const runId = /one-off: run ([0-9a-f-]{36})/.exec(result.out)?.[1];
        expect(applied).toMatchObject({
          subjectType: 'one_off_run',
          subjectId: runId,
          // No verified identity inside the task: no actor, said plainly.
          actorUserId: null,
          actorRoles: ['operator'],
        });
        expect(applied.payload).toEqual({
          environment: 'local',
          operator: 'operator.one',
          params: {
            DATASET_ID: target.id,
            DATASET_SLUG: target.slug,
            REFERENCE: 'DEL-2026-12-21',
          },
          reviewer: 'reviewer.two',
          run: runId,
          sha256: DELETION_SHA,
          statement: 'exam-sample-deletion',
          taskArn: null,
        });
        expect(deleted.actorUserId).toBeNull();
        expect((deleted.payload as { oneOffRun?: string }).oneOffRun).toBe(runId);

        // Both hashed as `@oci/audit` hashes, and chained by the trigger:
        // a chain verifier sees no break.
        for (const event of fresh) {
          expect(event.payloadHash).toBe(payloadHash(event.payload as Record<string, unknown>));
        }
        // The first event of the trail links to nothing.
        const before = auditBefore === 0 ? null : (events[auditBefore - 1]?.recordHash ?? null);
        expect(deleted.previousHash).toBe(before);
        expect(applied.previousHash).toBe(deleted.recordHash);
      });

      it('applied a second time, fails, and changes and records nothing', async () => {
        expect(applyDeletion(target).status).toBe(0);
        const afterFirst = await prisma.auditEvent.count();

        const second = applyDeletion(target);

        expect(second.status).toBe(1);
        expect(second.out).toMatch(/no dataset has the id/);
        expect(second.out).toContain('rolled back, nothing was changed');
        expect(await prisma.auditEvent.count()).toBe(afterFirst);
      });

      it("applied with a slug that is not the dataset's, deletes nothing and records nothing", async () => {
        const other = await dataset(`one-off-${randomUUID().slice(0, 8)}`);
        auditBefore = await prisma.auditEvent.count();

        const result = applyDeletion({ id: target.id, slug: other.slug });

        expect(result.status).toBe(1);
        expect(result.out).toMatch(/another slug/);
        await unchanged();
        expect(await prisma.dataset.count({ where: { id: other.id } })).toBe(1);
      });
    });
  },
);

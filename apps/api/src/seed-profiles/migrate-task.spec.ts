import { execFile } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * #644: what the migrate task does around a seed profile, without a
 * database. Two halves:
 *
 *   - `entrypoint.sh` run for real under `sh`, with `prisma` and the node
 *     scripts replaced by recorders, so each case pins the exact commands
 *     and SQL the task would run. The cases without a profile pin what the
 *     task did BEFORE profiles existed: that must not move.
 *   - the fixture uploader and the readiness check run for real, as child
 *     processes, against an S3 stand-in served from this process.
 *
 * `OCI_ENTRYPOINT_UNDER_TEST` / `OCI_UPLOADER_UNDER_TEST` point the same
 * cases at another copy of the two files (the versions on the main branch,
 * to show the default behaviour is byte for byte the same).
 */

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../../../..');
const MIGRATE = path.join(REPO, 'apps/migrate');
const SEED_DIR = path.join(REPO, 'packages/database/seed');
const ENTRYPOINT = process.env.OCI_ENTRYPOINT_UNDER_TEST ?? path.join(MIGRATE, 'entrypoint.sh');
const UPLOADER = process.env.OCI_UPLOADER_UNDER_TEST ?? path.join(MIGRATE, 'upload-fixtures.mjs');
const PROFILE = 'radiology-workshop';
const DATASET = 'nih-chestxray14-workshop';

const scratch: string[] = [];
function tmp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  // Retries: on a busy machine a recursive delete can meet a directory the
  // system has not finished emptying, and a leftover temp directory is no
  // reason to fail the suite.
  for (const dir of scratch) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

async function exec(
  file: string,
  args: string[],
  options: { cwd?: string; env: Record<string, string> },
): Promise<Outcome> {
  try {
    const { stdout, stderr } = await run(file, args, { ...options, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

// --- entrypoint.sh -------------------------------------------------------------

const DEMO_SQL = '-- demo seed stand-in\nSELECT 1;\n';
const PROFILE_SQL = '-- profile seed stand-in\nSELECT 2;\n';

/** A copy of the image's /app with recorders in place of prisma and the node scripts. */
function sandbox(): { dir: string; log: () => string[]; sql: () => string[] } {
  const dir = tmp('oci-entrypoint-');
  cpSync(ENTRYPOINT, path.join(dir, 'entrypoint.sh'));
  mkdirSync(path.join(dir, 'node_modules/.bin'), { recursive: true });
  mkdirSync(path.join(dir, 'bin'));
  mkdirSync(path.join(dir, 'seed/profiles/p1'), { recursive: true });
  mkdirSync(path.join(dir, 'sql'));
  writeFileSync(path.join(dir, 'seed/demo.sql'), DEMO_SQL);
  writeFileSync(path.join(dir, 'seed/profiles/p1/seed.sql'), PROFILE_SQL);
  writeFileSync(path.join(dir, 'upload-fixtures.mjs'), '');

  // prisma: record the arguments; keep a copy of the file given to `--file`.
  writeFileSync(
    path.join(dir, 'node_modules/.bin/prisma'),
    [
      '#!/bin/sh',
      'case "$*" in',
      '  *--file*) for last; do :; done',
      '    n=$(ls "$SANDBOX/sql" | wc -l | tr -d " ")',
      '    cp "$last" "$SANDBOX/sql/$n.sql"',
      '    echo "prisma db execute --file <script>" >> "$SANDBOX/log" ;;',
      '  *) echo "prisma $*" >> "$SANDBOX/log" ;;',
      'esac',
      '',
    ].join('\n'),
  );
  // node: `-e` (the password encoding) runs for real; a script is recorded with
  // the two variables the profile mode sets. The readiness check answers what
  // the case asks of it.
  writeFileSync(
    path.join(dir, 'bin/node'),
    [
      '#!/bin/sh',
      'if [ "$1" = "-e" ]; then exec "$REAL_NODE" "$@"; fi',
      'echo "node $* dir=${SEED_FIXTURES_DIR:-} profile=${SEED_FIXTURES_PROFILE:-}" >> "$SANDBOX/log"',
      'case "$1" in *seed-profile-check*) exit "${CHECK_EXIT:-0}" ;; esac',
      '',
    ].join('\n'),
  );
  chmodSync(path.join(dir, 'node_modules/.bin/prisma'), 0o755);
  chmodSync(path.join(dir, 'bin/node'), 0o755);

  return {
    dir,
    log: () =>
      existsSync(path.join(dir, 'log'))
        ? readFileSync(path.join(dir, 'log'), 'utf8').trim().split('\n')
        : [],
    sql: () =>
      readdirSync(path.join(dir, 'sql'))
        .sort()
        .map((f) => readFileSync(path.join(dir, 'sql', f), 'utf8')),
  };
}

async function entrypoint(env: Record<string, string>) {
  const box = sandbox();
  const outcome = await exec('sh', ['entrypoint.sh'], {
    cwd: box.dir,
    env: {
      PATH: `${path.join(box.dir, 'bin')}:${process.env.PATH ?? ''}`,
      SANDBOX: box.dir,
      REAL_NODE: process.execPath,
      DB_USERNAME: 'u',
      DB_PASSWORD: 'p@ss/word',
      DB_HOST: 'db.internal',
      DB_PORT: '5432',
      DB_NAME: 'oci',
      ...env,
    },
  });
  return { ...outcome, log: box.log(), sql: box.sql() };
}

const DEMO_COMMANDS = [
  'prisma migrate deploy',
  'node ./upload-fixtures.mjs dir= profile=',
  'prisma db execute --file <script>',
];
const DEMO_OUTPUT = [
  'migrate: running prisma migrate deploy',
  'seed: uploading bundled fixtures to s3://bkt',
  'seed: OCI_ENV=dev — replaying demo-data seed (./seed/demo.sql)',
  'seed: done',
  '',
].join('\n');

// Every case starts child processes, and `pnpm test` runs the packages in
// parallel: the default 5 s is not enough on a loaded machine.
const TIMEOUT = { timeout: 60_000 };

describe('migrate entrypoint', TIMEOUT, () => {
  it('without a profile, does exactly what it did before profiles existed', async () => {
    const unsetOrEmpty: Record<string, string>[] = [{}, { OCI_SEED_PROFILES: '' }];
    for (const profiles of unsetOrEmpty) {
      const result = await entrypoint({ OCI_ENV: 'dev', OCI_DATASETS_BUCKET: 'bkt', ...profiles });
      expect(result.code).toBe(0);
      expect(result.log).toEqual(DEMO_COMMANDS);
      expect(result.sql).toEqual([`SET app.datasets_bucket = 'bkt';\n${DEMO_SQL}`]);
      expect(result.stdout).toBe(DEMO_OUTPUT);
      expect(result.stderr).toBe('');
    }
  });

  it('on prod, migrates and seeds nothing, whatever is listed', async () => {
    const result = await entrypoint({
      OCI_ENV: 'prod',
      OCI_DATASETS_BUCKET: 'bkt',
      OCI_SEED_PROFILES: 'p1',
    });
    expect(result.code).toBe(0);
    expect(result.log).toEqual(['prisma migrate deploy']);
    expect(result.sql).toEqual([]);
    expect(result.stdout).toBe(
      'migrate: running prisma migrate deploy\nseed: OCI_ENV=prod — skipping demo-data seed\n',
    );
  });

  // The cases below exercise what this change adds.
  describe.skipIf(Boolean(process.env.OCI_ENTRYPOINT_UNDER_TEST))('with a profile', () => {
    it('replays a ready profile after the demo seed: check, bundled files, SQL', async () => {
      const result = await entrypoint({
        OCI_ENV: 'dev',
        OCI_DATASETS_BUCKET: 'bkt',
        OCI_SEED_PROFILES: 'p1',
      });
      expect(result.code).toBe(0);
      expect(result.log).toEqual([
        ...DEMO_COMMANDS,
        'node ./seed-profile-check.mjs p1 dir= profile=',
        'node ./upload-fixtures.mjs dir=./seed/profiles/p1/fixtures profile=1',
        'prisma db execute --file <script>',
      ]);
      expect(result.sql).toEqual([
        `SET app.datasets_bucket = 'bkt';\n${DEMO_SQL}`,
        `SET app.datasets_bucket = 'bkt';\n${PROFILE_SQL}`,
      ]);
      expect(result.stdout).toContain('seed-profile: p1: done');
    });

    it('skips a profile that is not ready and still exits zero', async () => {
      const result = await entrypoint({
        OCI_ENV: 'dev',
        OCI_DATASETS_BUCKET: 'bkt',
        OCI_SEED_PROFILES: 'p1',
        CHECK_EXIT: '3',
      });
      expect(result.code).toBe(0);
      expect(result.log).toEqual([
        ...DEMO_COMMANDS,
        'node ./seed-profile-check.mjs p1 dir= profile=',
      ]);
      expect(result.sql).toHaveLength(1);
      expect(result.stdout).toContain(
        'seed-profile: p1: SKIPPED, reason above. The deploy continues.',
      );
    });

    it('ignores a name that is not a plain profile name', async () => {
      const result = await entrypoint({
        OCI_ENV: 'dev',
        OCI_DATASETS_BUCKET: 'bkt',
        OCI_SEED_PROFILES: '../etc,p1',
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("seed-profile: ignoring '../etc' (not a profile name)");
      expect(result.log.filter((l) => l.includes('seed-profile-check'))).toEqual([
        'node ./seed-profile-check.mjs p1 dir= profile=',
      ]);
    });

    it('launched for a reset, runs the reset script and nothing else', async () => {
      const result = await entrypoint({
        OCI_ENV: 'dev',
        OCI_DATASETS_BUCKET: 'bkt',
        OCI_SEED_PROFILES: 'p1',
        OCI_SEED_RESET: 'p1',
      });
      expect(result.code).toBe(0);
      expect(result.log).toEqual(['node ./reset-profile.mjs dir= profile=']);
      expect(result.sql).toEqual([]);
    });

    it('launched for a reset on prod, refuses before starting anything', async () => {
      const result = await entrypoint({
        OCI_ENV: 'prod',
        OCI_DATASETS_BUCKET: 'bkt',
        OCI_SEED_RESET: 'p1',
      });
      expect(result.code).toBe(2);
      expect(result.stderr).toBe('reset: REFUSED. A profile reset never runs on prod.\n');
      expect(result.log).toEqual([]);
    });
  });
});

// --- uploader and readiness check against an S3 stand-in ------------------------

interface StoredObject {
  length: number;
  sha256?: string;
}

describe('fixture uploader and profile readiness check', TIMEOUT, () => {
  const store = new Map<string, StoredObject>();
  const puts: { key: string; sha256?: string }[] = [];
  let server: Server;
  let env: Record<string, string>;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const key = decodeURIComponent((req.url ?? '').split('?').at(0) ?? '').replace(
        /^\/bkt\//,
        '',
      );
      if (req.method === 'HEAD') {
        const found = store.get(key);
        if (!found) return void res.writeHead(404).end();
        return void res
          .writeHead(200, {
            'content-length': String(found.length),
            ...(found.sha256 ? { 'x-amz-meta-sha256': found.sha256 } : {}),
          })
          .end();
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const sha256 = req.headers['x-amz-meta-sha256'];
        const declared = req.headers['x-amz-decoded-content-length'];
        const stored = {
          length: declared ? Number(declared) : Buffer.concat(chunks).length,
          ...(typeof sha256 === 'string' ? { sha256 } : {}),
        };
        store.set(key, stored);
        puts.push({ key, ...(stored.sha256 ? { sha256: stored.sha256 } : {}) });
        res.writeHead(200, { etag: '"stand-in"' }).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    env = {
      PATH: process.env.PATH ?? '',
      AWS_ACCESS_KEY_ID: 'stand-in',
      AWS_SECRET_ACCESS_KEY: 'stand-in',
      AWS_REGION: 'eu-central-1',
      S3_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      OCI_DATASETS_BUCKET: 'bkt',
    };
  });
  afterAll(() => server.close());

  const upload = (extra: Record<string, string>) =>
    exec(process.execPath, [UPLOADER], { env: { ...env, ...extra } });
  const check = (extra: Record<string, string>) =>
    exec(process.execPath, [path.join(MIGRATE, 'seed-profile-check.mjs'), PROFILE], {
      env: { ...env, SEED_PROFILES_DIR: path.join(SEED_DIR, 'profiles'), ...extra },
    });

  it('uploads the demo fixtures as before: no profile behaviour unless asked', async () => {
    const demo = { SEED_FIXTURES_DIR: path.join(SEED_DIR, 'fixtures') };
    const first = await upload(demo);
    expect(first.code).toBe(0);
    expect(first.stdout.trim().split('\n').at(-1)).toBe(
      'seed-fixtures: done — uploaded=35 skipped=0',
    );
    expect(puts).toHaveLength(35);
    expect(puts.every((p) => p.sha256 === undefined)).toBe(true);
    expect(puts.every((p) => /^(idrid-grading-demo|oci-demo-chest-xr)\//.test(p.key))).toBe(true);

    const again = await upload(demo);
    expect(again.stdout).toBe('seed-fixtures: done — uploaded=0 skipped=35\n');
    expect(again.stderr).toBe(
      'seed-fixtures: demo-clinical-notes-2024 manifest has no distribution[] — skipping\n' +
        'seed-fixtures: rsna-pneumonia-2018 manifest has no distribution[] — skipping\n',
    );
    expect(puts).toHaveLength(35);
    // The demo walk never reaches a profile's files.
    expect([...store.keys()].some((key) => key.startsWith(DATASET))).toBe(false);
  });

  describe.skipIf(Boolean(process.env.OCI_UPLOADER_UNDER_TEST))('profile mode', () => {
    const manifest = JSON.parse(
      readFileSync(
        path.join(SEED_DIR, 'profiles', PROFILE, 'fixtures', DATASET, 'manifest.json'),
        'utf8',
      ),
    ) as { distribution: { '@id': string; name: string; contentSize: string; sha256: string }[] };
    const images = manifest.distribution.filter((d) => d.name.endsWith('.png'));
    const keyOf = (d: { '@id': string; name: string }) => `${DATASET}/${d['@id']}/${d.name}`;

    it('never replays stand-in content on a deployed environment', async () => {
      for (const name of ['dev', 'int']) {
        const result = await check({ OCI_ENV: name });
        expect(result.code).toBe(3);
        expect(result.stdout).toContain('synthetic stand-in content, which is never seeded');
      }
    });

    it('is not ready while the image files are missing from the bucket', async () => {
      const result = await check({ OCI_ENV: 'local' });
      expect(result.code).toBe(3);
      expect(result.stdout).toContain('200 file(s) are not ready in s3://bkt');
      expect(result.stdout).toContain(': not in the bucket');
    });

    it('is ready once every image is there with the size and sha256 of the manifest', async () => {
      for (const d of images) {
        store.set(keyOf(d), { length: Number.parseInt(d.contentSize, 10), sha256: d.sha256 });
      }
      const result = await check({ OCI_ENV: 'local' });
      expect(result.stdout).toBe(
        `seed-profile: ${PROFILE} ready: 4 bundled file(s), 200 already in s3://bkt\n`,
      );
      expect(result.code).toBe(0);

      // A file of the right size and the wrong content is not accepted.
      const [first] = images;
      if (!first) throw new Error('no image in the manifest');
      store.set(keyOf(first), {
        length: Number.parseInt(first.contentSize, 10),
        sha256: 'f'.repeat(64),
      });
      const tampered = await check({ OCI_ENV: 'local' });
      expect(tampered.code).toBe(3);
      expect(tampered.stdout).toContain('sha256 differs from the manifest or was not recorded');
      store.set(keyOf(first), {
        length: Number.parseInt(first.contentSize, 10),
        sha256: first.sha256,
      });
    });

    it('uploads the bundled files with their sha256, once, and says what is hosted elsewhere', async () => {
      const profile = {
        SEED_FIXTURES_DIR: path.join(SEED_DIR, 'profiles', PROFILE, 'fixtures'),
        SEED_FIXTURES_PROFILE: '1',
      };
      puts.length = 0;
      const first = await upload(profile);
      expect(first.code).toBe(0);
      expect(first.stderr).toBe('');
      expect(first.stdout).toContain(
        '200 listed file(s) are not bundled here (uploaded separately)',
      );
      expect(first.stdout).toContain('uploaded=4 skipped=0');
      expect(puts.map((p) => p.key.split('/').at(-1)).sort()).toEqual([
        'metadata.csv',
        'model-a.csv',
        'model-b.csv',
        'model-c.csv',
      ]);
      const bundled = new Map(manifest.distribution.map((d) => [keyOf(d), d.sha256]));
      expect(puts.every((p) => p.sha256 === bundled.get(p.key))).toBe(true);

      const again = await upload(profile);
      expect(again.stdout).toContain('uploaded=0 skipped=4');

      // Same length, other content (a regenerated teaching file): uploaded again.
      const modelA = manifest.distribution.find((d) => d.name === 'model-a.csv');
      if (!modelA) throw new Error('model-a.csv is not in the manifest');
      store.set(keyOf(modelA), {
        length: Number.parseInt(modelA.contentSize, 10),
        sha256: '0'.repeat(64),
      });
      const refreshed = await upload(profile);
      expect(refreshed.stdout).toContain('uploaded=1 skipped=3');
      expect(store.get(keyOf(modelA))?.sha256).toBe(modelA.sha256);
    });

    it('refuses a bundled file that is not the one the manifest describes', async () => {
      const copy = tmp('oci-profile-fixtures-');
      cpSync(path.join(SEED_DIR, 'profiles', PROFILE, 'fixtures'), copy, { recursive: true });
      writeFileSync(path.join(copy, DATASET, 'metadata.csv'), 'image_id,sex,age_band\n');
      const result = await upload({ SEED_FIXTURES_DIR: copy, SEED_FIXTURES_PROFILE: '1' });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('metadata.csv is not the file its manifest describes');
    });
  });
});

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_REFUSED,
  run,
  withoutKeys,
  type PurgeCliDependencies,
} from './purge-cli.js';
import { FakeObjectVersionStore } from './purge-fake-object-store.js';
import { StorageAccessError } from './purge-object-store.js';
import type { PurgeRecord } from './purge-record.js';

const BUCKET = 'oci-test-datasets-000000000000';
const PREFIX = 'sample-ct-a1b2/';
// An invented name that would be an identifier if it were real. It is
// part of every key below, so it must never reach the output or the record.
const NAME_IN_KEY = 'ZZTOP-INVENTED-SURNAME';

let scratch: string;
let repository: string;
let desk: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'oci-purge-')));
  repository = path.join(scratch, 'checkout');
  desk = path.join(scratch, 'desk');
  mkdirSync(repository);
  mkdirSync(desk);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function seeded(): FakeObjectVersionStore {
  const store = new FakeObjectVersionStore();
  store.put(`${PREFIX}u1/${NAME_IN_KEY}-001.dcm`, 1000);
  store.put(`${PREFIX}u2/${NAME_IN_KEY}-002.dcm`, 2000);
  store.put(`${PREFIX}u2/${NAME_IN_KEY}-002.dcm`, 2048);
  store.deleteWithoutVersion(`${PREFIX}u1/${NAME_IN_KEY}-001.dcm`);
  store.startUpload(`${PREFIX}u3/${NAME_IN_KEY}-003.dcm`);
  store.put('other-dataset/u1/file.bin', 5);
  return store;
}

function command(store = seeded(), env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const opened: Array<{ bucket: string; region: string; endpoint: string | undefined }> = [];
  let tick = 0;
  const deps: PurgeCliDependencies = {
    env,
    workingDirectory: desk,
    repositoryRoot: repository,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    openStore: (bucket, region, endpoint) => {
      opened.push({ bucket, region, endpoint });
      return store;
    },
    now: () => new Date(Date.UTC(2026, 11, 21, 9, 0, tick++)),
  };
  return {
    store,
    opened,
    out,
    err,
    text: () => [...out, ...err].join('\n'),
    run: (...argv: string[]) => run(argv, deps),
  };
}

function readRecord(file: string): PurgeRecord {
  return JSON.parse(readFileSync(file, 'utf8')) as PurgeRecord;
}

describe('purge-dataset-objects: dry run (the default)', () => {
  it('counts what is under the prefix and deletes nothing', async () => {
    const c = command();

    const code = await c.run('--bucket', BUCKET, '--prefix', PREFIX);

    expect(code).toBe(EXIT_OK);
    expect(c.store.writes).toEqual([]);
    expect(c.store.allVersions.length).toBe(5);
    expect(c.text()).toContain('Dry run: nothing is deleted.');
    expect(c.text()).toContain('keys                2');
    expect(c.text()).toContain('object versions     3  (1 current, 2 noncurrent)');
    expect(c.text()).toContain('5048 bytes');
    expect(c.text()).toContain('delete markers      1');
    expect(c.text()).toContain('unfinished uploads  1');
    expect(c.text()).toContain(`--execute --confirm-prefix ${PREFIX}`);
    expect(c.opened).toEqual([{ bucket: BUCKET, region: 'eu-central-1', endpoint: undefined }]);
  });

  it('takes the bucket and the region from the environment', async () => {
    const c = command(seeded(), { OCI_DATASETS_BUCKET: BUCKET, AWS_REGION: 'eu-west-1' });

    expect(await c.run('--prefix', PREFIX)).toBe(EXIT_OK);
    expect(c.opened).toEqual([{ bucket: BUCKET, region: 'eu-west-1', endpoint: undefined }]);
  });

  it('writes a record when asked, marked as a dry run', async () => {
    const c = command();
    const file = path.join(desk, 'dry-run.json');

    expect(await c.run('--bucket', BUCKET, '--prefix', PREFIX, '--record-out', file)).toBe(EXIT_OK);

    const record = readRecord(file);
    expect(record.mode).toBe('dry-run');
    expect(record.outcome).toBe('dry-run');
    expect(record.deleted).toBeNull();
    expect(record.found.versions).toBe(3);
  });

  it('says so when nothing is stored under the prefix', async () => {
    const c = command(new FakeObjectVersionStore());

    expect(await c.run('--bucket', BUCKET, '--prefix', PREFIX)).toBe(EXIT_OK);
    expect(c.text()).toContain('Nothing is stored under this prefix.');
  });
});

describe('purge-dataset-objects: --execute', () => {
  it('deletes everything under the prefix, proves it, and writes the record', async () => {
    const c = command();
    const file = path.join(desk, 'deletion-record.json');

    const code = await c.run(
      '--bucket',
      BUCKET,
      '--prefix',
      PREFIX,
      '--execute',
      '--confirm-prefix',
      PREFIX,
      '--record-out',
      file,
    );

    expect(code).toBe(EXIT_OK);
    expect(c.store.allVersions.map((v) => v.key)).toEqual(['other-dataset/u1/file.bin']);
    expect(c.store.allUploads).toEqual([]);
    expect(c.text()).toContain('Done: nothing is left under the prefix.');

    const record = readRecord(file);
    expect(record).toMatchObject({
      tool: 'purge-dataset-objects',
      mode: 'execute',
      outcome: 'complete',
      bucket: BUCKET,
      prefix: PREFIX,
      endpoint: null,
      versioning: 'enabled',
      found: { keys: 2, versions: 3, deleteMarkers: 1, bytes: 5048, incompleteUploads: 1 },
      deleted: { versions: 3, deleteMarkers: 1, bytes: 5048, incompleteUploadsAborted: 1 },
      failures: {},
      remaining: { keys: 0, versions: 0, deleteMarkers: 0, bytes: 0, incompleteUploads: 0 },
    });
    expect(Date.parse(record.finishedAt)).toBeGreaterThan(Date.parse(record.startedAt));
    // Owner-only: the record names a bucket and a restricted dataset.
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('never prints or records a key: a file name is part of it', async () => {
    const c = command();
    const file = path.join(desk, 'deletion-record.json');

    await c.run('--bucket', BUCKET, '--prefix', PREFIX);
    await c.run(
      '--bucket',
      BUCKET,
      '--prefix',
      PREFIX,
      '--execute',
      '--confirm-prefix',
      PREFIX,
      '--record-out',
      file,
    );

    expect(c.text()).not.toContain(NAME_IN_KEY);
    expect(c.text()).not.toContain('.dcm');
    expect(readFileSync(file, 'utf8')).not.toContain(NAME_IN_KEY);
    expect(readFileSync(file, 'utf8')).not.toContain('.dcm');
  });

  it('fails, and says what is left, when a version cannot be removed', async () => {
    const store = seeded();
    store.refuseDeletionOf(`${PREFIX}u2/${NAME_IN_KEY}-002.dcm`, 'AccessDenied');
    const c = command(store);
    const file = path.join(desk, 'deletion-record.json');

    const code = await c.run(
      '--bucket',
      BUCKET,
      '--prefix',
      PREFIX,
      '--execute',
      '--confirm-prefix',
      PREFIX,
      '--record-out',
      file,
    );

    expect(code).toBe(EXIT_FAILED);
    expect(c.err.join('\n')).toContain('could not remove 2 entries: AccessDenied');
    expect(c.err.join('\n')).toContain('NOT complete');
    expect(c.text()).not.toContain(NAME_IN_KEY);
    const record = readRecord(file);
    expect(record.outcome).toBe('incomplete');
    expect(record.failures).toEqual({ AccessDenied: 2 });
    expect(record.remaining).toMatchObject({ versions: 2 });
  });

  it('a second run finds nothing to delete and still succeeds', async () => {
    const c = command();
    const args = ['--bucket', BUCKET, '--prefix', PREFIX, '--execute', '--confirm-prefix', PREFIX];
    await c.run(...args, '--record-out', path.join(desk, 'first.json'));
    const writes = c.store.writes.length;

    const code = await c.run(...args, '--record-out', path.join(desk, 'second.json'));

    expect(code).toBe(EXIT_OK);
    expect(c.store.writes.length).toBe(writes);
    expect(c.text()).toContain('nothing to delete');
    expect(readRecord(path.join(desk, 'second.json')).outcome).toBe('complete');
  });

  it('reports a refused storage call without the storage message', async () => {
    const store = seeded();
    store.failListingsWith(
      new StorageAccessError('the storage refused the request (AccessDenied)'),
    );
    const c = command(store);

    const code = await c.run(
      '--bucket',
      BUCKET,
      '--prefix',
      PREFIX,
      '--execute',
      '--confirm-prefix',
      PREFIX,
      '--record-out',
      path.join(desk, 'r.json'),
    );

    expect(code).toBe(EXIT_FAILED);
    expect(c.err.join('\n')).toContain('the storage refused the request (AccessDenied)');
    expect(c.store.writes).toEqual([]);
    expect(existsSync(path.join(desk, 'r.json'))).toBe(false);
  });

  it('cuts a key out of an unexpected error message', async () => {
    const store = seeded();
    store.failListingsWith(
      new Error(`could not read "${PREFIX}u1/${NAME_IN_KEY}-001.dcm": connection reset`),
    );
    const c = command(store);

    expect(await c.run('--bucket', BUCKET, '--prefix', PREFIX)).toBe(EXIT_FAILED);
    expect(c.text()).toContain('could not read "<key>": connection reset');
    expect(c.text()).not.toContain(NAME_IN_KEY);
  });
});

describe('purge-dataset-objects: refusals (exit 2, no call to the storage)', () => {
  const refused = async (...argv: string[]) => {
    const c = command();
    const code = await c.run(...argv);
    expect(code).toBe(EXIT_REFUSED);
    expect(c.opened).toEqual([]);
    expect(c.store.calls).toEqual([]);
    return c.err.join('\n');
  };

  it('no prefix', async () => {
    expect(await refused('--bucket', BUCKET)).toContain('--prefix <slug>/');
  });

  it.each([
    ['', 'empty'],
    ['/', 'empty'],
    ['sample-ct-a1b2', 'must end with "/"'],
    ['ab/', 'not a dataset slug'],
    ['sample-ct-a1b2/../', 'not a key segment'],
  ])('prefix %j', async (prefix, reason) => {
    expect(await refused('--bucket', BUCKET, '--prefix', prefix)).toContain(reason);
  });

  it('no bucket', async () => {
    expect(await refused('--prefix', PREFIX)).toContain('no bucket');
  });

  it('a bucket name that is not one', async () => {
    expect(await refused('--bucket', 's3://x/', '--prefix', PREFIX)).toContain('not a bucket name');
  });

  it('--execute without the confirmation', async () => {
    expect(await refused('--bucket', BUCKET, '--prefix', PREFIX, '--execute')).toContain(
      `--confirm-prefix ${PREFIX}`,
    );
  });

  it('--execute with a confirmation that names something else', async () => {
    const message = await refused(
      '--bucket',
      BUCKET,
      '--prefix',
      PREFIX,
      '--execute',
      '--confirm-prefix',
      'other-dataset/',
      '--record-out',
      path.join(desk, 'r.json'),
    );
    expect(message).toContain('is not the prefix');
    expect(message).toContain('nothing was deleted');
  });

  it('--execute without a record file', async () => {
    expect(
      await refused(
        '--bucket',
        BUCKET,
        '--prefix',
        PREFIX,
        '--execute',
        '--confirm-prefix',
        PREFIX,
      ),
    ).toContain('--record-out');
  });

  it('--confirm-prefix without --execute', async () => {
    expect(
      await refused('--bucket', BUCKET, '--prefix', PREFIX, '--confirm-prefix', PREFIX),
    ).toContain('only read with --execute');
  });

  it('an option it does not know, or a stray argument', async () => {
    expect(await refused('--bucket', BUCKET, '--prefix', PREFIX, '--force')).toContain('--force');
    expect(await refused('--bucket', BUCKET, '--prefix', PREFIX, 'extra')).toContain('extra');
  });

  it('a record inside the repository', async () => {
    expect(
      await refused(
        '--bucket',
        BUCKET,
        '--prefix',
        PREFIX,
        '--record-out',
        path.join(repository, 'record.json'),
      ),
    ).toContain('inside the repository');
  });

  it('a record inside another git working tree', async () => {
    const other = path.join(scratch, 'other-checkout');
    mkdirSync(path.join(other, '.git'), { recursive: true });
    mkdirSync(path.join(other, 'notes'));
    expect(
      await refused(
        '--bucket',
        BUCKET,
        '--prefix',
        PREFIX,
        '--record-out',
        path.join(other, 'notes', 'record.json'),
      ),
    ).toContain('inside a git working tree');
  });

  it('a record that would overwrite a file, or whose folder is missing', async () => {
    const existing = path.join(desk, 'record.json');
    writeFileSync(existing, '{}');
    expect(
      await refused('--bucket', BUCKET, '--prefix', PREFIX, '--record-out', existing),
    ).toContain('never overwritten');
    expect(
      await refused(
        '--bucket',
        BUCKET,
        '--prefix',
        PREFIX,
        '--record-out',
        path.join(desk, 'missing', 'record.json'),
      ),
    ).toContain('does not exist');
  });
});

describe('purge-dataset-objects: Object Lock', () => {
  it('refuses to delete from a locked bucket, and deletes nothing', async () => {
    const store = seeded();
    store.objectLock = true;
    const c = command(store);
    const file = path.join(desk, 'r.json');

    const code = await c.run(
      '--bucket',
      BUCKET,
      '--prefix',
      PREFIX,
      '--execute',
      '--confirm-prefix',
      PREFIX,
      '--record-out',
      file,
    );

    expect(code).toBe(EXIT_REFUSED);
    expect(c.err.join('\n')).toContain('Object Lock is on');
    expect(c.err.join('\n')).toContain('never bypasses a retention rule');
    expect(c.store.writes).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it('still counts on a dry run, and says an executed run would be refused', async () => {
    const store = seeded();
    store.objectLock = true;
    const c = command(store);

    expect(await c.run('--bucket', BUCKET, '--prefix', PREFIX)).toBe(EXIT_OK);
    expect(c.text()).toContain('Object Lock: on');
    expect(c.text()).toContain('would be refused');
    expect(c.store.writes).toEqual([]);
  });
});

describe('purge-dataset-objects: the rest', () => {
  it('--help prints the usage and touches nothing', async () => {
    const c = command();

    expect(await c.run('--help')).toBe(EXIT_OK);
    expect(c.out.join('\n')).toContain('--confirm-prefix');
    expect(c.opened).toEqual([]);
  });

  it('names a local endpoint when one is set, in the output and in the record', async () => {
    const c = command(seeded(), { S3_ENDPOINT: 'http://127.0.0.1:19000' });
    const file = path.join(desk, 'r.json');

    await c.run('--bucket', BUCKET, '--prefix', PREFIX, '--record-out', file);

    expect(c.opened[0]?.endpoint).toBe('http://127.0.0.1:19000');
    expect(c.text()).toContain('Storage endpoint: http://127.0.0.1:19000 (not AWS)');
    expect(readRecord(file).endpoint).toBe('http://127.0.0.1:19000');
  });
});

describe('withoutKeys', () => {
  it('replaces every key under the prefix and leaves the rest', () => {
    expect(
      withoutKeys(`a ${PREFIX}u1/x.dcm and (${PREFIX}u2/y.dcm), but other-dataset/z`, PREFIX),
    ).toBe('a <key> and (<key>), but other-dataset/z');
    expect(withoutKeys('no key here', PREFIX)).toBe('no key here');
  });
});

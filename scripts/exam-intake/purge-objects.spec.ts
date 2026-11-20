import { describe, expect, it } from 'vitest';
import { FakeObjectVersionStore } from './purge-fake-object-store.js';
import { DELETE_BATCH_SIZE, StorageAccessError } from './purge-object-store.js';
import {
  checkPrefix,
  isEmpty,
  PrefixRefusedError,
  purgePrefix,
  takeInventory,
} from './purge-objects.js';

const PREFIX = 'sample-ct-a1b2/';
const NEIGHBOUR = 'sample-ct-a1b2-second/';

/** A dataset as uploads, re-uploads and a console delete leave it. */
function seeded(): FakeObjectVersionStore {
  const store = new FakeObjectVersionStore();
  store.put(`${PREFIX}u1/slice-001.dcm`, 100);
  store.put(`${PREFIX}u2/slice-002.dcm`, 200);
  // Uploaded twice: one current version, one noncurrent.
  store.put(`${PREFIX}u3/slice-003.dcm`, 300);
  store.put(`${PREFIX}u3/slice-003.dcm`, 301);
  // "Deleted" in the console: hidden behind a delete marker, bytes kept.
  store.put(`${PREFIX}u4/slice-004.dcm`, 400);
  store.deleteWithoutVersion(`${PREFIX}u4/slice-004.dcm`);
  // An upload that was started and never finished.
  store.startUpload(`${PREFIX}u5/slice-005.dcm`);
  // Another dataset whose slug starts the same way, and an unrelated one.
  store.put(`${NEIGHBOUR}u1/slice-001.dcm`, 999);
  store.startUpload(`${NEIGHBOUR}u2/slice-002.dcm`);
  store.put('other-dataset/u1/file.bin', 5);
  return store;
}

describe('checkPrefix', () => {
  it('accepts a dataset slug followed by a slash, and a prefix below it', () => {
    expect(checkPrefix('sample-ct-a1b2/')).toBe('sample-ct-a1b2/');
    expect(checkPrefix('  sample-ct-a1b2/  ')).toBe('sample-ct-a1b2/');
    expect(checkPrefix('sample-ct-a1b2/0b1e5c5e-0000-4000-8000-000000000001/')).toBe(
      'sample-ct-a1b2/0b1e5c5e-0000-4000-8000-000000000001/',
    );
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['/', 'empty'],
    ['//', 'empty'],
    ['/sample-ct-a1b2/', 'must not start'],
    // No trailing slash: would also match sample-ct-a1b2-second/.
    ['sample-ct-a1b2', 'must end with'],
    ['ab/', 'not a dataset slug'],
    ['Sample-CT/', 'not a dataset slug'],
    ['sample--ct/', 'not a dataset slug'],
    ['*/', 'not a dataset slug'],
    ['sample-ct-a1b2/../', 'not a key segment'],
    ['sample-ct-a1b2//', 'not a key segment'],
    ['sample-ct-a1b2/a b/', 'not a key segment'],
  ])('refuses %j', (raw, reason) => {
    expect(() => checkPrefix(raw)).toThrow(PrefixRefusedError);
    expect(() => checkPrefix(raw)).toThrow(reason);
  });
});

describe('takeInventory', () => {
  it('counts versions, noncurrent versions, delete markers, bytes and unfinished uploads', async () => {
    const store = seeded();

    expect(await takeInventory(store, PREFIX)).toEqual({
      keys: 4,
      versions: 5,
      currentVersions: 3,
      deleteMarkers: 1,
      bytes: 100 + 200 + 300 + 301 + 400,
      incompleteUploads: 1,
    });
    expect(store.writes).toEqual([]);
  });

  it('counts the same across pages', async () => {
    const store = seeded();
    store.pageSize = 2;

    const inventory = await takeInventory(store, PREFIX);

    expect(inventory.keys).toBe(4);
    expect(inventory.versions).toBe(5);
    expect(store.calls.filter((c) => c.op === 'listVersions').length).toBeGreaterThan(1);
  });
});

describe('purgePrefix', () => {
  it('a dry run reports what is there and deletes nothing', async () => {
    const store = seeded();
    const before = store.allVersions.length;

    const report = await purgePrefix({ store, prefix: PREFIX, execute: false });

    expect(report.found.versions).toBe(5);
    expect(report.deleted).toBeNull();
    expect(report.remaining).toBeNull();
    expect(store.writes).toEqual([]);
    expect(store.allVersions.length).toBe(before);
    expect(store.allUploads.length).toBe(2);
  });

  it('removes every version, delete marker and unfinished upload, and nothing else', async () => {
    const store = seeded();

    const report = await purgePrefix({ store, prefix: PREFIX, execute: true });

    expect(report.deleted).toEqual({
      versions: 5,
      deleteMarkers: 1,
      bytes: 1301,
      incompleteUploadsAborted: 1,
    });
    expect(report.failures).toEqual({});
    expect(report.remaining && isEmpty(report.remaining)).toBe(true);
    // The other datasets are intact: the one with a look-alike slug too.
    expect(store.allVersions.map((v) => v.key).sort()).toEqual([
      'other-dataset/u1/file.bin',
      `${NEIGHBOUR}u1/slice-001.dcm`,
    ]);
    expect(store.allUploads.map((u) => u.key)).toEqual([`${NEIGHBOUR}u2/slice-002.dcm`]);
  });

  it('removes the bytes a console delete left behind', async () => {
    const store = new FakeObjectVersionStore();
    store.put(`${PREFIX}u1/slice-001.dcm`, 100);
    store.deleteWithoutVersion(`${PREFIX}u1/slice-001.dcm`);
    // Nothing current: a plain listing of the bucket would show it empty.
    expect((await takeInventory(store, PREFIX)).currentVersions).toBe(0);

    const report = await purgePrefix({ store, prefix: PREFIX, execute: true });

    expect(report.deleted?.versions).toBe(1);
    expect(report.deleted?.deleteMarkers).toBe(1);
    expect(store.allVersions).toEqual([]);
  });

  it('deletes more than one listing page, in batches the storage accepts', async () => {
    const store = new FakeObjectVersionStore();
    const total = 2 * DELETE_BATCH_SIZE + 500;
    for (let i = 0; i < total; i += 1) {
      store.put(`${PREFIX}u/slice-${String(i).padStart(5, '0')}.dcm`, 10);
    }
    store.put('other-dataset/u1/file.bin', 5);

    const report = await purgePrefix({ store, prefix: PREFIX, execute: true });

    expect(report.found.versions).toBe(total);
    expect(report.deleted?.versions).toBe(total);
    expect(report.deleted?.bytes).toBe(total * 10);
    expect(report.remaining && isEmpty(report.remaining)).toBe(true);
    const batches = store.calls.flatMap((c) => (c.op === 'deleteVersions' ? [c.count] : []));
    expect(batches).toEqual([DELETE_BATCH_SIZE, DELETE_BATCH_SIZE, 500]);
    expect(store.allVersions.map((v) => v.key)).toEqual(['other-dataset/u1/file.bin']);
  });

  it('reports what could not be removed, by error code, and shows it is still there', async () => {
    const store = seeded();
    store.refuseDeletionOf(`${PREFIX}u3/slice-003.dcm`, 'AccessDenied');

    const report = await purgePrefix({ store, prefix: PREFIX, execute: true });

    // Both versions of that key failed; everything else went.
    expect(report.failures).toEqual({ AccessDenied: 2 });
    expect(report.deleted?.versions).toBe(3);
    expect(report.remaining).toMatchObject({ keys: 1, versions: 2, deleteMarkers: 0 });
    expect(report.remaining && isEmpty(report.remaining)).toBe(false);
  });

  it('a second run finds nothing and changes nothing', async () => {
    const store = seeded();
    await purgePrefix({ store, prefix: PREFIX, execute: true });
    const writesAfterFirst = store.writes.length;

    const again = await purgePrefix({ store, prefix: PREFIX, execute: true });

    expect(isEmpty(again.found)).toBe(true);
    expect(again.deleted).toEqual({
      versions: 0,
      deleteMarkers: 0,
      bytes: 0,
      incompleteUploadsAborted: 0,
    });
    expect(again.remaining && isEmpty(again.remaining)).toBe(true);
    expect(store.writes.length).toBe(writesAfterFirst);
  });

  it('stops without deleting when the storage cannot be listed', async () => {
    const store = seeded();
    store.failListingsWith(new StorageAccessError('the storage refused the request'));

    await expect(purgePrefix({ store, prefix: PREFIX, execute: true })).rejects.toThrow(
      StorageAccessError,
    );
    expect(store.writes).toEqual([]);
  });

  it('never acts on a key outside the prefix, even if a listing returns one', async () => {
    const store = seeded();
    const listVersions = store.listVersions.bind(store);
    // A storage that ignores the prefix it was given.
    store.listVersions = (_prefix, after) => listVersions('', after);

    await purgePrefix({ store, prefix: PREFIX, execute: true });

    expect(store.allVersions.map((v) => v.key).sort()).toEqual([
      'other-dataset/u1/file.bin',
      `${NEIGHBOUR}u1/slice-001.dcm`,
    ]);
  });
});

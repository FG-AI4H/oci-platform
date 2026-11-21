import { DatasetSlugSchema } from '@oci/shared-types';
import {
  DELETE_BATCH_SIZE,
  type IncompleteUpload,
  type ObjectVersionStore,
  type StoredVersion,
} from './purge-object-store.js';

/**
 * Remove every trace of one dataset's files from a versioned bucket:
 * each object version, each delete marker and each unfinished multipart
 * upload under the dataset's key prefix.
 *
 * On a versioned bucket an ordinary delete only adds a delete marker and
 * the bytes stay. Deleting for good means naming every version, which is
 * what this does, and then listing again to prove nothing is left.
 *
 * Keys are never reported: an uploaded file's name is part of its key,
 * and a name can carry an identifier. Counts and sizes only.
 */

export class PrefixRefusedError extends Error {
  override readonly name = 'PrefixRefusedError';
}

/**
 * The prefix of one dataset, `<slug>/`, or of something below it. Vetted
 * so that a slip of the hand can never name the whole bucket or a group
 * of datasets whose slugs merely start alike.
 *
 * @throws PrefixRefusedError
 */
export function checkPrefix(raw: string): string {
  const prefix = raw.trim();
  if (prefix === '' || /^\/+$/.test(prefix)) {
    throw new PrefixRefusedError('the prefix is empty: that would name the whole bucket');
  }
  if (prefix.startsWith('/')) {
    throw new PrefixRefusedError('the prefix must not start with "/": keys do not');
  }
  if (!prefix.endsWith('/')) {
    throw new PrefixRefusedError(
      `the prefix must end with "/": without it "${prefix}" also names every dataset whose slug starts the same way`,
    );
  }
  const segments = prefix.slice(0, -1).split('/');
  const slug = segments[0] ?? '';
  if (!DatasetSlugSchema.safeParse(slug).success) {
    throw new PrefixRefusedError(
      `"${slug}" is not a dataset slug (lower-case letters, digits and single hyphens, 3 to 80 characters)`,
    );
  }
  for (const segment of segments.slice(1)) {
    if (!/^[A-Za-z0-9._-]+$/.test(segment) || segment === '.' || segment === '..') {
      throw new PrefixRefusedError(`"${segment}" is not a key segment this platform writes`);
    }
  }
  return prefix;
}

export interface Inventory {
  /** Distinct keys that have at least one version or delete marker. */
  keys: number;
  /** Object versions that hold bytes, current or not. */
  versions: number;
  /** Of `versions`, those a plain read of the key would return. */
  currentVersions: number;
  deleteMarkers: number;
  /** Bytes held by `versions`. */
  bytes: number;
  /** Multipart uploads started and never finished; their parts are not sized. */
  incompleteUploads: number;
}

export interface PurgeReport {
  found: Inventory;
  /** Null on a dry run: nothing was attempted. */
  deleted: {
    versions: number;
    deleteMarkers: number;
    bytes: number;
    incompleteUploadsAborted: number;
  } | null;
  /** Storage error code → how many entries it was returned for. */
  failures: Record<string, number>;
  /** What a fresh listing shows after the deletion; null on a dry run. */
  remaining: Inventory | null;
}

function emptyInventory(): Inventory {
  return {
    keys: 0,
    versions: 0,
    currentVersions: 0,
    deleteMarkers: 0,
    bytes: 0,
    incompleteUploads: 0,
  };
}

/** True when nothing at all is left under the prefix. */
export function isEmpty(inventory: Inventory): boolean {
  return (
    inventory.versions === 0 && inventory.deleteMarkers === 0 && inventory.incompleteUploads === 0
  );
}

async function eachVersionPage(
  store: ObjectVersionStore,
  prefix: string,
  visit: (page: StoredVersion[]) => Promise<void>,
): Promise<void> {
  let after: string | null = null;
  do {
    const page = await store.listVersions(prefix, after);
    // Defence in depth: act only on keys that really are under the
    // prefix, whatever the storage returned.
    await visit(page.items.filter((item) => item.key.startsWith(prefix)));
    after = page.next;
  } while (after !== null);
}

async function allIncompleteUploads(
  store: ObjectVersionStore,
  prefix: string,
): Promise<IncompleteUpload[]> {
  const uploads: IncompleteUpload[] = [];
  let after: string | null = null;
  do {
    const page = await store.listIncompleteUploads(prefix, after);
    uploads.push(...page.items.filter((item) => item.key.startsWith(prefix)));
    after = page.next;
  } while (after !== null);
  return uploads;
}

/** Count what is under the prefix. Reads only. */
export async function takeInventory(store: ObjectVersionStore, prefix: string): Promise<Inventory> {
  const inventory = emptyInventory();
  // Listings come in key order, so distinct keys can be counted without
  // keeping them all.
  let lastKey: string | null = null;
  await eachVersionPage(store, prefix, async (page) => {
    for (const item of page) {
      if (item.key !== lastKey) {
        inventory.keys += 1;
        lastKey = item.key;
      }
      if (item.deleteMarker) {
        inventory.deleteMarkers += 1;
      } else {
        inventory.versions += 1;
        inventory.bytes += item.size;
        if (item.latest) inventory.currentVersions += 1;
      }
    }
  });
  inventory.incompleteUploads = (await allIncompleteUploads(store, prefix)).length;
  return inventory;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Count, and when `execute` is true delete and count again.
 *
 * @param prefix already vetted by `checkPrefix`
 */
export async function purgePrefix(args: {
  store: ObjectVersionStore;
  prefix: string;
  execute: boolean;
  /** Called between the phases, with counts only. */
  progress?: (line: string) => void;
}): Promise<PurgeReport> {
  const { store, prefix, execute } = args;
  const say = args.progress ?? (() => undefined);

  const found = await takeInventory(store, prefix);
  if (!execute) return { found, deleted: null, failures: {}, remaining: null };

  const deleted = { versions: 0, deleteMarkers: 0, bytes: 0, incompleteUploadsAborted: 0 };
  const failures = new Map<string, number>();
  const fail = (code: string) => failures.set(code, (failures.get(code) ?? 0) + 1);

  // Unfinished uploads first: once aborted, no late part can complete
  // into a new object while the versions are being removed.
  for (const upload of await allIncompleteUploads(store, prefix)) {
    try {
      await store.abortUpload(upload);
      deleted.incompleteUploadsAborted += 1;
    } catch (err) {
      fail(err instanceof Error && err.name ? err.name : 'AbortFailed');
    }
  }
  say(`  aborted ${deleted.incompleteUploadsAborted} unfinished upload(s)`);

  // The listing is finished before anything is removed: a listing
  // position names a version, and continuing from one that has just
  // been deleted is not something to depend on. One dataset's versions
  // fit in memory (a few hundred bytes each).
  const targets: StoredVersion[] = [];
  await eachVersionPage(store, prefix, async (page) => {
    targets.push(...page);
  });

  for (const batch of chunks(targets, DELETE_BATCH_SIZE)) {
    const failed = await store.deleteVersions(
      batch.map((item) => ({ key: item.key, versionId: item.versionId })),
    );
    const failedIds = new Set(failed.map((f) => `${f.key}\u0000${f.versionId}`));
    for (const f of failed) fail(f.code);
    for (const item of batch) {
      if (failedIds.has(`${item.key}\u0000${item.versionId}`)) continue;
      if (item.deleteMarker) {
        deleted.deleteMarkers += 1;
      } else {
        deleted.versions += 1;
        deleted.bytes += item.size;
      }
    }
    say(`  removed ${deleted.versions} version(s) and ${deleted.deleteMarkers} delete marker(s)`);
  }

  // The proof is a fresh listing, not the absence of errors.
  const remaining = await takeInventory(store, prefix);
  return { found, deleted, failures: Object.fromEntries(failures), remaining };
}

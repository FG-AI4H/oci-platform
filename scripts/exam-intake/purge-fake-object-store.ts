import {
  DELETE_BATCH_SIZE,
  type DeleteFailure,
  type IncompleteUpload,
  type ObjectVersionStore,
  type Page,
  type StoredVersion,
  type VersionRef,
} from './purge-object-store.js';

export type StoreCall =
  | { op: 'versioning' }
  | { op: 'objectLockEnabled' }
  | { op: 'listVersions'; prefix: string }
  | { op: 'listIncompleteUploads'; prefix: string }
  | { op: 'deleteVersions'; count: number }
  | { op: 'abortUpload' };

const WRITES: ReadonlySet<StoreCall['op']> = new Set(['deleteVersions', 'abortUpload']);

/**
 * In-memory versioned bucket for the tests. It behaves like the real
 * thing where the purge depends on it: an ordinary delete adds a delete
 * marker and keeps the bytes, listings are paged and in key order, and a
 * delete request takes a bounded number of entries. It keeps every call,
 * so a test can assert that nothing was written.
 */
export class FakeObjectVersionStore implements ObjectVersionStore {
  readonly calls: StoreCall[] = [];
  versioningState: 'enabled' | 'suspended' | 'off' = 'enabled';
  objectLock = false;
  /** Small pages make paging visible without thousands of entries. */
  pageSize = DELETE_BATCH_SIZE;

  private versions: StoredVersion[] = [];
  private uploads: IncompleteUpload[] = [];
  private readonly undeletable = new Map<string, string>();
  private listFailure: Error | null = null;
  private sequence = 0;

  /** Store one more version of `key`, as an upload does. */
  put(key: string, size: number): StoredVersion {
    for (const v of this.versions) if (v.key === key) v.latest = false;
    this.sequence += 1;
    const version: StoredVersion = {
      key,
      versionId: `v${String(this.sequence).padStart(8, '0')}`,
      deleteMarker: false,
      latest: true,
      size,
    };
    this.versions.push(version);
    return version;
  }

  /** What a console "delete" does on a versioned bucket: hide, keep the bytes. */
  deleteWithoutVersion(key: string): void {
    for (const v of this.versions) if (v.key === key) v.latest = false;
    this.sequence += 1;
    this.versions.push({
      key,
      versionId: `v${String(this.sequence).padStart(8, '0')}`,
      deleteMarker: true,
      latest: true,
      size: 0,
    });
  }

  startUpload(key: string): IncompleteUpload {
    this.sequence += 1;
    const upload = { key, uploadId: `u${this.sequence}` };
    this.uploads.push(upload);
    return upload;
  }

  /** Every later attempt to remove a version of `key` fails with `code`. */
  refuseDeletionOf(key: string, code: string): void {
    this.undeletable.set(key, code);
  }

  failListingsWith(err: Error): void {
    this.listFailure = err;
  }

  /** Everything still stored, under any prefix. */
  get allVersions(): readonly StoredVersion[] {
    return this.versions;
  }

  get allUploads(): readonly IncompleteUpload[] {
    return this.uploads;
  }

  get writes(): StoreCall[] {
    return this.calls.filter((call) => WRITES.has(call.op));
  }

  async versioning(): Promise<'enabled' | 'suspended' | 'off'> {
    this.calls.push({ op: 'versioning' });
    return this.versioningState;
  }

  async objectLockEnabled(): Promise<boolean> {
    this.calls.push({ op: 'objectLockEnabled' });
    return this.objectLock;
  }

  async listVersions(prefix: string, after: string | null): Promise<Page<StoredVersion>> {
    this.calls.push({ op: 'listVersions', prefix });
    if (this.listFailure) throw this.listFailure;
    const matching = this.versions
      .filter((v) => v.key.startsWith(prefix))
      .sort((a, b) =>
        a.key === b.key ? a.versionId.localeCompare(b.versionId) : a.key < b.key ? -1 : 1,
      );
    return page(matching, after, this.pageSize);
  }

  async listIncompleteUploads(
    prefix: string,
    after: string | null,
  ): Promise<Page<IncompleteUpload>> {
    this.calls.push({ op: 'listIncompleteUploads', prefix });
    if (this.listFailure) throw this.listFailure;
    const matching = this.uploads
      .filter((u) => u.key.startsWith(prefix))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return page(matching, after, this.pageSize);
  }

  async deleteVersions(entries: readonly VersionRef[]): Promise<DeleteFailure[]> {
    this.calls.push({ op: 'deleteVersions', count: entries.length });
    if (entries.length > DELETE_BATCH_SIZE) {
      throw new Error(`MalformedXML: more than ${DELETE_BATCH_SIZE} entries in one delete request`);
    }
    const failures: DeleteFailure[] = [];
    for (const entry of entries) {
      const code = this.undeletable.get(entry.key);
      if (code !== undefined) {
        failures.push({ ...entry, code });
        continue;
      }
      // Removing a version that is already gone succeeds, as on S3.
      this.versions = this.versions.filter(
        (v) => !(v.key === entry.key && v.versionId === entry.versionId),
      );
    }
    return failures;
  }

  async abortUpload(upload: IncompleteUpload): Promise<void> {
    this.calls.push({ op: 'abortUpload' });
    this.uploads = this.uploads.filter((u) => u.uploadId !== upload.uploadId);
  }
}

function page<T>(items: T[], after: string | null, size: number): Page<T> {
  const start = after === null ? 0 : Number(after);
  const end = start + size;
  return { items: items.slice(start, end), next: end < items.length ? String(end) : null };
}

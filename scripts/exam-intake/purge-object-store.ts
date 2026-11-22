/**
 * The few storage operations the purge needs. The script talks to this
 * interface only, so the tests run against an in-memory fake and never
 * reach a real bucket.
 *
 * Nothing here knows about datasets: it is one bucket, and every call is
 * scoped to a key prefix the caller has already vetted.
 */
export interface ObjectVersionStore {
  /** Whether the bucket keeps versions. `off` means it never has. */
  versioning(): Promise<'enabled' | 'suspended' | 'off'>;
  /**
   * Whether Object Lock is switched on for the bucket. A locked version
   * cannot be removed, so the purge refuses such a bucket instead of
   * reporting a deletion it cannot finish.
   */
  objectLockEnabled(): Promise<boolean>;
  /** One page of versions and delete markers under `prefix`, in key order. */
  listVersions(prefix: string, after: string | null): Promise<Page<StoredVersion>>;
  /** One page of multipart uploads that were started and never finished. */
  listIncompleteUploads(prefix: string, after: string | null): Promise<Page<IncompleteUpload>>;
  /**
   * Remove these exact versions and delete markers for good. At most
   * `DELETE_BATCH_SIZE` entries per call. Entries that could not be
   * removed come back with the storage's error code; the call itself
   * throws only when nothing could be attempted.
   */
  deleteVersions(entries: readonly VersionRef[]): Promise<DeleteFailure[]>;
  /** Discard the parts of one unfinished multipart upload. */
  abortUpload(upload: IncompleteUpload): Promise<void>;
}

/** The storage's own limit for one delete request. */
export const DELETE_BATCH_SIZE = 1000;

export interface Page<T> {
  items: T[];
  /** Opaque position to pass back as `after`; null on the last page. */
  next: string | null;
}

export interface VersionRef {
  key: string;
  versionId: string;
}

export interface StoredVersion extends VersionRef {
  /** A delete marker hides a key; it holds no bytes and is itself a version. */
  deleteMarker: boolean;
  /** The version a plain read of the key returns. */
  latest: boolean;
  /** Bytes; 0 for a delete marker. */
  size: number;
}

export interface IncompleteUpload {
  key: string;
  uploadId: string;
}

export interface DeleteFailure extends VersionRef {
  /** For example `AccessDenied`. */
  code: string;
}

/**
 * The storage refused the caller or could not be reached: no further
 * call will work, so the run stops.
 */
export class StorageAccessError extends Error {
  override readonly name = 'StorageAccessError';
}

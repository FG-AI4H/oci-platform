import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  GetBucketVersioningCommand,
  GetObjectLockConfigurationCommand,
  ListMultipartUploadsCommand,
  ListObjectVersionsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  DELETE_BATCH_SIZE,
  StorageAccessError,
  type DeleteFailure,
  type IncompleteUpload,
  type ObjectVersionStore,
  type Page,
  type StoredVersion,
  type VersionRef,
} from './purge-object-store.js';

/** The one SDK method the adapter uses; narrow so a test can stand in for the client. */
export type S3Sender = Pick<S3Client, 'send'>;

/** Error names that mean "no call will work", whichever key the call is about. */
const ACCESS_ERROR_NAMES: ReadonlySet<string> = new Set([
  'AccessDenied',
  'AccessDeniedException',
  'CredentialsProviderError',
  'ExpiredToken',
  'ExpiredTokenException',
  'InvalidAccessKeyId',
  'InvalidClientTokenId',
  'InvalidToken',
  'NoSuchBucket',
  'SignatureDoesNotMatch',
  'UnrecognizedClientException',
]);

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : '';
}

/**
 * A listing position is a key and a version id (or an upload id). It
 * goes back to the storage as two fields, so it is carried as JSON.
 */
function encodePosition(key: string | undefined, id: string | undefined): string | null {
  if (key === undefined) return null;
  return JSON.stringify([key, id ?? null]);
}

function decodePosition(after: string | null): { key?: string; id?: string } {
  if (after === null) return {};
  const [key, id] = JSON.parse(after) as [string, string | null];
  return id === null ? { key } : { key, id };
}

/**
 * `ObjectVersionStore` on Amazon S3, or on a store that speaks its API.
 *
 * It never asks to bypass a retention rule and never touches a bucket's
 * configuration: it lists, deletes named versions and aborts uploads.
 */
export class S3ObjectVersionStore implements ObjectVersionStore {
  constructor(
    private readonly client: S3Sender,
    private readonly bucket: string,
  ) {}

  /**
   * Credentials come from the environment (the operator's assumed role),
   * never from an argument. `endpoint` is for a local S3-compatible
   * store; leave it unset for AWS.
   */
  static forBucket(bucket: string, region: string, endpoint?: string): S3ObjectVersionStore {
    const client = endpoint
      ? new S3Client({ region, endpoint, forcePathStyle: true })
      : new S3Client({ region });
    return new S3ObjectVersionStore(client, bucket);
  }

  async versioning(): Promise<'enabled' | 'suspended' | 'off'> {
    const out = await this.call(() =>
      this.client.send(new GetBucketVersioningCommand({ Bucket: this.bucket })),
    );
    if (out.Status === 'Enabled') return 'enabled';
    if (out.Status === 'Suspended') return 'suspended';
    return 'off';
  }

  async objectLockEnabled(): Promise<boolean> {
    try {
      const out = await this.client.send(
        new GetObjectLockConfigurationCommand({ Bucket: this.bucket }),
      );
      return out.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled';
    } catch (err) {
      // A bucket that never had Object Lock answers with this error.
      if (errorName(err) === 'ObjectLockConfigurationNotFoundError') return false;
      throw this.translate(err);
    }
  }

  async listVersions(prefix: string, after: string | null): Promise<Page<StoredVersion>> {
    const position = decodePosition(after);
    const out = await this.call(() =>
      this.client.send(
        new ListObjectVersionsCommand({
          Bucket: this.bucket,
          Prefix: prefix,
          KeyMarker: position.key,
          VersionIdMarker: position.id,
          MaxKeys: DELETE_BATCH_SIZE,
        }),
      ),
    );
    const items: StoredVersion[] = [];
    for (const v of out.Versions ?? []) {
      if (v.Key === undefined || v.VersionId === undefined) continue;
      items.push({
        key: v.Key,
        versionId: v.VersionId,
        deleteMarker: false,
        latest: v.IsLatest === true,
        size: v.Size ?? 0,
      });
    }
    for (const m of out.DeleteMarkers ?? []) {
      if (m.Key === undefined || m.VersionId === undefined) continue;
      items.push({
        key: m.Key,
        versionId: m.VersionId,
        deleteMarker: true,
        latest: m.IsLatest === true,
        size: 0,
      });
    }
    // Versions and delete markers arrive as two lists; put them back in
    // key order so that callers can count distinct keys as they go.
    items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return {
      items,
      next: out.IsTruncated ? encodePosition(out.NextKeyMarker, out.NextVersionIdMarker) : null,
    };
  }

  async listIncompleteUploads(
    prefix: string,
    after: string | null,
  ): Promise<Page<IncompleteUpload>> {
    const position = decodePosition(after);
    // The whole bucket's unfinished uploads are listed and the prefix is
    // applied here. S3 can filter by prefix itself, but not every store
    // that speaks its API does (one answers only for an exact key), and
    // an upload the listing missed would leave its parts behind unseen.
    // Unfinished uploads are few: the datasets bucket discards them after 7 days.
    const out = await this.call(() =>
      this.client.send(
        new ListMultipartUploadsCommand({
          Bucket: this.bucket,
          KeyMarker: position.key,
          UploadIdMarker: position.id,
        }),
      ),
    );
    const items: IncompleteUpload[] = [];
    for (const u of out.Uploads ?? []) {
      if (u.Key === undefined || u.UploadId === undefined) continue;
      if (!u.Key.startsWith(prefix)) continue;
      items.push({ key: u.Key, uploadId: u.UploadId });
    }
    return {
      items,
      next: out.IsTruncated ? encodePosition(out.NextKeyMarker, out.NextUploadIdMarker) : null,
    };
  }

  async deleteVersions(entries: readonly VersionRef[]): Promise<DeleteFailure[]> {
    if (entries.length === 0) return [];
    if (entries.length > DELETE_BATCH_SIZE) {
      throw new Error(`at most ${DELETE_BATCH_SIZE} versions per delete request`);
    }
    const out = await this.call(() =>
      this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            // Quiet: the answer lists only what failed.
            Quiet: true,
            Objects: entries.map((e) => ({ Key: e.key, VersionId: e.versionId })),
          },
        }),
      ),
    );
    return (out.Errors ?? []).map((e) => ({
      key: e.Key ?? '',
      versionId: e.VersionId ?? '',
      code: e.Code ?? 'Unknown',
    }));
  }

  async abortUpload(upload: IncompleteUpload): Promise<void> {
    await this.call(() =>
      this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: upload.key,
          UploadId: upload.uploadId,
        }),
      ),
    );
  }

  private async call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw this.translate(err);
    }
  }

  private translate(err: unknown): unknown {
    const name = errorName(err);
    if (ACCESS_ERROR_NAMES.has(name)) {
      // The name, not the message: a storage message can quote a key.
      return new StorageAccessError(`the storage refused the request (${name})`);
    }
    return err;
  }
}

import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  GetBucketVersioningCommand,
  GetObjectLockConfigurationCommand,
  ListMultipartUploadsCommand,
  ListObjectVersionsCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { DELETE_BATCH_SIZE, StorageAccessError } from './purge-object-store.js';
import { S3ObjectVersionStore, type S3Sender } from './purge-s3-object-store.js';

const BUCKET = 'oci-test-datasets-000000000000';
const PREFIX = 'sample-ct-a1b2/';

function named(name: string, message = name): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

/** A stand-in for the SDK client: answers each command from a table, and keeps the inputs. */
function sender(answer: (command: object) => unknown) {
  const sent: Array<{ command: string; input: Record<string, unknown> }> = [];
  const client = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ command: command.constructor.name, input: command.input });
      const out = answer(command);
      if (out instanceof Error) throw out;
      return out;
    },
  } as unknown as S3Sender;
  return { client, sent };
}

describe('S3ObjectVersionStore', () => {
  it('reads the versioning state', async () => {
    for (const [status, expected] of [
      ['Enabled', 'enabled'],
      ['Suspended', 'suspended'],
      [undefined, 'off'],
    ] as const) {
      const { client } = sender((c) =>
        c instanceof GetBucketVersioningCommand ? { Status: status } : named('Unexpected'),
      );
      expect(await new S3ObjectVersionStore(client, BUCKET).versioning()).toBe(expected);
    }
  });

  it('treats a bucket without an Object Lock configuration as not locked', async () => {
    const { client } = sender((c) =>
      c instanceof GetObjectLockConfigurationCommand
        ? named('ObjectLockConfigurationNotFoundError')
        : named('Unexpected'),
    );
    expect(await new S3ObjectVersionStore(client, BUCKET).objectLockEnabled()).toBe(false);
  });

  it('reports Object Lock when it is enabled', async () => {
    const { client } = sender(() => ({
      ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled' },
    }));
    expect(await new S3ObjectVersionStore(client, BUCKET).objectLockEnabled()).toBe(true);
  });

  it('does not guess when the lock state cannot be read', async () => {
    const { client } = sender(() => named('AccessDenied'));
    await expect(new S3ObjectVersionStore(client, BUCKET).objectLockEnabled()).rejects.toThrow(
      StorageAccessError,
    );
  });

  it('lists versions and delete markers in key order and carries the position on', async () => {
    const { client, sent } = sender((c) => {
      if (!(c instanceof ListObjectVersionsCommand)) return named('Unexpected');
      return c.input.KeyMarker === undefined
        ? {
            IsTruncated: true,
            NextKeyMarker: `${PREFIX}b`,
            NextVersionIdMarker: 'v2',
            Versions: [
              { Key: `${PREFIX}a`, VersionId: 'v1', IsLatest: false, Size: 10 },
              { Key: `${PREFIX}b`, VersionId: 'v2', IsLatest: true, Size: 20 },
            ],
            DeleteMarkers: [{ Key: `${PREFIX}a`, VersionId: 'm1', IsLatest: true }],
          }
        : { IsTruncated: false, Versions: [{ Key: `${PREFIX}c`, VersionId: 'null', Size: 30 }] };
    });
    const store = new S3ObjectVersionStore(client, BUCKET);

    const first = await store.listVersions(PREFIX, null);
    const second = await store.listVersions(PREFIX, first.next);

    expect(first.items).toEqual([
      { key: `${PREFIX}a`, versionId: 'v1', deleteMarker: false, latest: false, size: 10 },
      { key: `${PREFIX}a`, versionId: 'm1', deleteMarker: true, latest: true, size: 0 },
      { key: `${PREFIX}b`, versionId: 'v2', deleteMarker: false, latest: true, size: 20 },
    ]);
    expect(first.next).not.toBeNull();
    // An object stored before versioning was switched on has the version id "null".
    expect(second.items).toEqual([
      { key: `${PREFIX}c`, versionId: 'null', deleteMarker: false, latest: false, size: 30 },
    ]);
    expect(second.next).toBeNull();
    expect(sent[0]?.input).toMatchObject({ Bucket: BUCKET, Prefix: PREFIX, MaxKeys: 1000 });
    expect(sent[1]?.input).toMatchObject({ KeyMarker: `${PREFIX}b`, VersionIdMarker: 'v2' });
  });

  it('lists the unfinished uploads under the prefix and carries the position on', async () => {
    const { client, sent } = sender((c) => {
      if (!(c instanceof ListMultipartUploadsCommand)) return named('Unexpected');
      return c.input.KeyMarker === undefined
        ? {
            IsTruncated: true,
            NextKeyMarker: `${PREFIX}a`,
            NextUploadIdMarker: 'u1',
            Uploads: [
              { Key: 'other-dataset/x', UploadId: 'u0' },
              { Key: `${PREFIX}a`, UploadId: 'u1' },
            ],
          }
        : {
            IsTruncated: false,
            Uploads: [
              { Key: `${PREFIX}b`, UploadId: 'u2' },
              { Key: 'sample-ct-a1b2-second/y', UploadId: 'u3' },
            ],
          };
    });
    const store = new S3ObjectVersionStore(client, BUCKET);

    const first = await store.listIncompleteUploads(PREFIX, null);
    const second = await store.listIncompleteUploads(PREFIX, first.next);

    // Another dataset's uploads are listed by the storage and left out here.
    expect([...first.items, ...second.items]).toEqual([
      { key: `${PREFIX}a`, uploadId: 'u1' },
      { key: `${PREFIX}b`, uploadId: 'u2' },
    ]);
    // The prefix is applied on this side, not sent: see the adapter.
    expect(sent[0]?.input).toEqual({
      Bucket: BUCKET,
      KeyMarker: undefined,
      UploadIdMarker: undefined,
    });
    expect(sent[1]?.input).toMatchObject({ KeyMarker: `${PREFIX}a`, UploadIdMarker: 'u1' });
  });

  it('deletes named versions and returns what the storage could not remove', async () => {
    const { client, sent } = sender((c) =>
      c instanceof DeleteObjectsCommand
        ? { Errors: [{ Key: `${PREFIX}b`, VersionId: 'v2', Code: 'AccessDenied' }] }
        : named('Unexpected'),
    );
    const store = new S3ObjectVersionStore(client, BUCKET);

    const failures = await store.deleteVersions([
      { key: `${PREFIX}a`, versionId: 'v1' },
      { key: `${PREFIX}b`, versionId: 'v2' },
    ]);

    expect(failures).toEqual([{ key: `${PREFIX}b`, versionId: 'v2', code: 'AccessDenied' }]);
    expect(sent[0]?.input).toEqual({
      Bucket: BUCKET,
      Delete: {
        Quiet: true,
        Objects: [
          { Key: `${PREFIX}a`, VersionId: 'v1' },
          { Key: `${PREFIX}b`, VersionId: 'v2' },
        ],
      },
    });
    // Never asks to bypass a retention rule.
    expect(JSON.stringify(sent[0]?.input)).not.toContain('Bypass');
  });

  it('sends nothing for an empty batch and refuses one that is too large', async () => {
    const { client, sent } = sender(() => named('Unexpected'));
    const store = new S3ObjectVersionStore(client, BUCKET);

    expect(await store.deleteVersions([])).toEqual([]);
    const tooMany = Array.from({ length: DELETE_BATCH_SIZE + 1 }, (_, i) => ({
      key: `${PREFIX}${i}`,
      versionId: 'v',
    }));
    await expect(store.deleteVersions(tooMany)).rejects.toThrow('at most 1000');
    expect(sent).toEqual([]);
  });

  it('aborts an unfinished upload by key and upload id', async () => {
    const { client, sent } = sender((c) =>
      c instanceof AbortMultipartUploadCommand ? {} : named('Unexpected'),
    );

    await new S3ObjectVersionStore(client, BUCKET).abortUpload({
      key: `${PREFIX}a`,
      uploadId: 'u1',
    });

    expect(sent[0]?.input).toEqual({ Bucket: BUCKET, Key: `${PREFIX}a`, UploadId: 'u1' });
  });

  it('turns an access failure into one error that does not repeat the storage message', async () => {
    const { client } = sender(() =>
      named('AccessDenied', `not allowed on ${PREFIX}u1/INVENTED-NAME.dcm`),
    );
    const store = new S3ObjectVersionStore(client, BUCKET);

    const failure = await store.listVersions(PREFIX, null).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(StorageAccessError);
    expect((failure as Error).message).toBe('the storage refused the request (AccessDenied)');
  });
});

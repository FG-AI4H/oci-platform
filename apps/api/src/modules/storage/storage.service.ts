import { createHash, randomUUID } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CompleteUploadRequest,
  DatasetSlug,
  InitUploadRequest,
  InitUploadResponse,
  PartUrlResponse,
  UploadedDistribution,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { CatalogService } from '../catalog/catalog.service.js';
import { PrismaService } from '../../prisma.service.js';
import { DicomIndexService } from './dicom-index.service.js';
import { S3ClientProvider } from './s3-client.js';
import { AccessRequestService } from '../access-request/access-request.service.js';

/**
 * S3 multipart-upload orchestration + gated download (PR I, #87).
 *
 * Multipart flow:
 *   1. `initUpload`      — opens an S3 multipart upload, returns
 *                          {uploadId, key, partSize}. The platform
 *                          doesn't persist a row yet — abandoned
 *                          uploads are GC'd by the bucket's
 *                          AbortIncompleteMultipartUpload lifecycle
 *                          rule (7 days).
 *   2. `getPartUrl`      — mints a single presigned PUT URL with
 *                          short TTL. Browsers call this once per
 *                          chunk; parallelism is the browser's
 *                          decision.
 *   3. `completeUpload`  — finalises the multipart on S3, then
 *                          inserts a `Distribution` row with
 *                          storageBackend=S3, uploadStatus=READY.
 *   4. `abortUpload`     — cancels mid-flight. S3 cleans up
 *                          eventually via lifecycle even without
 *                          this call, but explicit abort is faster.
 *
 * Gated download:
 *   - PUBLIC dataset, distribution.requiresAccess=false → 302 to
 *     presigned GET for any authenticated caller (anonymous when we
 *     wire it in a follow-up).
 *   - RESTRICTED OR requiresAccess=true → caller must hold an
 *     APPROVED AccessRequest for the dataset.
 *   - PRIVATE → host or admin only (matches the visibility filter
 *     used elsewhere in the catalog module).
 *
 * Auth: every method takes the JWT user. Authz is enforced here, not
 * by the controller, so a future internal caller (e.g. annotation
 * tool fetching the source images) sees the same guarantees.
 */
@Injectable()
export class StorageService {
  // S3 caps: max 10 000 parts; min part size 5 MiB (except the
  // final part). We default to 16 MiB which fits a ~160 GB file in
  // 10 000 parts; beyond that, computePartSize scales.
  private static readonly MAX_PARTS = 10_000;
  private static readonly PART_URL_TTL_S = 15 * 60;
  static readonly DOWNLOAD_URL_TTL_S = 15 * 60;
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(S3ClientProvider) private readonly s3: S3ClientProvider,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(AccessRequestService) private readonly accessRequests: AccessRequestService,
    @Inject(DicomIndexService) private readonly dicomIndex: DicomIndexService,
  ) {}

  async initUpload(
    slug: DatasetSlug,
    body: InitUploadRequest,
    user: CognitoAccessTokenPayload,
  ): Promise<InitUploadResponse> {
    const target = await this.requireHost(slug, user);

    // Pick a key that's stable + sortable + collision-free across
    // re-uploads. `<slug>/<uuid>/<filename>` keeps S3 console listings
    // readable and lets us partition lifecycle rules per dataset later.
    const key = `${target.slug}/${randomUUID()}/${sanitiseFilename(body.filename)}`;

    const partSize = computePartSize(body.contentSize);

    const cmd = new CreateMultipartUploadCommand({
      Bucket: this.s3.bucket,
      Key: key,
      ContentType: body.contentType,
      // SSE is enforced bucket-side (CDK puts a default-encryption
      // configuration on the bucket + a deny-on-missing-encryption
      // policy in prod), not per-request. Setting it per-request
      // tripped MinIO 'NotImplemented' in dev — and would force every
      // PUT to carry the header, which is fragile for browsers using
      // presigned URLs that didn't include the encryption directive
      // in the signature.
      Metadata: {
        'oci-dataset-slug': target.slug,
        'oci-host-sub': user.sub,
        ...(body.sha256 ? { 'oci-claimed-sha256': body.sha256 } : {}),
      },
    });
    const out = await this.s3.client.send(cmd);
    if (!out.UploadId) {
      throw new BadRequestException('S3 did not return an UploadId');
    }
    return { uploadId: out.UploadId, key, partSize };
  }

  async getPartUrl(args: {
    slug: DatasetSlug;
    uploadId: string;
    key: string;
    partNumber: number;
    user: CognitoAccessTokenPayload;
  }): Promise<PartUrlResponse> {
    await this.requireHost(args.slug, args.user);
    if (args.partNumber < 1 || args.partNumber > StorageService.MAX_PARTS) {
      throw new BadRequestException(`partNumber must be between 1 and ${StorageService.MAX_PARTS}`);
    }

    const cmd = new UploadPartCommand({
      Bucket: this.s3.bucket,
      Key: args.key,
      UploadId: args.uploadId,
      PartNumber: args.partNumber,
    });
    const url = await this.presign(cmd, StorageService.PART_URL_TTL_S);
    const expiresAt = new Date(Date.now() + StorageService.PART_URL_TTL_S * 1000).toISOString();
    return { url, expiresAt };
  }

  async completeUpload(args: {
    slug: DatasetSlug;
    uploadId: string;
    key: string;
    body: CompleteUploadRequest;
    user: CognitoAccessTokenPayload;
    contentType: string;
    contentSize: number;
    sha256: string | null;
  }): Promise<UploadedDistribution> {
    const target = await this.requireHost(args.slug, args.user);

    // `initUpload` mints every key under the dataset's own prefix. The
    // key comes back from the browser, so hold it to that: the DICOM
    // index below records the file against this dataset (ADR-0026).
    if (typeof args.key !== 'string' || !args.key.startsWith(`${target.slug}/`)) {
      throw new BadRequestException('upload key does not belong to this dataset');
    }

    // Everything that can refuse the upload is checked before storage
    // assembles the object: once it has, a refusal would leave the
    // bytes behind with no row pointing at them. Uploads attach to the
    // latest published version, so there has to be one.
    const versionId = await this.latestVersionIdOrNull(target.id);
    if (!versionId) {
      throw new BadRequestException(
        `dataset "${args.slug}" has no published version yet; publish a manifest first`,
      );
    }

    // S3 wants the parts sorted by partNumber and ETags surrounded by
    // double-quotes (the SDK is finicky about both). Defensive sort +
    // quote-add even though the browser usually gets this right.
    const parts = [...args.body.parts]
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((p) => ({
        PartNumber: p.partNumber,
        ETag: p.etag.startsWith('"') ? p.etag : `"${p.etag}"`,
      }));

    const completeCmd = new CompleteMultipartUploadCommand({
      Bucket: this.s3.bucket,
      Key: args.key,
      UploadId: args.uploadId,
      MultipartUpload: { Parts: parts },
    });
    await this.s3.client.send(completeCmd);

    // ADR-0026: read the header before the file is offered to anyone.
    // A DICOM file with de-identification findings is recorded as held,
    // and every path that serves bytes checks that. If the check itself
    // cannot run, no Distribution row is written, so the file is not
    // reachable, and the stored object is discarded so that unchecked
    // bytes do not stay behind. Fail closed.
    let dicomCheckStatus: UploadedDistribution['dicomCheckStatus'];
    try {
      dicomCheckStatus = await this.dicomIndex.indexStoredObject({
        datasetId: target.id,
        s3Bucket: this.s3.bucket,
        s3Key: args.key,
      });
    } catch (err) {
      await this.discardStoredObject(target.id, args.key);
      throw err;
    }

    const filename = args.body.croissantId ?? args.key.split('/').filter(Boolean).pop() ?? args.key;

    const dist = await this.prisma.client.distribution.upsert({
      where: {
        datasetVersionId_croissantId: { datasetVersionId: versionId, croissantId: filename },
      },
      create: {
        datasetVersionId: versionId,
        croissantId: filename,
        contentUrl: this.publicContentUrl(target.slug),
        contentType: args.contentType,
        contentSizeBytes: BigInt(args.contentSize),
        contentHash: args.sha256,
        requiresAccess: false,
        storageBackend: 'S3',
        s3Bucket: this.s3.bucket,
        s3Key: args.key,
        uploadStatus: 'READY',
      },
      update: {
        contentType: args.contentType,
        contentSizeBytes: BigInt(args.contentSize),
        contentHash: args.sha256,
        storageBackend: 'S3',
        s3Bucket: this.s3.bucket,
        s3Key: args.key,
        uploadStatus: 'READY',
      },
    });

    return {
      distributionId: dist.id,
      name: dist.croissantId,
      contentUrl: this.publicContentUrl(target.slug, dist.id),
      contentType: dist.contentType,
      contentSizeBytes: Number(dist.contentSizeBytes ?? 0n),
      sha256: dist.contentHash,
      uploadedAt: new Date().toISOString(),
      dicomCheckStatus,
    };
  }

  async abortUpload(args: {
    slug: DatasetSlug;
    uploadId: string;
    key: string;
    user: CognitoAccessTokenPayload;
  }): Promise<void> {
    await this.requireHost(args.slug, args.user);
    await this.s3.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.s3.bucket,
        Key: args.key,
        UploadId: args.uploadId,
      }),
    );
  }

  /**
   * Mint a presigned GET URL for one Distribution. Caller authz:
   *   - PUBLIC + !requiresAccess         → any caller
   *   - RESTRICTED OR requiresAccess     → caller has APPROVED request
   *   - PRIVATE                          → host or admin
   * Returns the URL string; controller 302s to it.
   */
  async getDownloadUrl(args: {
    slug: DatasetSlug;
    distributionId: string;
    user: CognitoAccessTokenPayload | undefined;
  }): Promise<string> {
    const ds = await this.catalog.findOwnerBySlug(args.slug);
    if (!ds) throw new NotFoundException(`dataset "${args.slug}" not found`);

    const dist = (await this.prisma.client.distribution.findFirst({
      where: { id: args.distributionId, datasetVersion: { datasetId: ds.id } },
    })) as {
      id: string;
      contentType: string;
      requiresAccess: boolean;
      storageBackend: 'S3' | 'EXTERNAL' | 'EXTERNAL_S3';
      s3Bucket: string | null;
      s3Key: string | null;
      uploadStatus: 'PENDING' | 'READY' | 'FAILED' | null;
    } | null;
    if (!dist) throw new NotFoundException('distribution not found');
    if (dist.storageBackend !== 'S3' || !dist.s3Bucket || !dist.s3Key) {
      throw new BadRequestException(
        'distribution is not platform-hosted; use its contentUrl directly',
      );
    }
    if (dist.uploadStatus !== 'READY') {
      throw new NotFoundException('distribution upload is not complete');
    }

    const dataset = await this.authoriseDatasetBytes({
      datasetId: ds.id,
      requiresAccess: dist.requiresAccess,
      user: args.user,
    });

    // ADR-0026: a DICOM file with undecided de-identification findings
    // is served to nobody but its host and platform operators, whatever
    // the dataset's visibility. 404, not 403: the file is not listed for
    // this caller either, so its existence is not confirmed.
    if (
      !this.isHostOrOperator(dataset.hostId, args.user) &&
      (await this.dicomIndex.isHeld(dist.s3Bucket, dist.s3Key))
    ) {
      throw new NotFoundException('distribution not found');
    }

    const cmd = new GetObjectCommand({ Bucket: dist.s3Bucket, Key: dist.s3Key });
    return this.presign(cmd, StorageService.DOWNLOAD_URL_TTL_S);
  }

  /**
   * THE gate for handing out dataset bytes. Extracted verbatim from
   * `getDownloadUrl` so the bulk-download path (`GET /v2/catalog/
   * datasets/:slug/download`, `BulkDownloadService`) enforces the same
   * rules rather than a parallel re-implementation — a bulk endpoint
   * that drifted from this would be an access-control bypass.
   *
   *   - PRIVATE                      → host or admin only
   *   - RESTRICTED OR requiresAccess → host, admin, or an APPROVED
   *                                    AccessRequest for the dataset
   *   - PUBLIC + !requiresAccess     → anyone (including anonymous)
   *
   * Throws ForbiddenException on failure; returns the dataset row the
   * decision was made on so callers can reuse it.
   */
  async authoriseDatasetBytes(args: {
    datasetId: string;
    /**
     * The distribution-level override. Bulk download passes `false`
     * because it *excludes* `requiresAccess` rows from the archive
     * outright, so the archive never contains bytes this flag guards.
     */
    requiresAccess: boolean;
    user: CognitoAccessTokenPayload | undefined;
  }): Promise<{
    visibility: 'PRIVATE' | 'RESTRICTED' | 'PUBLIC';
    status: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
    hostId: string;
    slug: string;
  }> {
    // Fetch dataset visibility separately — `findOwnerBySlug` only
    // returns id+hostId. The full row is needed for the gating below.
    const fullDataset = (await this.prisma.client.dataset.findUnique({
      where: { id: args.datasetId },
      select: { visibility: true, status: true, hostId: true, slug: true },
    })) as {
      visibility: 'PRIVATE' | 'RESTRICTED' | 'PUBLIC';
      status: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
      hostId: string;
      slug: string;
    };

    const groups = (args.user?.['cognito:groups'] ?? []) as string[];
    const isAdmin = groups.includes('admin');
    const callerHostId = args.user?.sub ? subToUuid(args.user.sub) : null;

    if (fullDataset.visibility === 'PRIVATE') {
      if (!isAdmin && callerHostId !== fullDataset.hostId) {
        throw new ForbiddenException('private dataset; host or admin only');
      }
    } else if (fullDataset.visibility === 'RESTRICTED' || args.requiresAccess) {
      if (!isAdmin && callerHostId !== fullDataset.hostId) {
        // Must have APPROVED request.
        if (!args.user) {
          throw new ForbiddenException('sign in and request access first');
        }
        const approved = await this.hasApprovedRequest(args.datasetId, args.user);
        if (!approved) {
          throw new ForbiddenException('access not approved');
        }
      }
    }
    // PUBLIC + !requiresAccess: anyone (incl. anonymous in a follow-up)

    return fullDataset;
  }

  /**
   * Who may read a held DICOM file (ADR-0026): the dataset's host and
   * platform operators. Until a separate operator role exists, an
   * operator is a member of the `admin` group.
   */
  isHostOrOperator(hostId: string, user: CognitoAccessTokenPayload | undefined): boolean {
    if (!user?.sub) return false;
    const groups = (user['cognito:groups'] ?? []) as string[];
    return groups.includes('admin') || subToUuid(user.sub) === hostId;
  }

  /**
   * A signed storage address for one stored object, good for
   * `DOWNLOAD_URL_TTL_S`. There is NO authorisation here: the caller
   * has already decided that this reader may have these bytes
   * (`authoriseDatasetBytes`, and the hold on DICOM files).
   */
  signStoredObjectUrl(s3Bucket: string, s3Key: string): Promise<string> {
    return this.presign(
      new GetObjectCommand({ Bucket: s3Bucket, Key: s3Key }),
      StorageService.DOWNLOAD_URL_TTL_S,
    );
  }

  /**
   * Until when an address signed now is sure to work. Call it BEFORE
   * signing, so that what is stated is never later than the truth.
   *
   * Not simply now + TTL: a signed address also dies with the
   * credentials that signed it. On AWS those are the task role's
   * temporary credentials, which the SDK renews only in their last
   * five minutes, so an address signed late in their life is shorter
   * lived than its TTL says.
   */
  async signedUrlValidUntil(): Promise<Date> {
    const byTtl = Date.now() + StorageService.DOWNLOAD_URL_TTL_S * 1000;
    const credentials = await this.s3.client.config.credentials();
    const byCredentials = credentials.expiration?.getTime() ?? Number.POSITIVE_INFINITY;
    return new Date(Math.min(byTtl, byCredentials));
  }

  // ----- helpers ---------------------------------------------------

  private async requireHost(
    slug: DatasetSlug,
    user: CognitoAccessTokenPayload,
  ): Promise<{ id: string; hostId: string; slug: string }> {
    if (!user?.sub) throw new ForbiddenException('authentication required');
    const target = await this.catalog.findOwnerBySlug(slug);
    if (!target) throw new NotFoundException(`dataset "${slug}" not found`);

    const groups = (user['cognito:groups'] ?? []) as string[];
    const isAdmin = groups.includes('admin');
    // Same UUIDv5 derivation as catalog.service / access-request.service
    // so non-UUID local-dev sessions still match the row's hostId.
    const callerId = subToUuid(user.sub);
    if (!isAdmin && target.hostId !== callerId) {
      throw new ForbiddenException('only the dataset host or an admin can upload');
    }
    return { ...target, slug };
  }

  /**
   * Remove an object whose upload could not be finished. Best effort:
   * the caller is already failing, and that failure is what the host
   * must see. On a versioned bucket this hides the object behind a
   * delete marker; removing the version itself is an operator's task.
   */
  private async discardStoredObject(datasetId: string, key: string): Promise<void> {
    try {
      await this.s3.client.send(new DeleteObjectCommand({ Bucket: this.s3.bucket, Key: key }));
    } catch {
      // The dataset, not the key: a file name can carry an identifier.
      this.logger.error(`could not discard an unchecked upload dataset=${datasetId}`);
    }
  }

  private async latestVersionIdOrNull(datasetId: string): Promise<string | null> {
    const v = (await this.prisma.client.datasetVersion.findFirst({
      where: { datasetId },
      orderBy: { publishedAt: 'desc' },
      select: { id: true },
    })) as { id: string } | null;
    return v?.id ?? null;
  }

  private async hasApprovedRequest(
    datasetId: string,
    user: CognitoAccessTokenPayload,
  ): Promise<boolean> {
    const reqs = await this.accessRequests.listOwn(user);
    return reqs.some((r) => r.dataset.id === datasetId && r.status === 'APPROVED');
  }

  private async presign(
    cmd: GetObjectCommand | UploadPartCommand,
    ttlSeconds: number,
  ): Promise<string> {
    // The SDK's getSignedUrl is typed against a specific Command
    // generic; both GetObjectCommand and UploadPartCommand satisfy
    // its runtime contract identically, but the union erases that
    // proof at the type layer. Cast through `unknown` since both
    // shapes work end-to-end (the hash + signature step doesn't care
    // about the input shape).
    const url = await getSignedUrl(this.s3.client, cmd as unknown as GetObjectCommand, {
      expiresIn: ttlSeconds,
    });
    if (!this.s3.publicEndpoint) return url;
    // In MinIO local mode the SDK presigns against the in-cluster
    // hostname (e.g. `http://minio:9000`) but the browser fetches
    // from localhost. Rewrite the host post-sign — the path + query
    // (where the signature lives) are unchanged.
    return rewriteHost(url, this.s3.publicEndpoint);
  }

  /** What the host pastes into the manifest's `contentUrl`. */
  private publicContentUrl(slug: string, distId?: string): string {
    return distId
      ? `/v2/catalog/datasets/${slug}/distributions/${distId}/download`
      : `/v2/catalog/datasets/${slug}/distributions`;
  }
}

const FILENAME_SAFE = /^[A-Za-z0-9._-]+$/;
function sanitiseFilename(name: string): string {
  // Strip path components and non-portable characters. S3 accepts a
  // lot, but we want predictable URL paths.
  const tail = name.split('/').pop() ?? 'file';
  return FILENAME_SAFE.test(tail) ? tail : tail.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function computePartSize(contentSize: number): number {
  // 16 MiB by default; scale up so we never exceed 10 000 parts.
  const minForCount = Math.ceil(contentSize / 9_999);
  const candidate = Math.max(16 * 1024 * 1024, minForCount, 5 * 1024 * 1024);
  return candidate;
}

function rewriteHost(rawUrl: string, replacement: string): string {
  try {
    const target = new URL(rawUrl);
    const repl = new URL(replacement);
    target.protocol = repl.protocol;
    target.host = repl.host;
    return target.toString();
  } catch {
    return rawUrl;
  }
}

/** UUIDv5 from a Cognito sub — same derivation as catalog.service. */
const SUB_NAMESPACE_UUID = 'a4f1c8b2-7d3e-5b9c-9f0a-3c8d4e5f6a7b';
function subToUuid(sub: string): string {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(sub)) {
    return sub.toLowerCase();
  }
  const nsBytes = Buffer.from(SUB_NAMESPACE_UUID.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(Buffer.from(sub, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

import type {
  CompleteUploadRequest,
  InitUploadResponse,
  PartUrlResponse,
  UploadedDistribution,
} from '@oci/shared-types';

/**
 * Browser-side multipart upload orchestrator (PR I, #87).
 *
 * Drives the `/v2/catalog/datasets/<slug>/uploads/...` API surface
 * through an `UploadTransport`, not S3 directly. The API mints a
 * presigned PUT URL per part; we PUT the corresponding chunk to each
 * URL in parallel. ETags collected from the responses go back to the
 * API's `complete` endpoint, which finalises the multipart on S3 and
 * persists the Distribution row.
 *
 * The transport is the only thing that talks to the API, and it does so
 * on the server (see `upload-actions.ts`): this module runs in the
 * browser and never holds a bearer token (#643).
 *
 * Concurrency, retry, and resume policy:
 *   - DEFAULT_CONCURRENCY=3 parallel uploads. Higher saturates a
 *     consumer connection without much marginal gain on multipart-
 *     S3-throughput; lower wastes round trips. Configurable.
 *   - Each part retries up to 3 times with exponential backoff
 *     (1 s / 2 s / 4 s + 0–500 ms jitter). Network blips and 503s
 *     from S3 are common at scale.
 *   - Within-session resume: completed parts persist in `localStorage`
 *     keyed by `<slug>:<key>:<uploadId>`. A reload on the same tab
 *     picks up where it left off. Cross-session resume is bigger
 *     scope; deferred to PR I.next-1 (CLI).
 *
 * Realistic ceiling: ~50 GB per browser session. Above that, point
 * users at the CLI tool (#88).
 *
 * Not: chunk-level checksumming (S3's per-part ETag is good enough
 * for at-rest verification), pause/resume UI controls, transfer-rate
 * graphs. All deferred.
 */
/** Identifies one multipart upload on the API. */
export interface UploadRef {
  uploadId: string;
  key: string;
}

/** The API's four upload control calls. Each rejects on failure. */
export interface UploadTransport {
  init(request: {
    filename: string;
    contentType: string;
    contentSize: number;
    sha256?: string;
  }): Promise<InitUploadResponse>;
  partUrl(ref: UploadRef, partNumber: number): Promise<PartUrlResponse>;
  complete(
    ref: UploadRef,
    file: { contentType: string; contentSize: number; sha256?: string },
    body: CompleteUploadRequest,
  ): Promise<UploadedDistribution>;
  abort(ref: UploadRef): Promise<void>;
}

export interface UploadOptions {
  /** Namespaces the resume record in `localStorage`. */
  slug: string;
  file: File;
  /** How the API is reached; the caller's session stays on the server. */
  transport: UploadTransport;
  /**
   * Optional sha256 hex (lower-case). Computed in-browser via
   * `crypto.subtle.digest`. Skipped when undefined to avoid the read
   * pass on truly large files.
   */
  sha256?: string;
  /** Default 3. Raise carefully; S3 returns 503s when over-parallelised. */
  concurrency?: number;
  /** Called with 0..1 progress as parts complete. */
  onProgress?: (fraction: number) => void;
  /** Aborts the in-flight upload (multipart on S3 + this orchestrator). */
  signal?: AbortSignal;
}

export interface UploadResult {
  distribution: UploadedDistribution;
}

const DEFAULT_CONCURRENCY = 3;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

interface PartState {
  partNumber: number;
  etag: string;
}

interface ResumeRecord {
  parts: PartState[];
  uploadedBytes: number;
}

function resumeStorageKey(slug: string, key: string, uploadId: string): string {
  return `oci.upload.${slug}.${key}.${uploadId}`;
}

function readResumeState(storageKey: string): ResumeRecord | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumeRecord;
    if (!Array.isArray(parsed.parts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeResumeState(storageKey: string, record: ResumeRecord): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(record));
  } catch {
    // localStorage full / disabled — resume just won't work this session.
  }
}

function clearResumeState(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    /* noop */
  }
}

/**
 * Run the full multipart upload. Returns the persisted Distribution
 * on success; throws on hard failure (after retries) or abort.
 */
export async function uploadMultipart(opts: UploadOptions): Promise<UploadResult> {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const contentType = opts.file.type || 'application/octet-stream';

  // 1. Initiate. (The transport's calls cannot be interrupted once
  // sent; a cancel takes effect before the next one.)
  if (opts.signal?.aborted) throw new Error('upload aborted');
  const init = await opts.transport.init({
    filename: opts.file.name,
    contentType,
    contentSize: opts.file.size,
    sha256: opts.sha256,
  });
  const ref: UploadRef = { uploadId: init.uploadId, key: init.key };

  const totalParts = Math.max(1, Math.ceil(opts.file.size / init.partSize));
  const storageKey = resumeStorageKey(opts.slug, init.key, init.uploadId);
  const resumed = readResumeState(storageKey);
  const completedByPart = new Map<number, string>();
  if (resumed) {
    for (const p of resumed.parts) completedByPart.set(p.partNumber, p.etag);
  }

  let uploadedBytes = resumed?.uploadedBytes ?? 0;
  if (opts.onProgress && opts.file.size > 0) {
    opts.onProgress(uploadedBytes / opts.file.size);
  }

  // 2. Upload parts (parallel up to concurrency, with retry).
  const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);
  const queue = partNumbers.filter((n) => !completedByPart.has(n));

  const uploadOnePart = async (partNumber: number): Promise<void> => {
    const start = (partNumber - 1) * init.partSize;
    const end = Math.min(opts.file.size, start + init.partSize);
    const blob = opts.file.slice(start, end);

    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (opts.signal?.aborted) throw new Error('upload aborted');
        const partUrl = await opts.transport.partUrl(ref, partNumber);
        const res = await fetch(partUrl.url, {
          method: 'PUT',
          body: blob,
          signal: opts.signal,
        });
        if (!res.ok) {
          throw new Error(`S3 PUT part ${partNumber} returned ${res.status}`);
        }
        const etag = res.headers.get('ETag') ?? res.headers.get('etag');
        if (!etag) throw new Error(`S3 PUT part ${partNumber} returned no ETag header`);
        completedByPart.set(partNumber, etag);
        uploadedBytes += blob.size;
        writeResumeState(storageKey, {
          parts: Array.from(completedByPart, ([partNumber, etag]) => ({ partNumber, etag })),
          uploadedBytes,
        });
        if (opts.onProgress && opts.file.size > 0) {
          opts.onProgress(uploadedBytes / opts.file.size);
        }
        return;
      } catch (err) {
        lastErr = err;
        if (opts.signal?.aborted) throw err;
        const backoff = BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 500;
        await sleep(backoff);
      }
    }
    throw new Error(
      `part ${partNumber} failed after ${MAX_RETRIES} attempts: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
  };

  // Worker pool
  const inFlight = new Set<Promise<void>>();
  for (const n of queue) {
    if (opts.signal?.aborted) break;
    while (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }
    const p = uploadOnePart(n).finally(() => inFlight.delete(p));
    inFlight.add(p);
  }
  await Promise.all(inFlight);

  if (opts.signal?.aborted) {
    await opts.transport.abort(ref).catch(() => {
      /* best effort */
    });
    clearResumeState(storageKey);
    throw new Error('upload aborted');
  }

  // 3. Complete.
  const sortedParts: PartState[] = Array.from(completedByPart, ([partNumber, etag]) => ({
    partNumber,
    etag,
  })).sort((a, b) => a.partNumber - b.partNumber);
  const completeBody: CompleteUploadRequest = { parts: sortedParts };

  const distribution = await opts.transport.complete(
    ref,
    { contentType, contentSize: opts.file.size, sha256: opts.sha256 },
    completeBody,
  );

  clearResumeState(storageKey);
  return { distribution };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

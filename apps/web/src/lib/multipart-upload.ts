import type {
  CompleteUploadRequest,
  InitUploadResponse,
  PartUrlResponse,
  UploadedDistribution,
} from '@oci/shared-types';

/**
 * Browser-side multipart upload orchestrator (PR I, #87).
 *
 * Talks to our `/v2/catalog/datasets/<slug>/uploads/...` API surface,
 * not S3 directly. The API mints a presigned PUT URL per part; we
 * fetch each URL and PUT the corresponding chunk in parallel. ETags
 * collected from the responses go back to the API's `complete`
 * endpoint, which finalises the multipart on S3 and persists the
 * Distribution row.
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
export interface UploadOptions {
  slug: string;
  file: File;
  /** Bearer token from the NextAuth session. */
  accessToken: string;
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
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) throw new Error('NEXT_PUBLIC_API_BASE_URL is not set');
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

  // 1. Initiate.
  const init = (await jsonFetch(
    `${apiBase}/v2/catalog/datasets/${encodeURIComponent(opts.slug)}/uploads`,
    {
      method: 'POST',
      accessToken: opts.accessToken,
      body: {
        filename: opts.file.name,
        contentType: opts.file.type || 'application/octet-stream',
        contentSize: opts.file.size,
        sha256: opts.sha256,
      },
      signal: opts.signal,
    },
  )) as InitUploadResponse;

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

    const partUrlPath = `${apiBase}/v2/catalog/datasets/${encodeURIComponent(opts.slug)}/uploads/${encodeURIComponent(init.uploadId)}/parts/${partNumber}/url?key=${encodeURIComponent(init.key)}`;

    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const partUrl = (await jsonFetch(partUrlPath, {
          method: 'GET',
          accessToken: opts.accessToken,
          signal: opts.signal,
        })) as PartUrlResponse;
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
    await abortUpload(apiBase, opts.slug, init, opts.accessToken).catch(() => {
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

  const completeUrl = new URL(
    `${apiBase}/v2/catalog/datasets/${encodeURIComponent(opts.slug)}/uploads/${encodeURIComponent(
      init.uploadId,
    )}/complete`,
  );
  completeUrl.searchParams.set('key', init.key);
  completeUrl.searchParams.set('contentType', opts.file.type || 'application/octet-stream');
  completeUrl.searchParams.set('contentSize', String(opts.file.size));
  if (opts.sha256) completeUrl.searchParams.set('sha256', opts.sha256);

  const distribution = (await jsonFetch(completeUrl.toString(), {
    method: 'POST',
    accessToken: opts.accessToken,
    body: completeBody,
    signal: opts.signal,
  })) as UploadedDistribution;

  clearResumeState(storageKey);
  return { distribution };
}

async function abortUpload(
  apiBase: string,
  slug: string,
  init: InitUploadResponse,
  accessToken: string,
): Promise<void> {
  const url = `${apiBase}/v2/catalog/datasets/${encodeURIComponent(slug)}/uploads/${encodeURIComponent(
    init.uploadId,
  )}/abort?key=${encodeURIComponent(init.key)}`;
  await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
}

interface JsonFetchInit {
  method: 'GET' | 'POST';
  accessToken: string;
  body?: unknown;
  signal?: AbortSignal;
}

async function jsonFetch(url: string, init: JsonFetchInit): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${init.accessToken}`,
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status} ${res.statusText} on ${url}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * The platform's own HTTP API, as far as a bulk upload needs it: read a
 * dataset, create it, publish a version, upload one file through the
 * multipart flow. Nothing here writes to the bucket or the database
 * directly, so the platform's header check, index and hold run on every
 * file exactly as they do for an upload from the browser.
 *
 * Kept free of anything about exams, so that another bulk upload (for
 * example of a public image set) can use the same client.
 *
 * The session token is given once, to the constructor. It is sent as a
 * bearer header to the API's own origin and nowhere else: redirects are
 * refused, and the signed storage addresses get no header at all.
 * Errors carry a status and the API's message, never a header, a token
 * or a signed address.
 */

export interface PlatformDataset {
  slug: string;
  visibility: string;
  accessTier: string;
  status: string;
  /** Newest first, as the API returns them. */
  versions: Array<{ id: string; version: string }>;
  /** The files of the latest version. */
  distributions: Array<{
    id: string;
    croissantId: string;
    contentHash: string | null;
    contentSizeBytes: number | null;
  }>;
}

export interface FileToUpload {
  /** Name stored with the object: one path segment, portable characters. */
  filename: string;
  /** Identifier of the file within the dataset version. Unique per version. */
  croissantId: string;
  contentType: string;
  sizeBytes: number;
  /** Lower-case hex. */
  sha256: string;
  /** Bytes `[offset, offset + length)` of the file. */
  read: (offset: number, length: number) => Uint8Array;
}

export interface UploadedFile {
  distributionId: string;
  contentUrl: string;
  /** Outcome of the platform's header check; null when it did not see a DICOM file. */
  dicomCheckStatus: string | null;
}

export interface PlatformApi {
  getDataset(slug: string): Promise<PlatformDataset | null>;
  createDataset(dataset: {
    slug: string;
    name: string;
    description: string | null;
    visibility: 'PRIVATE';
    accessTier: 'CONTROLLED';
  }): Promise<void>;
  publishVersion(
    slug: string,
    version: { version: string; croissant: unknown; notes: string },
  ): Promise<void>;
  uploadFile(slug: string, file: FileToUpload): Promise<UploadedFile>;
}

/** An answer of the API or of storage that is not the expected one. */
export class PlatformApiError extends Error {
  override readonly name = 'PlatformApiError';
  constructor(
    readonly step: string,
    readonly status: number,
    detail: string,
  ) {
    super(`${step}: HTTP ${status}${detail ? ` (${detail})` : ''}`);
  }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The body limit of the API (Fastify's default): a larger request is answered 413. */
export const API_BODY_LIMIT_BYTES = 1024 * 1024;

/** `https://`, or plain `http://` to this machine only: a token is never sent in clear over a network. */
export function checkApiBase(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a URL`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('the API address must start with https:// (http:// only for localhost)');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('the API address must be a plain origin, without credentials or a query');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

function messageOf(body: unknown): string {
  if (body && typeof body === 'object') {
    const fields = new Map(Object.entries(body as Record<string, unknown>));
    const message = fields.get('message') ?? fields.get('detail') ?? fields.get('title');
    if (typeof message === 'string') return message.slice(0, 300);
    if (Array.isArray(message)) return message.join('; ').slice(0, 300);
  }
  return '';
}

export class HttpPlatformApi implements PlatformApi {
  readonly #token: string;

  constructor(
    private readonly apiBase: string,
    token: string,
    private readonly fetchImpl: Fetch = (input, init) => fetch(input, init),
  ) {
    this.#token = token;
  }

  private async call(
    step: string,
    method: 'GET' | 'POST',
    route: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBase}${route}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.#token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // A redirect would carry the token to wherever it points.
        redirect: 'error',
      });
    } catch {
      // The cause can quote the request; say only that it did not arrive.
      throw new PlatformApiError(step, 0, 'the API could not be reached');
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  }

  private fail(step: string, answer: { status: number; json: unknown }): never {
    const hint =
      answer.status === 401
        ? 'the session token was not accepted; it may have expired'
        : messageOf(answer.json);
    throw new PlatformApiError(step, answer.status, hint);
  }

  async getDataset(slug: string): Promise<PlatformDataset | null> {
    const answer = await this.call('read the dataset', 'GET', `/v2/catalog/datasets/${slug}`);
    if (answer.status === 404) return null;
    if (answer.status !== 200) this.fail('read the dataset', answer);
    return answer.json as PlatformDataset;
  }

  async createDataset(dataset: Parameters<PlatformApi['createDataset']>[0]): Promise<void> {
    const answer = await this.call('create the dataset', 'POST', '/v2/catalog/datasets', dataset);
    if (answer.status !== 201 && answer.status !== 200) this.fail('create the dataset', answer);
  }

  async publishVersion(
    slug: string,
    version: Parameters<PlatformApi['publishVersion']>[1],
  ): Promise<void> {
    const size = new TextEncoder().encode(JSON.stringify(version)).length;
    if (size > API_BODY_LIMIT_BYTES) {
      throw new PlatformApiError(
        'publish the version',
        413,
        `the manifest is ${size} bytes and the API takes ${API_BODY_LIMIT_BYTES} at most`,
      );
    }
    const answer = await this.call(
      'publish the version',
      'POST',
      `/v2/catalog/datasets/${slug}/versions`,
      version,
    );
    if (answer.status !== 201 && answer.status !== 200) this.fail('publish the version', answer);
  }

  async uploadFile(slug: string, file: FileToUpload): Promise<UploadedFile> {
    const base = `/v2/catalog/datasets/${slug}/uploads`;
    const init = await this.call('start the upload', 'POST', base, {
      filename: file.filename,
      contentType: file.contentType,
      contentSize: file.sizeBytes,
      sha256: file.sha256,
    });
    if (init.status !== 201) this.fail('start the upload', init);
    const { uploadId, key, partSize } = init.json as {
      uploadId: string;
      key: string;
      partSize: number;
    };
    const upload = `${base}/${encodeURIComponent(uploadId)}`;
    const keyQuery = `key=${encodeURIComponent(key)}`;

    try {
      const parts: Array<{ partNumber: number; etag: string }> = [];
      for (let offset = 0, partNumber = 1; offset < file.sizeBytes; partNumber += 1) {
        const length = Math.min(partSize, file.sizeBytes - offset);
        const address = await this.call(
          'ask for a part address',
          'GET',
          `${upload}/parts/${partNumber}/url?${keyQuery}`,
        );
        if (address.status !== 200) this.fail('ask for a part address', address);
        let put: Response;
        try {
          // The signed address is its own authorisation: no header, and it is never logged.
          put = await this.fetchImpl((address.json as { url: string }).url, {
            method: 'PUT',
            body: file.read(offset, length),
          });
        } catch {
          throw new PlatformApiError('send a part to storage', 0, 'storage could not be reached');
        }
        if (!put.ok) throw new PlatformApiError('send a part to storage', put.status, '');
        const etag = (put.headers.get('etag') ?? '').replaceAll('"', '');
        if (!etag) throw new PlatformApiError('send a part to storage', put.status, 'no ETag');
        parts.push({ partNumber, etag });
        offset += length;
      }

      const query =
        `${keyQuery}&contentType=${encodeURIComponent(file.contentType)}` +
        `&contentSize=${file.sizeBytes}&sha256=${file.sha256}`;
      const done = await this.call('finish the upload', 'POST', `${upload}/complete?${query}`, {
        parts,
        croissantId: file.croissantId,
      });
      if (done.status !== 201) this.fail('finish the upload', done);
      const uploaded = done.json as {
        distributionId: string;
        contentUrl: string;
        dicomCheckStatus?: string | null;
      };
      return {
        distributionId: uploaded.distributionId,
        contentUrl: uploaded.contentUrl,
        dicomCheckStatus: uploaded.dicomCheckStatus ?? null,
      };
    } catch (err) {
      // Do not leave parts behind. Best effort: the caller's error is what matters.
      await this.call('abort the upload', 'POST', `${upload}/abort?${keyQuery}`).catch(() => null);
      throw err;
    }
  }
}
